import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { parseDateRange, type DateRangeKey } from "@/lib/date-range";
import { AI_ACTION_CODES, AI_PAUSE_CODES } from "@/lib/ai/failure";
import { ANALYSIS_VERSION } from "@/lib/review-intelligence";
import { aiConfigured } from "@/lib/ai/config";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { forgetPrefix } from "@/lib/ttl-cache";
import { createAnalysisRun, executeAnalysisRun, getAnalysisRun } from "@/lib/services/insight-pipeline";
import { refreshDailySummaries } from "@/lib/services/daily-insights";
import { ReviewSyncService, type LocationSyncResult, type SyncCheckpoint } from "@/lib/services/review-sync";
import { isRetryableReviewError } from "@/lib/services/google-reviews";

export interface LocationPipelineJob {
  id: string; workspace_id: string; location_id: string; requested_by: string | null;
  sync_mode: "full" | "incremental";
  status: "queued" | "running" | "completed" | "partial" | "failed" | "paused";
  phase: "fetching" | "analysing" | "summarising" | "done";
  sync_result: LocationSyncResult | null;
  sync_checkpoint: SyncCheckpoint | null;
  analysis_run_id: string | null;
  attempts: number;
  range_key: string | null; range_label: string | null; range_start: string | null; range_end: string | null;
  error_code: string | null;
  error: string | null;
}

export interface PipelineJobView {
  id: string; locationId: string; locationName: string; status: LocationPipelineJob["status"];
  phase: LocationPipelineJob["phase"]; reviewsUpdated: number;
  eligible: number; analysed: number; pending: number; failed: number;
  error: string | null; errorCode: string | null; periodLabel: string | null; start: string | null; end: string | null;
}

/** The connection is resolved from the location, never taken from the browser. */
export interface PipelineRequest {
  full?: boolean;
  period?: { range: DateRangeKey; from?: string; to?: string };
  scheduled?: boolean;
}

export async function enqueueLocationPipelines(workspaceId: string, userId: string, locationIds: string[], options: PipelineRequest = {}): Promise<string[]> {
  if (locationIds.length === 0) throw new AppError("Select a location to sync.", "VALIDATION_ERROR", 400);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const { rows: allowed } = await db.query<{ id: string; timezone: string }>(`SELECT l.id,grm_review_timezone(l.workspace_id,l.id) timezone FROM grm_google_locations l
      JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
      JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
      WHERE l.workspace_id=$1 AND l.id=ANY($2::uuid[]) AND l.is_active AND c.status='active'
      ORDER BY l.id FOR UPDATE OF l`, [workspaceId, [...new Set(locationIds)]]);
    if (allowed.length !== new Set(locationIds).size) throw new AppError("A selected location is unavailable or needs its Google connection restored.", "VALIDATION_ERROR", 400);
    const ids: string[] = [];
    const now = new Date();
    for (const location of allowed) {
      const range = parseDateRange(options.period ?? { range: "30d" }, "30d", now, location.timezone);
      if (range.start && range.start >= now) throw new AppError("Choose a sync period that starts before now.", "VALIDATION_ERROR", 400);
      const rangeKey = range.key === "custom" ? `custom:${range.from}:${range.to}` : range.key;
      const { rows: [active] } = await db.query<{ id: string; range_key: string }>(`SELECT id,range_key FROM grm_location_pipeline_jobs
        WHERE workspace_id=$1 AND location_id=$2 AND status IN ('queued','running')`, [workspaceId, location.id]);
      if (active) {
        if (active.range_key !== rangeKey && !options.scheduled) throw new AppError("This location is syncing another period. Wait for it to finish before starting a different period.", "SYNC_PERIOD_BUSY", 409);
        ids.push(active.id);
        continue;
      }
      const { rows: [paused] } = await db.query<{ id: string; today: boolean }>(`SELECT id,created_at>=date_trunc('day',now()) today FROM grm_location_pipeline_jobs
        WHERE workspace_id=$1 AND location_id=$2 AND range_key=$3 AND status IN ('paused','failed','partial') ORDER BY created_at DESC LIMIT 1`, [workspaceId, location.id, rangeKey]);
      if (paused && !options.scheduled) { ids.push(paused.id); continue; }
      if (paused?.today && options.scheduled) continue;
      const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO grm_location_pipeline_jobs
        (workspace_id,location_id,requested_by,sync_mode,range_key,range_label,range_start,range_end)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [workspaceId, location.id, userId, options.full ? "full" : "incremental",
        rangeKey, range.label, range.start?.toISOString() ?? null, (range.end && range.end<now ? range.end : now).toISOString()]);
      ids.push(job.id);
    }
    await db.query("COMMIT");
    return ids;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

