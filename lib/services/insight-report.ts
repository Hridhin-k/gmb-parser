import { aiRouteIdentity } from "@/lib/ai/config";
import { generateAi } from "@/lib/ai/service";
import { insightSchema } from "@/lib/ai/schemas";
import { createAdminClient } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit";
import { auditErrorDetails } from "@/lib/audit-details";

import { ANALYSIS_VERSION, withRetry } from "@/lib/review-intelligence";
import {
  INSIGHT_PROMPT_VERSION,
  assembleInsights,
  buildEvidenceItems,
  computeReportCacheKey,
  normaliseLocationIds,
  reportRangeMatches,
  parseSynthesisResponse,
  synthesisPrompt,
} from "@/lib/insight-report";
import {
  createAnalysisRun,
  executeAnalysisRun,
  failStaleAnalysisRuns,
  type AnalysisRunScope,
} from "@/lib/services/insight-pipeline";
import { getPool } from "@/lib/db/pool";
import { loadDailySummaryRange } from "@/lib/services/daily-insights";
import { dailySourceFingerprint } from "@/lib/daily-insights";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/types/database-schema";

type ReportUpdate = Database["public"]["Tables"]["grm_insight_reports"]["Update"];

type Admin = ReturnType<typeof createAdminClient>;

const REQUEST_TIMEOUT_MS = 120_000;

export interface ReportRequestInput extends AnalysisRunScope {
  prevStart: string | null;
  prevEnd: string | null;
  scopeLabel: string;
}

export function reportCacheKey(workspaceId: string, input: AnalysisRunScope): string {
  return computeReportCacheKey({
    workspaceId,
    clientId: input.clientId,
    groupId: input.groupId,
    locationId: input.locationId,
    locationIds: input.locationIds,
    rangeStart: input.start,
    rangeEnd: input.end,
    model: aiRouteIdentity("insight"),
  });
}

export async function getReportByCacheKey(workspaceId: string, cacheKey: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_insight_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  return data;
}

/**
 * Atomically claims a report whose generator has gone quiet, so exactly one
 * re-kick resumes it. Touching updated_at acts as the lease: concurrent
 * pollers lose the race and stand down.
 */
