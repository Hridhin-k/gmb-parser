import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { planInvalidation, reconcileFreshness } from "@/lib/intelligence/freshness";
import { INSIGHT_PROMPT_VERSION } from "@/lib/intelligence/insight";
import { TAXONOMY_VERSION } from "@/lib/intelligence/taxonomy";
import { EMBEDDING_MODEL, embeddingContentHash } from "@/lib/intelligence/embed";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Tenant AI rules changed. Numerical summaries stay. Ready insight reports
 * for this workspace are marked stale and a bounded set of report jobs is queued.
 */
export async function noteTenantRulesChange(admin: Admin, workspaceId: string, rulesHash: string): Promise<void> {
  const { data: reports, error } = await admin
    .from("grm_insight_reports")
    .select("id, summary_id")
    .eq("workspace_id", workspaceId)
    .eq("prompt_version", INSIGHT_PROMPT_VERSION)
    .eq("status", "ready")
    .limit(50);
  if (error) {
    logger.warn("intelligence.rules_reports_unavailable", { message: error.message });
    return;
  }
  const ids = (reports ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const { error: staleError } = await admin
      .from("grm_insight_reports")
      .update({ status: "stale" })
      .eq("workspace_id", workspaceId)
      .in("id", ids)
      .eq("status", "ready");
    if (staleError) logger.warn("intelligence.rules_stale_failed", { message: staleError.message });
  }
  const plan = planInvalidation({
    kind: "tenant_rules_changed",
    rulesHash,
    summaryIds: [...new Set((reports ?? []).map((row) => row.summary_id))],
  });
  for (const job of plan.jobs) {
    const { error: enqueueError } = await admin.from("grm_intelligence_jobs").insert({
      workspace_id: workspaceId,
      operation: job.operation,
      status: "queued",
      summary_id: job.summaryId,
      source_hash: job.sourceHash,
      analysis_version: job.analysisVersion,
    });
    if (enqueueError && enqueueError.code !== "23505") {
      logger.warn("intelligence.rules_enqueue_failed", { message: enqueueError.message });
    }
  }
}

/** Bounded repair pass. Safe to run again. Missing tables are reported and skipped. */
export async function runFreshnessPass(admin: Admin, workspaceId: string): Promise<{ staleReports: number; jobs: number } | null> {
  const now = new Date().toISOString();
  const { data: reviews, error: reviewError } = await admin
    .from("grm_reviews")
    .select("id, location_id, comment, content_fingerprint, missing_on_google_at")
    .eq("workspace_id", workspaceId)
    .order("id", { ascending: true })
    .limit(200);
  if (reviewError) {
    logger.warn("intelligence.freshness_unavailable", { message: reviewError.message });
    return null;
  }
  const reviewIds = (reviews ?? []).map((row) => row.id);
  const { data: intelligence } = reviewIds.length
    ? await admin
        .from("grm_review_intelligence")
        .select("review_id, content_hash, taxonomy_version, status")
        .eq("workspace_id", workspaceId)
        .in("review_id", reviewIds)
        .eq("is_current", true)
    : { data: [] };
  const { data: embeddings } = reviewIds.length
    ? await admin.from("grm_review_embeddings").select("review_id, content_hash, model").eq("workspace_id", workspaceId).in("review_id", reviewIds)
    : { data: [] };
  const { data: summaries } = await admin
    .from("grm_scope_summaries")
    .select("id, status, source_hash, taxonomy_version")
    .eq("workspace_id", workspaceId)
    .limit(100);
  const summaryIds = (summaries ?? []).map((row) => row.id);
  const { data: snapshots } = summaryIds.length
    ? await admin.from("grm_metric_snapshots").select("id, summary_id, inputs_hash").eq("workspace_id", workspaceId).in("summary_id", summaryIds)
    : { data: [] };
  const { data: reports } = await admin
    .from("grm_insight_reports")
    .select("id, summary_id, status, metrics, prompt_version")
    .eq("workspace_id", workspaceId)
    .eq("prompt_version", INSIGHT_PROMPT_VERSION)
    .limit(100);
  const { data: jobs } = await admin
    .from("grm_intelligence_jobs")
    .select("id, status, attempts, max_attempts, started_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["running", "failed"])
    .limit(100);
  const plan = reconcileFreshness({
    now,
    taxonomyVersion: TAXONOMY_VERSION,
    embeddingModel: EMBEDDING_MODEL,
    insightPrompt: INSIGHT_PROMPT_VERSION,
    reviews: (reviews ?? []).map((row) => ({
      id: row.id,
      locationId: row.location_id,
      contentHash: row.content_fingerprint ?? "",
      textHash: embeddingContentHash(row.comment ?? ""),
      missing: Boolean(row.missing_on_google_at),
    })),
    intelligence: (intelligence ?? []).map((row) => ({
      reviewId: row.review_id,
      contentHash: row.content_hash,
      taxonomyVersion: row.taxonomy_version,
      status: row.status,
    })),
    embeddings: (embeddings ?? []).map((row) => ({ reviewId: row.review_id, contentHash: row.content_hash, model: row.model })),
    summaries: (summaries ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      sourceHash: row.source_hash,
      taxonomyVersion: row.taxonomy_version,
    })),
    snapshots: (snapshots ?? []).map((row) => ({ id: row.id, summaryId: row.summary_id, inputsHash: row.inputs_hash })),
    reports: (reports ?? []).map((row) => {
      const metrics = row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics) ? row.metrics as { summarySourceHash?: string } : null;
      return {
        id: row.id,
        summaryId: row.summary_id,
        status: row.status,
        summarySourceHash: metrics?.summarySourceHash ?? null,
        promptVersion: row.prompt_version,
        evidenceReviewIds: [],
      };
    }),
    jobs: (jobs ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      startedAt: row.started_at,
    })),
  });
  if (plan.staleReportIds.length > 0) {
    await admin.from("grm_insight_reports").update({ status: "stale" }).eq("workspace_id", workspaceId).in("id", plan.staleReportIds).eq("status", "ready");
  }
  if (plan.staleSummaryIds.length > 0) {
    await admin.from("grm_scope_summaries").update({ status: "stale" }).eq("workspace_id", workspaceId).in("id", plan.staleSummaryIds).eq("status", "ready");
  }
  for (const job of plan.jobs) {
    const { error } = await admin.from("grm_intelligence_jobs").insert({
      workspace_id: workspaceId,
      operation: job.operation,
      status: "queued",
      review_id: job.reviewId,
      location_id: job.locationId,
      summary_id: job.summaryId,
      source_hash: job.sourceHash,
      analysis_version: job.analysisVersion,
    });
    if (error && error.code !== "23505") logger.warn("intelligence.freshness_enqueue_failed", { message: error.message });
  }
  logger.info("intelligence.freshness_pass", {
    workspaceId,
    missingIntelligence: plan.missingIntelligenceReviewIds.length,
    staleReports: plan.staleReportIds.length,
    outdatedSnapshots: plan.outdatedSnapshotIds.length,
    abandoned: plan.abandonedRecovered,
    failedJobs: plan.failedJobIds.length,
    queued: plan.jobs.length,
  });
  return { staleReports: plan.staleReportIds.length, jobs: plan.jobs.length };
}