/** Resume the original job and its frozen period, never restart completed phases. */
export async function resumeLocationPipelines(workspaceId: string, jobIds: string[], allowedLocationIds: string[]): Promise<void> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    // Same location locks as enqueue, so a new-period click cannot race Resume.
    await db.query(`SELECT l.id FROM grm_google_locations l WHERE l.workspace_id=$1 AND l.id IN
      (SELECT location_id FROM grm_location_pipeline_jobs WHERE workspace_id=$1 AND id=ANY($2::uuid[])) ORDER BY l.id FOR UPDATE`, [workspaceId, jobIds]);
    const { rows: jobs } = await db.query<LocationPipelineJob>(`SELECT * FROM grm_location_pipeline_jobs WHERE workspace_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`, [workspaceId, jobIds]);
    if (jobs.length !== new Set(jobIds).size || jobs.some((job) => !allowedLocationIds.includes(job.location_id))) throw new AppError("Sync job not found.", "NOT_FOUND", 404);
    if (jobs.some((job) => !job.range_key || !job.range_end)) throw new AppError("Choose a sync period to continue. Saved reviews are kept.", "PERIOD_REQUIRED", 400);
    if (new Set(jobs.map((job) => job.location_id)).size !== jobs.length) throw new AppError("Resume one period per location at a time.", "VALIDATION_ERROR", 400);
    const { rows: active } = await db.query(`SELECT id FROM grm_location_pipeline_jobs WHERE workspace_id=$1 AND location_id=ANY($2::uuid[])
      AND status IN ('queued','running') AND NOT(id=ANY($3::uuid[]))`, [workspaceId, jobs.map((job) => job.location_id), jobIds]);
    if (active.length) throw new AppError("Another sync is running for this location. Wait before resuming this period.", "SYNC_PERIOD_BUSY", 409);
    // Explicit Resume permits one new attempt after a person restores funding.
    if (jobs.some((job) => job.status === "paused" && [...AI_ACTION_CODES, "AI_NOT_CONFIGURED"].includes(job.error_code ?? ""))) {
      await db.query("DELETE FROM grm_pipeline_ai_blocks WHERE workspace_id=$1", [workspaceId]);
    }
    await db.query(`UPDATE grm_location_pipeline_jobs SET status='queued',attempts=0,error=NULL,error_code=NULL,
      available_at=now(),finished_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status IN ('paused','failed','partial')`, [workspaceId, jobIds]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function pipelineJobViews(workspaceId: string, jobIds: string[], allowedLocationIds: string[]): Promise<PipelineJobView[]> {
  if (jobIds.length === 0 || allowedLocationIds.length === 0) return [];
  const { rows } = await getPool().query<PipelineJobView>(`SELECT j.id,j.location_id "locationId",l.location_title "locationName",j.status,j.phase,j.error,j.error_code "errorCode",j.range_label "periodLabel",j.range_start start,j.range_end "end",
    coalesce((j.sync_result->>'reviewsUpdated')::integer,(j.sync_checkpoint->>'reviewsUpdated')::integer,0) "reviewsUpdated",
    coalesce(a.eligible,0) eligible,coalesce(a.already_analysed,0)+coalesce(a.newly_analysed,0) analysed,
    greatest(0,coalesce(a.eligible,0)-coalesce(a.already_analysed,0)-coalesce(a.newly_analysed,0)) pending,
    coalesce(a.failed,0) failed
    FROM grm_location_pipeline_jobs j
    JOIN grm_google_locations l ON l.workspace_id=j.workspace_id AND l.id=j.location_id
    LEFT JOIN grm_analysis_runs a ON a.workspace_id=j.workspace_id AND a.id=j.analysis_run_id
    WHERE j.workspace_id=$1 AND j.id=ANY($2::uuid[]) AND j.location_id=ANY($3::uuid[]) ORDER BY j.created_at,j.id`, [workspaceId, jobIds, allowedLocationIds]);
  return rows;
}

/** One bounded slice. The database row survives the tab, process and server.
 * A session advisory lock also prevents an expired lease duplicating a slow
 * but still-live worker. The recurring worker drains jobs without UI polling. */
export async function runLocationPipeline(jobId: string, workspaceId: string, sliceMs = 40_000): Promise<void> {
  const db = await getPool().connect();
  let lockKey: string | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let leaseToken: string | null = null;
  try {
    const { rows: [candidate] } = await db.query<LocationPipelineJob>(`SELECT * FROM grm_location_pipeline_jobs
      WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','running') AND available_at<=now()
        AND (lease_until IS NULL OR lease_until<now())`, [jobId, workspaceId]);
    if (!candidate) return;
    const key = `location-pipeline:${workspaceId}:${candidate.location_id}`;
    const { rows: [lock] } = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [key]);
    if (!lock.locked) return;
    lockKey = key;
    leaseToken = randomUUID();
    const { rows: [job] } = await db.query<LocationPipelineJob>(`UPDATE grm_location_pipeline_jobs SET status='running',lease_token=$3,
      lease_until=now()+interval '3 minutes',updated_at=now()
      WHERE id=$1 AND workspace_id=$2 AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING *`, [jobId, workspaceId, leaseToken]);
    if (!job) return;
    const deadlineAt = Date.now() + sliceMs;
    heartbeat = setInterval(() => {
      void db.query(`UPDATE grm_location_pipeline_jobs SET lease_until=now()+interval '3 minutes',updated_at=now()
        WHERE id=$1 AND workspace_id=$2 AND lease_token=$3`, [jobId, workspaceId, leaseToken]).catch((error) => logger.error("pipeline.heartbeat_failed", { jobId, message: String(error) }));
    }, 10_000);
    const patch = async (values: { phase?: string; syncResult?: LocationSyncResult; checkpoint?: SyncCheckpoint | null; runId?: string; status?: string; error?: string | null; errorCode?: string | null; delay?: number; retry?: boolean }) => {
      await db.query(`UPDATE grm_location_pipeline_jobs SET
        phase=coalesce($4,phase),sync_result=coalesce($5::jsonb,sync_result),
        sync_checkpoint=CASE WHEN $6 THEN $7::jsonb ELSE sync_checkpoint END,
        analysis_run_id=coalesce($8::uuid,analysis_run_id),status=coalesce($9,status),error=$10,error_code=$13,
        available_at=now()+($11::integer*interval '1 second'),attempts=attempts+CASE WHEN $12 THEN 1 ELSE 0 END,
        finished_at=CASE WHEN $9 IN ('completed','partial','failed') THEN now() ELSE finished_at END,updated_at=now()
        WHERE id=$1 AND workspace_id=$2 AND lease_token=$3`,
      [jobId, workspaceId, leaseToken, values.phase ?? null, values.syncResult ? JSON.stringify(values.syncResult) : null,
        values.checkpoint !== undefined, values.checkpoint ? JSON.stringify(values.checkpoint) : null, values.runId ?? null,
        values.status ?? null, values.error ?? null, values.delay ?? 0, values.retry ?? false, values.errorCode ?? null]);
    };
    if (!job.range_key || !job.range_end) {
      await patch({ status: "paused", errorCode: "PERIOD_REQUIRED", error: "Choose a sync period to continue. Saved reviews are kept." });
      return;
    }
    const summaryOptions = { deadlineAt, start: job.range_start, end: job.range_end };
    if (job.phase === "fetching") {
      const { rows: [location] } = await db.query<{ connection_id: string; user_id: string }>(`SELECT a.connection_id,c.authorized_by_user_id user_id
        FROM grm_google_locations l JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
        JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
        WHERE l.workspace_id=$1 AND l.id=$2 AND l.is_active AND c.status='active'`, [workspaceId, job.location_id]);
      if (!location) throw new AppError("Reconnect Google before retrying this location.", "OAUTH_REVOKED", 401);
      const result = await ReviewSyncService.syncLocation(job.location_id, location.connection_id, workspaceId,
        job.requested_by ?? location.user_id, { mode: job.sync_mode, checkpoint: job.sync_checkpoint ?? undefined, deadlineAt, start: job.range_start, end: job.range_end, onCheckpoint: (checkpoint) => patch({ checkpoint }) });
      if (result.continuation) {
        await patch({ checkpoint: result.continuation });
        return;
      }
      if (result.errorClass) {
        const expiredToken = result.errorClass === "invalid_request" && Boolean(result.resumeCheckpoint?.pageToken ?? job.sync_checkpoint?.pageToken);
        const retry = (isRetryableReviewError(result.errorClass) || expiredToken) && job.attempts < 4;
        // Save summaries for pages already committed, even when Google stops.
        await refreshDailySummaries(workspaceId, [job.location_id], summaryOptions);
        await patch({ syncResult: result, status: retry ? "queued" : "paused", checkpoint: expiredToken ? null : result.resumeCheckpoint ?? job.sync_checkpoint, errorCode: "FETCH_FAILED",
          error: result.errorMessage ?? "Could not finish fetching reviews.", retry: true, delay: Math.min(3600, 60 * 2 ** job.attempts) });
        return;
      }
      job.sync_result = result;
      job.phase = "analysing";
      await patch({ phase: job.phase, syncResult: result, checkpoint: null });
    }
    if (Date.now() >= deadlineAt) return;
    if (job.phase === "analysing") {
      const { rows: [coverage] } = await db.query<{ needs_ai: boolean }>(`SELECT EXISTS(
        SELECT 1 FROM grm_reviews r LEFT JOIN grm_review_analyses a
          ON a.workspace_id=r.workspace_id AND a.review_id=r.id AND a.analysis_version=$5
        WHERE r.workspace_id=$1 AND r.location_id=$2 AND r.missing_on_google_at IS NULL
          AND ($3::timestamptz IS NULL OR r.review_create_time>=$3) AND r.review_create_time<$4
          AND btrim(coalesce(r.comment,''))<>'' AND (a.status IS DISTINCT FROM 'ready'
            OR r.content_fingerprint IS NOT NULL AND a.content_fingerprint IS DISTINCT FROM r.content_fingerprint)
      ) needs_ai`, [workspaceId, job.location_id, job.range_start, job.range_end, ANALYSIS_VERSION]);
      if (coverage.needs_ai && !aiConfigured("extract")) {
        await refreshDailySummaries(workspaceId, [job.location_id], summaryOptions);
        await patch({ status: "paused", errorCode: "AI_NOT_CONFIGURED", error: "Reviews saved. Configure AI, then resume analysis and insights." });
        return;
      }
      const { rows: [block] } = await db.query<{ error_code: string; message: string }>("SELECT error_code,message FROM grm_pipeline_ai_blocks WHERE workspace_id=$1", [workspaceId]);
      if (coverage.needs_ai && block) {
        await patch({ status: "paused", errorCode: block.error_code, error: block.message });
        return;
      }
      const scope = { locationIds: [job.location_id], locationId: job.location_id, clientId: null, groupId: null, start: job.range_start, end: job.range_end };
      const runId = job.analysis_run_id ?? await createAnalysisRun(workspaceId, job.requested_by, scope);
      await patch({ runId });
      await executeAnalysisRun(runId, workspaceId, scope, undefined, { sliceMs: Math.max(1, deadlineAt - Date.now()) });
      const run = await getAnalysisRun(workspaceId, runId);
      if (run?.status === "failed" && AI_PAUSE_CODES.includes(String(run.error_code))) {
        const message = String(run.error ?? "Restore AI credits or configuration, then resume.");
        if (AI_ACTION_CODES.includes(String(run.error_code))) await db.query(`INSERT INTO grm_pipeline_ai_blocks(workspace_id,error_code,message) VALUES($1,$2,$3)
          ON CONFLICT(workspace_id) DO UPDATE SET error_code=excluded.error_code,message=excluded.message,created_at=now()`, [workspaceId, run.error_code, message]);
        await refreshDailySummaries(workspaceId, [job.location_id], summaryOptions);
        await patch({ status: "paused", errorCode: String(run.error_code), error: message });
        return;
      }
      if (!run || run.status === "failed") throw new Error(run?.error as string ?? "Analysis could not finish.");
      if (run.status === "running") return;
      if (run.status === "partial" || Number(run.failed) > 0) {
        await refreshDailySummaries(workspaceId, [job.location_id], summaryOptions);
        await patch({ status: job.attempts < 4 ? "queued" : "paused", errorCode: "ANALYSIS_RETRY", error: "Some reviews need another analysis attempt.", retry: true, delay: Math.min(3600, 60 * 2 ** job.attempts) });
        return;
      }
      job.phase = "summarising";
      await patch({ phase: job.phase });
    }
    if (job.phase === "summarising") {
      if (!await refreshDailySummaries(workspaceId, [job.location_id], summaryOptions)) return;
      await patch({ phase: "done", status: "completed" });
    }
  } catch (error) {
    logger.error("pipeline.slice_failed", { jobId, workspaceId, message: error instanceof Error ? error.message : String(error) });
    if (leaseToken) await db.query(`UPDATE grm_location_pipeline_jobs SET status=CASE WHEN attempts<4 AND $4 THEN 'queued' ELSE 'paused' END,
      attempts=attempts+1,error=$5,error_code='PIPELINE_ERROR',available_at=now()+interval '1 minute',updated_at=now(),
      finished_at=CASE WHEN attempts>=4 OR NOT $4 THEN now() ELSE NULL END
      WHERE id=$1 AND workspace_id=$2 AND lease_token=$3`,
    [jobId, workspaceId, leaseToken, !(error instanceof AppError && [401, 403, 404].includes(error.statusCode)), error instanceof Error ? error.message.slice(0, 500) : "Pipeline failed."]);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try {
      if (leaseToken) await db.query(`UPDATE grm_location_pipeline_jobs SET lease_until=NULL,lease_token=NULL WHERE id=$1 AND workspace_id=$2 AND lease_token=$3`, [jobId, workspaceId, leaseToken]);
      if (lockKey) await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockKey]);
    } finally { db.release(); }
    if (leaseToken) for (const prefix of [`today:`, `insights:${workspaceId}:`, `shell:`, `chrome:`, `inbox:${workspaceId}:`, `dashctx:${workspaceId}:`, `dashboard:`]) forgetPrefix(prefix);
  }
}

export async function drainLocationPipelines(options?: { workspaceId?: string; jobIds?: string[]; sliceMs?: number; limit?: number }): Promise<number> {
  const { rows } = await getPool().query<{ id: string; workspace_id: string }>(`SELECT id,workspace_id FROM grm_location_pipeline_jobs
    WHERE status IN ('queued','running') AND available_at<=now() AND (lease_until IS NULL OR lease_until<now())
      AND ($1::uuid IS NULL OR workspace_id=$1) AND ($2::uuid[] IS NULL OR id=ANY($2))
    ORDER BY updated_at,created_at LIMIT $3`, [options?.workspaceId ?? null, options?.jobIds ?? null, options?.limit ?? 2]);
  // Sequential slices keep database and provider concurrency bounded.
  for (const row of rows) await runLocationPipeline(row.id, row.workspace_id, options?.sliceMs);
  return rows.length;
}
