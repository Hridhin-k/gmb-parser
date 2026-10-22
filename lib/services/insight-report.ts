import { createAdminClient } from "@/lib/supabase/admin";
import {
  GEMINI_FAST_MODEL_ID,
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  GEMINI_THINKING_MINIMAL,
  extractGeminiText,
  geminiGenerateUrl,
  usageFromResponse,
} from "@/lib/gemini";
import { ANALYSIS_VERSION, withRetry } from "@/lib/review-intelligence";
import {
  INSIGHT_PROMPT_VERSION,
  assembleInsights,
  buildEvidenceItems,
  computeReportCacheKey,
  computeScopeDataFingerprint,
  normaliseLocationIds,
  parseSynthesisResponse,
  synthesisPrompt,
  type SampleObservation,
} from "@/lib/insight-report";
import {
  createAnalysisRun,
  discoverScopeReviews,
  executeAnalysisRun,
  failStaleAnalysisRuns,
  type AnalysisRunScope,
} from "@/lib/services/insight-pipeline";
import {
  fingerprintOf,
  loadObservationAggregates,
} from "@/lib/services/review-observations";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/types/supabase";

type ReportUpdate = Database["public"]["Tables"]["grm_insight_reports"]["Update"];

type Admin = ReturnType<typeof createAdminClient>;

const REQUEST_TIMEOUT_MS = 120_000;
const SAMPLE_LIMIT = 2000;

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
    model: GEMINI_MODEL_ID,
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
    return { reportId: existing.id as string, status: existing.status as string, action: "generate" };
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

async function loadSamples(
  admin: Admin,
  workspaceId: string,
  input: { locationIds: string[]; start: string | null; end: string | null }
): Promise<SampleObservation[]> {
  const out: SampleObservation[] = [];
  for (let c = 0; c < input.locationIds.length && out.length < SAMPLE_LIMIT; c += 80) {
    const locationChunk = input.locationIds.slice(c, c + 80);
    let query = admin
      .from("grm_review_observations")
      .select(
        "review_id, location_id, topic, sentiment, entity_type, entity_name, severity, evidence_excerpt, grm_review_analyses!inner(status)"
      )
      .eq("workspace_id", workspaceId)
      .in("location_id", locationChunk)
      .eq("grm_review_analyses.status", "ready")
      .order("severity", { ascending: false, nullsFirst: false })
      .limit(SAMPLE_LIMIT - out.length);
    if (input.start) query = query.gte("review_create_time", input.start);
    if (input.end) query = query.lt("review_create_time", input.end);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load evidence samples: ${error.message}`);
    for (const row of data ?? []) {
      out.push({
        reviewId: row.review_id as string,
        locationId: row.location_id as string,
        topic: row.topic as string,
        sentiment: row.sentiment as string,
        entityType: (row.entity_type as string | null) ?? null,
        entityName: (row.entity_name as string | null) ?? null,
        severity: (row.severity as number | null) ?? null,
        evidenceExcerpt: row.evidence_excerpt as string,
      });
    }
  }
  return out;
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

async function callSynthesis(
  prompt: string
): Promise<{ text: string; model: string; usage: { inputTokens: number; outputTokens: number } }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("config: GEMINI_API_KEY is missing");

  async function call(model: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(geminiGenerateUrl(apiKey as string, model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            thinkingConfig: model === GEMINI_FAST_MODEL_ID ? GEMINI_THINKING_MINIMAL : GEMINI_THINKING_LOW,
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  let model = GEMINI_MODEL_ID;
  let response = await call(model);
  if (!response.ok && (response.status === 502 || response.status === 503)) {
    model = GEMINI_FAST_MODEL_ID;
    response = await call(model);
  }
  if (!response.ok) throw new Error(`Gemini synthesis failed (${response.status})`);
  const body = (await response.json()) as unknown;
  const { text } = extractGeminiText(body);
  if (!text.trim()) throw new Error("Gemini returned an empty synthesis");
  return { text, model, usage: usageFromResponse(body) };
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

  async function patch(fields: ReportUpdate) {
    await admin.from("grm_insight_reports").update(fields).eq("id", reportId);
  }

  try {
    const previous = await getReportById(workspaceId, reportId);
    const previousStatus = (previous?.status as string) ?? "pending";
    const previousFingerprint = (previous?.data_fingerprint as string | null) ?? null;

    await patch({ status: "processing", phase: "checking data", started_at: new Date().toISOString(), error: null });

    let scope = await discoverScopeReviews(admin, workspaceId, input);
    const fingerprint = computeScopeDataFingerprint(
      scope.eligible.map((r) => ({ reviewId: r.id, fingerprint: fingerprintOf(r) })),
      scope.failedCount
    );

    // Cache hit: same filters, same underlying reviews, same versions.
    // No Gemini call and no re-analysis — return the saved report as-is.
    if (
      (previousStatus === "completed" || previousStatus === "partial") &&
      previousFingerprint === fingerprint
    ) {
      await patch({ status: previousStatus, phase: "reused", finished_at: new Date().toISOString() });
      logger.info("insight_report.reused", { reportId });
      return;
    }

    if (scope.pendingReviews.length > 0) {
      await patch({ phase: "analysing reviews" });
      await failStaleAnalysisRuns(workspaceId);
      const runId = await createAnalysisRun(workspaceId, null, input);
      await executeAnalysisRun(runId, workspaceId, input, {
        onProgress: () => patch({ phase: "analysing reviews" }),
      });
      scope = await discoverScopeReviews(admin, workspaceId, input);
    }

    await patch({ phase: "synthesising insights" });
    const [aggregates, previousAggregates, samples] = await Promise.all([
      loadObservationAggregates(workspaceId, input),
      input.prevStart
        ? loadObservationAggregates(workspaceId, {
            locationIds: input.locationIds,
            start: input.prevStart,
            end: input.prevEnd,
          })
        : Promise.resolve(null),
      loadSamples(admin, workspaceId, input),
    ]);
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
        () => callSynthesis(synthesisPrompt(items, input.scopeLabel)),
        { attempts: 2, baseDelayMs: 1000 }
      );
      model = result.model;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      insights = assembleInsights(items, parseSynthesisResponse(result.text), cacheKey);
    }

    const failedReviewIds = scope.pendingReviews.slice(0, 500).map((r) => r.id);
    const coverageComplete = scope.pendingReviews.length === 0;
    const limitations: string[] = [];
    if (!coverageComplete) {
      limitations.push(
        `${scope.pendingReviews.length} eligible written reviews could not be analysed and are excluded from this report. Retry analysis to complete coverage.`
      );
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
        observations: aggregates.storedObservations,
        severeIncidents: aggregates.severeIncidents.length,
        dataVersion: fingerprint,
      },
      limitations,
      data_fingerprint: fingerprint,
      model,
      discovered_count: scope.discovered.length,
      eligible_count: scope.eligible.length,
      analysed_count: scope.alreadyAnalysed,
      failed_count: scope.failedCount,
      pending_count: scope.pendingReviews.length,
      failed_review_ids: failedReviewIds,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      finished_at: new Date().toISOString(),
    });
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
  }
}
