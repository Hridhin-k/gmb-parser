import { generateAi } from "@/lib/ai/service";
import { aiStopsRun } from "@/lib/ai/failure";
import { AppError } from "@/lib/errors";
import { batchExtractionSchema } from "@/lib/ai/schemas";
import { createAdminClient } from "@/lib/db/client";

import {
  ANALYSIS_VERSION,
  batchExtractionPrompt,
  buildBatches,
  parseBatchExtractionResponse,
  splitBatchResults,
  validateObservations,
  withRetry,
} from "@/lib/review-intelligence";
import {
  fingerprintOf,
  markAnalysisFailed,
  markRatingOnlyBulk,
  persistAnalysisResult,
  type ReviewForAnalysis,
} from "@/lib/services/review-observations";
import { brandContextBlock } from "@/lib/brand-profile";
import { loadBrandContexts, type ClientBrandContext } from "@/lib/services/brand-profile";
import { logger } from "@/lib/logger";
import { getPool } from "@/lib/db/pool";

type Admin = ReturnType<typeof createAdminClient>;

const PAGE_SIZE = 1000;
const LOCATION_CHUNK = 80;
/** Ids per analysis-lookup query: 150 uuids ≈ 5.5KB of URL, under gateway URL limits. */
const ANALYSIS_LOOKUP_CHUNK = 150;
/**
 * AI batches in flight at once. Raised 2 → 4 to roughly double analysis
 * throughput; withRetry backoff absorbs occasional 429s, and failed batches
 * are recorded per review and retried on a later run — never lost.
 */
const BATCH_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 120_000;

type BatchReview = ReviewForAnalysis & { comment: string; starRating: number };

function toBatchReviews(reviews: ReviewForAnalysis[]): BatchReview[] {
  return reviews.map((r) => ({ ...r, comment: r.comment ?? "", starRating: r.star_rating }));
}

/**
 * Splits pending reviews by business and pairs each group with its brand
 * context text. A business with no profile and no themes yet gets an empty
 * context, so the model reads its reviews on their own.
 */