export async function claimStaleReport(
  workspaceId: string,
  reportId: string,
  staleMs = 20_000
): Promise<boolean> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const { data } = await admin
    .from("grm_insight_reports")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .in("status", ["processing", "pending"])
    .lt("updated_at", cutoff)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function getReportById(workspaceId: string, reportId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_insight_reports")
    .select("*")
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

/**
 * Display fallback: the most recent completed/partial report for the same
 * scope whose stored window is the same preset (rolling windows drift a
 * day at a time, so an exact cache-key hit fails from the next day on).
 * The report is shown with its own generated date, never relabelled.
 */
export async function getLatestReportForScope(
  workspaceId: string,
  input: {
    clientId: string | null;
    groupId: string | null;
    locationId: string | null;
    locationIds: readonly string[];
    rangeStart: string | null;
    rangeEnd: string | null;
  }
) {
  const admin = createAdminClient();
  let query = admin
    .from("grm_insight_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("status", ["completed", "partial"])
    .order("created_at", { ascending: false })
    .limit(10);
  query = input.clientId ? query.eq("client_id", input.clientId) : query.is("client_id", null);
  query = input.groupId ? query.eq("group_id", input.groupId) : query.is("group_id", null);
  query = input.locationId ? query.eq("location_id", input.locationId) : query.is("location_id", null);
  const { data } = await query;
  const expectedLocations = normaliseLocationIds(input.locationIds).join(",");
  for (const row of data ?? []) {
    const storedLocations = normaliseLocationIds(
      Array.isArray(row.location_ids) ? (row.location_ids as string[]) : []
    ).join(",");
    if (storedLocations !== expectedLocations) continue;
    if (
      reportRangeMatches(
        {
          rangeStart: (row.range_start as string | null) ?? null,
          rangeEnd: (row.range_end as string | null) ?? null,
        },
        { rangeStart: input.rangeStart, rangeEnd: input.rangeEnd }
      )
    ) {
      return row;
    }
  }
  return null;
}

/**
 * Finds or creates the report row for a cache identity. The unique
 * (workspace_id, cache_key) constraint makes concurrent requests for the
 * same filters converge on one row; a fresh in-progress row is returned
 * as 'wait' so no duplicate generation starts.
 */
export async function requestReport(
  workspaceId: string,
  requestedBy: string | null,
  input: ReportRequestInput
): Promise<{ reportId: string; status: string; action: "wait" | "generate" }> {
  const admin = createAdminClient();
  const cacheKey = reportCacheKey(workspaceId, input);
  const existing = await getReportByCacheKey(workspaceId, cacheKey);
  if (existing) {
    // A healthy job heartbeats (phase changes + per-batch touches), so
    // five silent minutes means its owner died — take over instead of
    // making the user wait on a phantom job.
    const fresh =
      Date.now() - new Date(existing.updated_at as string).getTime() < 5 * 60 * 1000;
    if ((existing.status === "processing" || existing.status === "pending") && fresh) {
      return { reportId: existing.id as string, status: existing.status as string, action: "wait" };
    }
    // Claim before responding so the client polls a refresh of an already
    // completed report. Keep its saved insights/fingerprint readable.
    const { rows } = await getPool().query<{ id: string }>(`UPDATE grm_insight_reports
      SET status='pending',phase='queued',error=NULL WHERE workspace_id=$1 AND id=$2
        AND (status NOT IN ('pending','processing') OR updated_at<now()-interval '5 minutes') RETURNING id`,
      [workspaceId, existing.id]);
    return { reportId: existing.id as string, status: "pending", action: rows.length > 0 ? "generate" : "wait" };
  }
  const { data, error } = await admin
    .from("grm_insight_reports")
    .insert({
      workspace_id: workspaceId,
      cache_key: cacheKey,
      requested_by: requestedBy,
      client_id: input.clientId,
      group_id: input.groupId,
      location_id: input.locationId,
      location_ids: normaliseLocationIds(input.locationIds),
      range_start: input.start,
      range_end: input.end,
      status: "pending",
      phase: "queued",
      analysis_version: ANALYSIS_VERSION,
      prompt_version: INSIGHT_PROMPT_VERSION,
    })
    .select("id, status")
    .single();
  if (error || !data) {
    // Lost a create race: the other request's row is the one to watch.
    const raced = await getReportByCacheKey(workspaceId, cacheKey);
    if (raced) {
      return { reportId: raced.id as string, status: raced.status as string, action: "wait" };
    }
    throw new Error(`Failed to create insight report: ${error?.message ?? "unknown"}`);
  }
  return { reportId: data.id as string, status: data.status as string, action: "generate" };
}

async function loadOutletNames(
  admin: Admin,
  locationIds: string[]
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (let i = 0; i < locationIds.length; i += 150) {
    const { data } = await admin
      .from("grm_google_locations")
      .select("id, location_title")
      .in("id", locationIds.slice(i, i + 150));
    for (const row of data ?? []) names[row.id as string] = (row.location_title as string) ?? "Outlet";
  }
  return names;
}

async function callSynthesis(prompt: string, workspaceId: string, reportId: string, userId: string | null) {
  return generateAi({
    workspaceId, task: "insight", operation: "insight_prose", prompt,
    audit: { reportId, userId },
    schema: insightSchema, temperature: 0.2, maxOutputTokens: 8192, timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

/**
 * Full report generation, intended for a background `after()`:
 * verify the cache against the live data fingerprint, analyse only
 * missing/changed reviews (wider ranges reuse narrower-range analyses
 * automatically), then synthesise from database evidence. A report is
 * 'completed' only when coverage is complete.
 */
export async function generateReport(
  reportId: string,
  workspaceId: string,
  input: ReportRequestInput
): Promise<void> {
  const admin = createAdminClient();
  const cacheKey = reportCacheKey(workspaceId, input);
  const lease = await getPool().connect();
  const lockKey = `insight-report:${workspaceId}:${reportId}`;
  const { rows: [lock] } = await lease.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [lockKey]);
  if (!lock.locked) { lease.release(); return; }

  async function patch(fields: ReportUpdate) {
    const { error } = await admin.from("grm_insight_reports").update(fields).eq("id", reportId).eq("workspace_id", workspaceId);
    if (error) throw new Error(`Failed to save insight report: ${error.message}`);
  }

  try {
    const previous = await getReportById(workspaceId, reportId);
    const previousStatus = (previous?.status as string) ?? "pending";
    const previousFingerprint = (previous?.data_fingerprint as string | null) ?? null;

    await patch({ status: "processing", phase: "checking data", started_at: new Date().toISOString(), error: null });

    let current = await loadDailySummaryRange(workspaceId, input);
    let before = input.prevStart
      ? await loadDailySummaryRange(workspaceId, { locationIds: input.locationIds, start: input.prevStart, end: input.prevEnd })
      : null;
    let sources = [...current.sources, ...(before?.sources ?? [])];
    let fingerprint = dailySourceFingerprint(sources);
    if (previousFingerprint === fingerprint && current.coverage.pending === 0) {
      await patch({ status: previousStatus === "partial" ? "partial" : "completed", phase: "reused" });
      return;
    }

    if (current.coverage.pending > 0) {
      await patch({ phase: "analysing reviews" });
      await failStaleAnalysisRuns(workspaceId);
      const runId = await createAnalysisRun(workspaceId, null, input);
      await executeAnalysisRun(runId, workspaceId, input, {
        onProgress: () => patch({ phase: "analysing reviews" }),
      }, { sliceMs: 45_000 });
      current = await loadDailySummaryRange(workspaceId, input);
      before = input.prevStart
        ? await loadDailySummaryRange(workspaceId, { locationIds: input.locationIds, start: input.prevStart, end: input.prevEnd })
        : null;
      sources = [...current.sources, ...(before?.sources ?? [])];
      fingerprint = dailySourceFingerprint(sources);
    }

    await patch({ phase: "synthesising insights" });
    const aggregates = current.aggregates;
    const previousAggregates = before?.aggregates ?? null;
    const samples = current.samples;
    const outletNames = await loadOutletNames(
      admin,
      aggregates.byOutlet.map((o) => o.locationId)
    );

    const items = buildEvidenceItems({
      aggregates,
      previous: previousAggregates,
      previousEligible: previousAggregates?.reviewsAnalysed ?? 0,
      samples,
      outletNames,
    });

    let insights: ReturnType<typeof assembleInsights> = [];
    let model: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    if (items.length > 0) {
      const result = await withRetry(
        () => callSynthesis(synthesisPrompt(items, input.scopeLabel), workspaceId, reportId, previous?.requested_by ?? null),
        { attempts: 2, baseDelayMs: 1000 }
      );
      model = result.model;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      insights = assembleInsights(items, parseSynthesisResponse(result.text), cacheKey);
    }

    const coverageComplete = current.coverage.pending === 0;
    const { rows: failedRows } = await getPool().query<{ id: string }>(`SELECT r.id FROM grm_reviews r
      LEFT JOIN grm_review_analyses a ON a.workspace_id=r.workspace_id AND a.review_id=r.id AND a.analysis_version=$5
      WHERE r.workspace_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.missing_on_google_at IS NULL
        AND btrim(coalesce(r.comment,''))<>'' AND ($3::timestamptz IS NULL OR r.review_create_time>=$3)
        AND ($4::timestamptz IS NULL OR r.review_create_time<$4)
        AND (a.status IS DISTINCT FROM 'ready' OR (r.content_fingerprint IS NOT NULL AND a.content_fingerprint IS DISTINCT FROM r.content_fingerprint))
      ORDER BY r.id LIMIT 500`, [workspaceId, input.locationIds, input.start, input.end, ANALYSIS_VERSION]);
    const failedReviewIds = failedRows.map((r) => r.id);
    const limitations: string[] = [];
    if (!coverageComplete) {
      limitations.push(
        `${current.coverage.pending} eligible written reviews could not be analysed and are excluded from this report. Retry analysis to complete coverage.`
      );
    }
    if (before && before.coverage.pending > 0) {
      limitations.push(`${before.coverage.pending} written reviews in the comparison period await analysis. Comparisons use analysed coverage only.`);
    }
    if (items.length === 0) {
      limitations.push("No analysed observations were available for this scope and range yet.");
    }

    await patch({
      status: coverageComplete ? "completed" : "partial",
      phase: "done",
      insights,
      evidence_summary: {
        byMonth: aggregates.byMonth,
        reviewsAnalysed: aggregates.reviewsAnalysed,
        observations: aggregates.observations,
        dailySources: sources,
        comparisonStart: input.prevStart,
        comparisonEnd: input.prevEnd,
        comparisonCoverage: before?.coverage ?? null,
        severeIncidents: aggregates.severeIncidents.length,
        dataVersion: fingerprint,
      },
      limitations,
      data_fingerprint: fingerprint,
      model,
      discovered_count: current.coverage.discovered,
      eligible_count: current.coverage.eligible,
      analysed_count: current.coverage.analysed,
      failed_count: current.coverage.failed,
      pending_count: current.coverage.pending,
      failed_review_ids: failedReviewIds,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      finished_at: new Date().toISOString(),
    });
    // Clear staleness only if the exact daily revisions used above still match.
    // A concurrent edit/new day prevents this update, preserving the old report
    // with an explicit refresh marker instead of mislabelling it as current.
    await getPool().query(`UPDATE grm_insight_reports SET stale_at=NULL WHERE id=$1 AND workspace_id=$2
      AND NOT EXISTS (
        SELECT 1 FROM grm_insight_days d
        LEFT JOIN jsonb_to_recordset($3::jsonb) AS s("locationId" text,day text,timezone text,revision bigint)
          ON s."locationId"=d.location_id::text AND s.day=d.day::text AND s.timezone=d.timezone
        WHERE d.workspace_id=$2 AND d.location_id=ANY($4::uuid[])
          AND d.timezone=grm_review_timezone(d.workspace_id,d.location_id)
          AND (($5::timestamptz IS NULL OR ((d.day+1)::timestamp AT TIME ZONE d.timezone)>$5)
            AND ($6::timestamptz IS NULL OR (d.day::timestamp AT TIME ZONE d.timezone)<$6)
            OR $7::timestamptz IS NOT NULL AND ((d.day+1)::timestamp AT TIME ZONE d.timezone)>$7
              AND ($8::timestamptz IS NULL OR (d.day::timestamp AT TIME ZONE d.timezone)<$8))
          AND (s.revision IS NULL OR s.revision<>d.revision))`,
      [reportId, workspaceId, JSON.stringify(sources), input.locationIds, input.start, input.end, input.prevStart, input.prevEnd]);
    logger.info("insight_report.generated", {
      reportId,
      insights: insights.length,
      coverageComplete,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed";
    await patch({
      status: "failed",
      phase: "failed",
      error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).catch(() => undefined);
    logger.error("insight_report.failed", { reportId, message });
    await AuditService.log({ workspaceId, action: "insight.report_failed", entityType: "grm_insight_reports", entityId: reportId,
      metadata: { ...auditErrorDetails(error), reportId, locationIds: input.locationIds, rangeStart: input.start, rangeEnd: input.end, stage: "generate_report" } });
  } finally {
    try { await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockKey]); }
    finally { lease.release(); }
  }
}