async function businessContexts(
  admin: Admin,
  workspaceId: string,
  reviews: ReviewForAnalysis[]
): Promise<Map<string, ReviewForAnalysis[]>> {
  const locationIds = [...new Set(reviews.map((r) => r.location_id))];
  const clientByLocation = new Map<string, string | null>();
  for (const ids of chunk(locationIds, LOCATION_CHUNK)) {
    const { data } = await admin
      .from("grm_google_locations")
      .select("id, client_id")
      .eq("workspace_id", workspaceId)
      .in("id", ids);
    for (const row of data ?? []) clientByLocation.set(row.id, row.client_id);
  }
  const byClient = new Map<string, ReviewForAnalysis[]>();
  for (const review of reviews) {
    const key = clientByLocation.get(review.location_id) ?? "";
    byClient.set(key, [...(byClient.get(key) ?? []), review]);
  }
  const contexts = await loadBrandContexts(workspaceId, [...byClient.keys()].filter(Boolean)).catch(
    () => new Map<string, ClientBrandContext>()
  );
  const out = new Map<string, ReviewForAnalysis[]>();
  for (const [clientId, group] of byClient) {
    const context = contexts.get(clientId);
    const text = brandContextBlock(context?.profile ?? null, context?.knownThemes ?? []);
    out.set(text, [...(out.get(text) ?? []), ...group]);
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ScopeReviews {
  /** Every review found in scope (written + rating-only). */
  discovered: ReviewForAnalysis[];
  /** Reviews with meaningful written text — the analysis corpus. */
  eligible: ReviewForAnalysis[];
  /** Eligible reviews already holding a current ready analysis. */
  alreadyAnalysed: number;
  /** Rating-only reviews (counted in discovered, never analysed as evidence). */
  ratingOnly: ReviewForAnalysis[];
  /** Rating-only reviews not yet accounted for as no_text. */
  ratingOnlyToMark: ReviewForAnalysis[];
  /** Eligible reviews needing (re)analysis. */
  pendingReviews: ReviewForAnalysis[];
  /** Eligible reviews whose latest analysis attempt failed (subset of pending). */
  failedCount: number;
}

/**
 * Loads the COMPLETE review set for a scope: paged reads with no
 * default-limit surprises, deleted-on-Google reviews excluded, and
 * each review classified as already-analysed, rating-only, or pending.
 * Nothing is dropped silently — the counts reconcile.
 */
async function classifyReviews(
  admin: Admin,
  rows: ReviewForAnalysis[]
): Promise<ScopeReviews> {
  const eligible = rows.filter((r) => (r.comment?.trim() ?? "").length > 0);
  const ratingOnly = rows.filter((r) => (r.comment?.trim() ?? "").length === 0);

  const ratingOnlyToMark: ReviewForAnalysis[] = [];
  for (const group of chunk(ratingOnly, ANALYSIS_LOOKUP_CHUNK)) {
    const { data, error } = await admin
      .from("grm_review_analyses")
      .select("review_id, status, content_fingerprint")
      .eq("analysis_version", ANALYSIS_VERSION)
      .in(
        "review_id",
        group.map((r) => r.id)
      );
    if (error) throw new Error(`Failed to load existing analyses: ${error.message}`);
    const byReview = new Map((data ?? []).map((row) => [row.review_id as string, row]));
    for (const review of group) {
      const analysis = byReview.get(review.id);
      if (
        !analysis ||
        analysis.status !== "no_text" ||
        analysis.content_fingerprint !== fingerprintOf(review)
      ) {
        ratingOnlyToMark.push(review);
      }
    }
  }

  let alreadyAnalysed = 0;
  let failedCount = 0;
  const pendingReviews: ReviewForAnalysis[] = [];
  for (const group of chunk(eligible, ANALYSIS_LOOKUP_CHUNK)) {
    const { data, error } = await admin
      .from("grm_review_analyses")
      .select("review_id, status, content_fingerprint")
      .eq("analysis_version", ANALYSIS_VERSION)
      .in(
        "review_id",
        group.map((r) => r.id)
      );
    if (error) throw new Error(`Failed to load existing analyses: ${error.message}`);
    const byReview = new Map((data ?? []).map((row) => [row.review_id as string, row]));
    for (const review of group) {
      const analysis = byReview.get(review.id);
      if (
        analysis &&
        analysis.status === "ready" &&
        analysis.content_fingerprint === fingerprintOf(review)
      ) {
        alreadyAnalysed += 1;
      } else {
        if (analysis?.status === "failed") failedCount += 1;
        pendingReviews.push(review);
      }
    }
  }

  return { discovered: rows, eligible, alreadyAnalysed, ratingOnly, ratingOnlyToMark, pendingReviews, failedCount };
}

/**
 * Streams the scope one database page at a time: each page is classified
 * (already-analysed / rating-only / pending) and handed to `onPage`, then
 * released. Memory stays flat no matter how large the scope is — only the
 * current page is held.
 */
export async function streamScopeReviews(
  admin: Admin,
  workspaceId: string,
  input: { locationIds: string[]; start: string | null; end: string | null },
  onPage: (page: ScopeReviews) => Promise<void>
): Promise<void> {
  let lastId: string | null = null;
  for (const locationChunk of chunk(input.locationIds, LOCATION_CHUNK)) {
    lastId = null;
    for (;;) {
      let query = admin
        .from("grm_reviews")
        .select("id, location_id, comment, star_rating, review_create_time, review_language")
        .eq("workspace_id", workspaceId)
        .in("location_id", locationChunk)
        .is("missing_on_google_at", null)
        // Keyset paging on the primary key: cannot skip or repeat rows if
        // reviews are synced mid-discovery, and never pays offset costs.
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (lastId) query = query.gt("id", lastId);
      if (input.start) query = query.gte("review_create_time", input.start);
      if (input.end) query = query.lt("review_create_time", input.end);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to load reviews: ${error.message}`);
      const rows = (data ?? []) as ReviewForAnalysis[];
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      await onPage(await classifyReviews(admin, rows));
      if (rows.length < PAGE_SIZE) break;
    }
  }
}

/**
 * Loads the COMPLETE review set for a scope and classifies each review as
 * already-analysed, rating-only, or pending. Nothing is dropped silently —
 * the counts reconcile. Callers that only need counts or process page by
 * page should use streamScopeReviews instead of holding everything.
 */
export async function discoverScopeReviews(
  admin: Admin,
  workspaceId: string,
  input: { locationIds: string[]; start: string | null; end: string | null }
): Promise<ScopeReviews> {
  const all: ScopeReviews = {
    discovered: [],
    eligible: [],
    alreadyAnalysed: 0,
    ratingOnly: [],
    ratingOnlyToMark: [],
    pendingReviews: [],
    failedCount: 0,
  };
  await streamScopeReviews(admin, workspaceId, input, async (page) => {
    all.discovered.push(...page.discovered);
    all.eligible.push(...page.eligible);
    all.alreadyAnalysed += page.alreadyAnalysed;
    all.ratingOnly.push(...page.ratingOnly);
    all.ratingOnlyToMark.push(...page.ratingOnlyToMark);
    all.pendingReviews.push(...page.pendingReviews);
    all.failedCount += page.failedCount;
  });
  return all;
}

async function callBatchExtractor(reviews: BatchReview[], workspaceId: string, brandContext: string) {
  return generateAi({
    workspaceId, task: "extract", operation: "extract_review",
    prompt: batchExtractionPrompt(reviews, brandContext), schema: batchExtractionSchema,
    temperature: 0.1, maxOutputTokens: 8192, timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

export interface AnalysisRunScope {
  locationIds: string[];
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  start: string | null;
  end: string | null;
}

/** Opens a run row immediately so the request never waits on discovery. */
export async function createAnalysisRun(
  workspaceId: string,
  requestedBy: string | null,
  input: AnalysisRunScope
): Promise<string> {
  const admin = createAdminClient();
  const { data: run, error } = await admin
    .from("grm_analysis_runs")
    .insert({
      workspace_id: workspaceId,
      requested_by: requestedBy,
      client_id: input.clientId,
      group_id: input.groupId,
      location_id: input.locationId,
      range_start: input.start,
      range_end: input.end,
      status: "running",
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`Failed to start analysis run: ${error?.message ?? "unknown"}`);
  return run.id as string;
}

/**
 * Full run body, intended for a background `after()` so large scopes
 * never hit a request timeout: discovery, rating-only accounting,
 * then bounded batch processing. A discovery failure fails the run
 * loudly instead of leaving it running forever.
 */
export async function executeAnalysisRun(
  runId: string,
  workspaceId: string,
  input: AnalysisRunScope,
  hooks?: { onProgress?: () => void | Promise<void> },
  options?: { sliceMs?: number }
): Promise<void> {
  const admin = createAdminClient();
  const lease = await getPool().connect();
  const lockKeys: string[] = [];
  try {
    // Report generation, scheduled catch-up and location sync can overlap.
    // Acquire all scope locks in stable order; yield rather than paying for
    // the same review extraction in two workers.
    for (const locationId of [...new Set(input.locationIds)].sort()) {
      const key = `review-analysis:${workspaceId}:${locationId}`;
      const { rows: [lock] } = await lease.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [key]);
      if (!lock.locked) return;
      lockKeys.push(key);
    }
    const { error: resetError } = await admin.from("grm_analysis_runs").update({
      status: "running", error: null, error_code: null, finished_at: null, discovered: 0, eligible: 0, already_analysed: 0,
      newly_analysed: 0, failed: 0, pending: 0, batches_completed: 0, batches_total: 0,
      input_tokens: 0, output_tokens: 0, retries: 0,
    }).eq("id", runId).eq("workspace_id", workspaceId);
    if (resetError) throw new Error(`Failed to resume analysis: ${resetError.message}`);
    const processor = makeRunProcessor(runId, workspaceId, hooks, {
      deadlineAt: options?.sliceMs ? Date.now() + options.sliceMs : undefined,
    });
    let discovered = 0;
    let eligible = 0;
    let alreadyAnalysed = 0;
    let failedCount = 0;

    // Stream the scope page by page: rating-only reviews are accounted for
    // and pending reviews are analysed as they are discovered, so a 41k
    // review scope never sits in memory at once.
    await streamScopeReviews(admin, workspaceId, input, async (page) => {
      discovered += page.discovered.length;
      eligible += page.eligible.length;
      alreadyAnalysed += page.alreadyAnalysed;
      failedCount += page.failedCount;
      await markRatingOnlyBulk(admin, workspaceId, page.ratingOnlyToMark).catch(() => undefined);
      processor.state.pendingTotal += page.pendingReviews.length;
      // Publish the discovered denominator before the slow model call, so
      // progress never reads "25 / 0" while the first page is being processed.
      await admin.from("grm_analysis_runs").update({ discovered, eligible, already_analysed: alreadyAnalysed,
        pending: Math.max(processor.state.pendingTotal - processor.state.newlyAnalysed - processor.state.failed, 0),
        failed: failedCount,
      }).eq("id", runId).eq("workspace_id", workspaceId);
      // Once the slice is spent, keep counting (cheap) but stop analysing;
      // the next slice re-discovers and resumes the remainder.
      if (!processor.state.exhausted) {
        await processor.process(page.pendingReviews);
      }
      await admin
        .from("grm_analysis_runs")
        .update({
          discovered,
          eligible,
          already_analysed: alreadyAnalysed,
          pending: Math.max(processor.state.pendingTotal - processor.state.newlyAnalysed - processor.state.failed, 0),
          failed: processor.state.failed,
          batches_total: processor.state.batchesTotal,
        })
        .eq("id", runId)
        .then(undefined, () => undefined);
    });

    if (processor.state.exhausted) {
      // Not finished — leave status "running" with progress saved. The
      // status poll sees the worker go quiet and kicks the next slice.
      logger.info("insight_pipeline.slice_paused", { runId, batchesCompleted: processor.state.batchesCompleted });
      return;
    }

    await processor.finish();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis run failed";
    await admin
      .from("grm_analysis_runs")
      .update({ status: "failed", error: message.slice(0, 500), error_code: error instanceof AppError ? error.code : null, finished_at: new Date().toISOString() })
      .eq("id", runId)
      .then(undefined, () => undefined);
    logger.error("insight_pipeline.run_failed", { runId, message });
  } finally {
    try { for (const key of lockKeys) await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); }
    finally { lease.release(); }
  }
}

/**
 * Marks analysis runs whose owner died (server restart, crashed job) as
 * failed so the UI never shows a phantom "running" job forever. A healthy
 * run heartbeats its progress after every batch, so five idle minutes
 * means the owner is gone.
 */
export async function failStaleAnalysisRuns(workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await admin
    .from("grm_analysis_runs")
    .update({
      status: "failed",
      error: "Interrupted — the process running this job stopped. Start again to resume; completed reviews are reused.",
      finished_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .then(undefined, () => undefined);
}

interface RunProcessorState {
  newlyAnalysed: number;
  failed: number;
  retries: number;
  batchesCompleted: number;
  batchesTotal: number;
  inputTokens: number;
  outputTokens: number;
  pendingTotal: number;
  /** Set when the slice deadline stopped work early: the run stays "running" and a later slice resumes it. */
  exhausted: boolean;
}

/**
 * How long one function invocation may spend analysing before it must stop
 * and leave the rest for the next slice. Vercel kills the invocation at
 * maxDuration (60s); stopping at ~45s lets the worker save progress and exit
 * cleanly instead of dying mid-batch. The status poll re-kicks stale runs.
 */
export const ANALYSIS_RUN_SLICE_MS = 45_000;

/**
 * Batch processor with shared, mutable progress state. `process` can be fed
 * pending reviews incrementally (streamed discovery) or all at once;
 * `finish` writes the terminal status.
 */
function makeRunProcessor(
  runId: string,
  workspaceId: string,
  hooks?: { onProgress?: () => void | Promise<void> },
  options?: { deadlineAt?: number }
) {
  const admin = createAdminClient();
  const state: RunProcessorState = {
    newlyAnalysed: 0,
    failed: 0,
    retries: 0,
    batchesCompleted: 0,
    batchesTotal: 0,
    inputTokens: 0,
    outputTokens: 0,
    pendingTotal: 0,
    exhausted: false,
  };

  async function updateProgress(finalStatus?: string) {
    await admin
      .from("grm_analysis_runs")
      .update({
        newly_analysed: state.newlyAnalysed,
        failed: state.failed,
        pending: Math.max(state.pendingTotal - state.newlyAnalysed - state.failed, 0),
        batches_completed: state.batchesCompleted,
        batches_total: state.batchesTotal,
        retries: state.retries,
        input_tokens: state.inputTokens,
        output_tokens: state.outputTokens,
        ...(finalStatus ? { status: finalStatus, finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", runId);
  }

  async function processBatch(batch: BatchReview[], brandContext: string) {
    try {
      const { text, model, usage } = await withRetry(() => callBatchExtractor(batch, workspaceId, brandContext), {
        attempts: 3,
        baseDelayMs: 1000,
        onRetry: () => {
          state.retries += 1;
        },
      });
      state.inputTokens += usage.inputTokens;
      state.outputTokens += usage.outputTokens;
      const parsed = parseBatchExtractionResponse(text);
      const { byReview, missingReviewIds, unknownReviewIds } = splitBatchResults(batch, parsed);
      if (unknownReviewIds.length > 0) {
        // Model invented review ids. They are dropped, never stored.
        logger.warn("insight_pipeline.unknown_review_ids", { runId, count: unknownReviewIds.length });
      }
      const byId = new Map(batch.map((r) => [r.id, r]));

      // Store immediately, per review: one bad write must not fail reviews
      // that already persisted.
      await Promise.all(
        [...byReview].map(async ([reviewId, rawObservations]) => {
          const review = byId.get(reviewId)!;
          try {
            const observations = validateObservations(rawObservations, review.comment ?? "");
            await persistAnalysisResult(admin, workspaceId, review, observations, model);
            state.newlyAnalysed += 1;
          } catch (error) {
            await markAnalysisFailed(
              admin,
              workspaceId,
              review,
              error instanceof Error ? error.message : "Failed to store analysis"
            ).catch(() => undefined);
            state.failed += 1;
          }
        })
      );
      // Reviews the model omitted are explicit failures, never silent losses.
      await Promise.all(
        missingReviewIds.map(async (reviewId) => {
          const review = byId.get(reviewId)!;
          await markAnalysisFailed(
            admin,
            workspaceId,
            review,
            "Missing from AI batch response"
          ).catch(() => undefined);
          state.failed += 1;
        })
      );
    } catch (error) {
      // Credits/configuration are a run-level stop, not a failure of each review.
      // Leave these reviews pending and preserve all successful batches.
      if (aiStopsRun(error)) throw error;
      const message = error instanceof Error ? error.message : "Batch extraction failed";
      for (const review of batch) {
        await markAnalysisFailed(admin, workspaceId, review, message).catch(() => undefined);
      }
      state.failed += batch.length;
      logger.error("insight_pipeline.batch_failed", { runId, message });
    } finally {
      state.batchesCompleted += 1;
      await updateProgress().catch(() => undefined);
      await hooks?.onProgress?.()?.catch?.(() => undefined);
    }
  }

  return {
    state,
    async process(pendingReviews: ReviewForAnalysis[]): Promise<void> {
      // Reviews are batched per business so each batch carries that business's
      // brand profile and the theme names already in use for it.
      const contexts = await businessContexts(admin, workspaceId, pendingReviews);
      const batches: Array<{ reviews: BatchReview[]; brandContext: string }> = [];
      for (const [brandContext, group] of contexts) {
        for (const reviews of buildBatches(toBatchReviews(group))) batches.push({ reviews, brandContext });
      }
      state.batchesTotal += batches.length;
      await updateProgress();
      for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
        // Slice deadline: stop starting new batches so this invocation can
        // exit before the platform kills it. Remaining reviews stay pending
        // and are picked up by the next slice (already-analysed are skipped).
        if (options?.deadlineAt && Date.now() >= options.deadlineAt) {
          state.exhausted = true;
          return;
        }
        // Let already-started batches commit before reporting a blocking error.
        const settled = await Promise.allSettled(batches.slice(i, i + BATCH_CONCURRENCY).map((b) => processBatch(b.reviews, b.brandContext)));
        const blocked = settled.find((result) => result.status === "rejected");
        if (blocked?.status === "rejected") throw blocked.reason;
      }
    },
    async finish(): Promise<void> {
      const finalStatus = state.failed > 0 ? "partial" : "completed";
      await updateProgress(finalStatus).catch(() => undefined);
      logger.info("insight_pipeline.finished", {
        runId,
        status: finalStatus,
        newlyAnalysed: state.newlyAnalysed,
        failed: state.failed,
      });
    },
  };
}

/**
 * Atomically claims a running run whose worker has gone quiet, so exactly
 * one re-kick resumes it. Touching updated_at acts as the lease: concurrent
 * pollers lose the race and stand down.
 */
export async function claimStaleAnalysisRun(runId: string, staleMs = 20_000): Promise<boolean> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const { data } = await admin
    .from("grm_analysis_runs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function getAnalysisRun(workspaceId: string, runId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_analysis_runs")
    .select("*")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

export async function getLatestAnalysisRun(workspaceId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_analysis_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
