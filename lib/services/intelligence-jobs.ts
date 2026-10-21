import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { executeClassifyJob, type ClassifyReview } from "@/lib/intelligence/classify-job";
import { contentFingerprint, responseFingerprint } from "@/lib/intelligence/fingerprint";
import {
  publicProcessingStatus,
  type IntelligenceJob,
  type IntelligenceJobStatus,
  type PublicProcessingStatus,
} from "@/lib/intelligence/job-machine";
import { reconcileSnapshot, type ReconcileIntelligence, type ReconcileReview, type ReconcileSummary } from "@/lib/intelligence/reconcile";
import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import { commitValidatedExtraction, invalidateLocationSummaries } from "@/lib/services/intelligence-ingest";
import { extractReviewForJob } from "@/lib/services/intelligence-extract";

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 200;
const PROCESS_BATCH = 20;

interface JobRow {
  id: string;
  workspace_id: string;
  operation: string;
  status: IntelligenceJobStatus;
  attempts: number;
  max_attempts: number;
  error_class: string | null;
  last_error: string | null;
  review_id: string | null;
  location_id: string | null;
  source_hash: string | null;
  analysis_version: string | null;
  not_before: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function toJob(row: JobRow): IntelligenceJob | null {
  if (row.operation !== "classify_review" || !row.review_id || !row.location_id || !row.source_hash) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    operation: "classify_review",
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    errorClass: row.error_class,
    lastError: row.last_error,
    reviewId: row.review_id,
    locationId: row.location_id,
    sourceHash: row.source_hash,
    analysisVersion: row.analysis_version ?? "",
    notBefore: row.not_before,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

async function persistJob(admin: Admin, job: IntelligenceJob): Promise<void> {
  const { error } = await admin
    .from("grm_intelligence_jobs")
    .update({
      status: job.status,
      attempts: job.attempts,
      error_class: job.errorClass,
      last_error: job.lastError,
      not_before: job.notBefore,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      analysis_version: job.analysisVersion,
    })
    .eq("id", job.id)
    .eq("workspace_id", job.workspaceId);
  if (error) throw new Error(error.message);
}

export interface MaintenanceReport {
  workspaceId: string;
  missingReviews: number;
  obsoleteReviews: number;
  missingReviewIds: string[];
  obsoleteReviewIds: string[];
  abandonedRecovered: number;
  failedJobs: number;
  summariesMarkedStale: number;
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsCancelled: number;
  processed: number;
  statusCounts: Record<PublicProcessingStatus, number>;
}

/**
 * Reconcile one workspace, then run due classify jobs.
 * A job is marked succeeded only inside executeClassifyJob after the validated extraction is committed.
 */
export async function runIntelligenceMaintenance(workspaceId: string): Promise<MaintenanceReport> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const reviews: ReconcileReview[] = [];
  // Page until a short page arrives. A fixed page cap would leave every
  // review past the cap unreconciled and its summary permanently stale.
  for (let page = 0; ; page += 1) {
    const { data, error } = await admin
      .from("grm_reviews")
      .select(
        "id, location_id, star_rating, comment, review_create_time, google_reply_comment, content_fingerprint, response_fingerprint, missing_on_google_at, downstream_stale_at"
      )
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const content =
        row.content_fingerprint ??
        contentFingerprint({
          starRating: row.star_rating,
          comment: row.comment,
          createTime: row.review_create_time,
        });
      const response = row.response_fingerprint ?? responseFingerprint(row.google_reply_comment);
      if (!row.content_fingerprint || !row.response_fingerprint) {
        await admin
          .from("grm_reviews")
          .update({ content_fingerprint: content, response_fingerprint: response })
          .eq("id", row.id)
          .eq("workspace_id", workspaceId);
      }
      reviews.push({
        id: row.id,
        locationId: row.location_id,
        contentFingerprint: content,
        missingOnGoogleAt: row.missing_on_google_at,
        downstreamStaleAt: row.downstream_stale_at,
      });
    }
    if (rows.length < PAGE) break;
  }

  const reviewIds = reviews.map((review) => review.id);
  const intelligence: ReconcileIntelligence[] = [];
  // Chunk the id list: one request for every review in a large workspace
  // exceeds URL limits and the 1,000-row response cap.
  for (let offset = 0; offset < reviewIds.length; offset += PAGE) {
    const { data, error } = await admin
      .from("grm_review_intelligence")
      .select("id, review_id, content_hash, analysis_version, is_current, status, created_at")
      .eq("workspace_id", workspaceId)
      .in("review_id", reviewIds.slice(offset, offset + PAGE));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      intelligence.push({
        id: row.id,
        reviewId: row.review_id,
        contentHash: row.content_hash,
        analysisVersion: row.analysis_version,
        isCurrent: row.is_current,
        status: row.status,
        createdAt: row.created_at,
      });
    }
  }

  const { data: jobRows, error: jobError } = await admin
    .from("grm_intelligence_jobs")
    .select(
      "id, workspace_id, operation, status, attempts, max_attempts, error_class, last_error, review_id, location_id, source_hash, analysis_version, not_before, started_at, finished_at, created_at"
    )
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "running", "failed"]);
  if (jobError) throw new Error(jobError.message);
  const jobs = (jobRows ?? []).map((row) => toJob(row as JobRow)).filter((job): job is IntelligenceJob => job !== null);

  const { data: summaryRows, error: summaryError } = await admin
    .from("grm_scope_summaries")
    .select("id, status, location_id, member_location_ids, generated_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready");
  if (summaryError) throw new Error(summaryError.message);
  const summaries: ReconcileSummary[] = (summaryRows ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    locationId: row.location_id,
    memberLocationIds: row.member_location_ids ?? [],
    generatedAt: row.generated_at,
  }));

  const result = reconcileSnapshot({ workspaceId, now, reviews, intelligence, jobs, summaries });

  if (result.staleIntelligenceIds.length > 0) {
    await admin
      .from("grm_review_intelligence")
      .update({ is_current: false, status: "stale" })
      .eq("workspace_id", workspaceId)
      .in("id", result.staleIntelligenceIds);
  }
  if (result.staleSummaryIds.length > 0) {
    await admin.from("grm_scope_summaries").update({ status: "stale" }).in("id", result.staleSummaryIds);
    await admin
      .from("grm_insight_reports")
      .update({ status: "stale" })
      .eq("workspace_id", workspaceId)
      .in("summary_id", result.staleSummaryIds)
      .eq("status", "ready");
  }
  for (const item of result.enqueued) {
    const { error } = await admin.from("grm_intelligence_jobs").insert({
      workspace_id: workspaceId,
      operation: "classify_review",
      status: "queued",
      review_id: item.reviewId,
      location_id: item.locationId,
      source_hash: item.sourceHash,
      analysis_version: EXTRACT_ANALYSIS_VERSION,
    });
    if (error && error.code !== "23505") {
      logger.error("intelligence.enqueue_failed", { reviewId: item.reviewId, message: error.message });
    }
  }
  for (const job of result.jobs) {
    const before = jobs.find((row) => row.id === job.id);
    if (!before || before.status !== job.status || before.attempts !== job.attempts || before.notBefore !== job.notBefore) {
      await persistJob(admin, job);
    }
  }

  try {
    const { runFreshnessPass } = await import("@/lib/services/intelligence-freshness");
    await runFreshnessPass(admin, workspaceId);
  } catch (error) {
    logger.error("intelligence.freshness_pass_failed", {
      message: error instanceof Error ? error.message : "freshness pass failed",
    });
  }
  const processed = await processDueJobs(admin, workspaceId, PROCESS_BATCH);
  try {
    const { processSummaryJobs } = await import("@/lib/services/summary-service");
    await processSummaryJobs(admin, workspaceId);
  } catch (error) {
    logger.error("intelligence.summary_pass_failed", {
      message: error instanceof Error ? error.message : "summary pass failed",
    });
  }
  try {
    const { processEmbedJobs, rebuildWorkspaceClusters } = await import("@/lib/services/intelligence-embed");
    const embedded = await processEmbedJobs(admin, workspaceId);
    if (embedded.stored > 0) await rebuildWorkspaceClusters(admin, workspaceId);
  } catch (error) {
    logger.error("intelligence.cluster_pass_failed", {
      message: error instanceof Error ? error.message : "cluster pass failed",
    });
  }
  const statusCounts = emptyStatusCounts();
  for (const job of result.jobs) {
    statusCounts[publicProcessingStatus(job, now)] += 1;
  }

  return {
    workspaceId,
    missingReviews: result.missingReviewIds.length,
    obsoleteReviews: result.obsoleteReviewIds.length,
    missingReviewIds: result.missingReviewIds,
    obsoleteReviewIds: result.obsoleteReviewIds,
    abandonedRecovered: result.abandonedRecovered,
    failedJobs: result.failedJobIds.length,
    summariesMarkedStale: result.staleSummaryIds.length,
    jobsEnqueued: result.enqueued.length,
    jobsCompleted: result.completedJobIds.length,
    jobsCancelled: result.cancelledJobIds.length,
    processed,
    statusCounts,
  };
}

function emptyStatusCounts(): Record<PublicProcessingStatus, number> {
  return { pending: 0, processing: 0, completed: 0, failed: 0, retry_scheduled: 0, cancelled: 0 };
}

async function processDueJobs(admin: Admin, workspaceId: string, limit: number): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("grm_intelligence_jobs")
    .select(
      "id, workspace_id, operation, status, attempts, max_attempts, error_class, last_error, review_id, location_id, source_hash, analysis_version, not_before, started_at, finished_at, created_at"
    )
    .eq("workspace_id", workspaceId)
    .eq("operation", "classify_review")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit * 5);
  if (error) throw new Error(error.message);
  const due = (data ?? [])
    .map((row) => toJob(row as JobRow))
    .filter((job): job is IntelligenceJob => job !== null)
    .filter((job) => !job.notBefore || job.notBefore <= now)
    .slice(0, limit);
  let processed = 0;
  for (const listed of due) {
    let reviewModel = "none";
    await executeClassifyJob(listed.id, {
      now: () => new Date().toISOString(),
      claim: async (jobId) => {
        const claimedAt = new Date().toISOString();
        const { data: claimed, error: claimError } = await admin
          .from("grm_intelligence_jobs")
          .update({ status: "running", started_at: claimedAt })
          .eq("id", jobId)
          .eq("workspace_id", workspaceId)
          .eq("status", "queued")
          .select(
            "id, workspace_id, operation, status, attempts, max_attempts, error_class, last_error, review_id, location_id, source_hash, analysis_version, not_before, started_at, finished_at, created_at"
          )
          .maybeSingle();
        if (claimError) throw new Error(claimError.message);
        return claimed ? toJob(claimed as JobRow) : null;
      },
      saveJob: async (job) => {
        await persistJob(admin, job);
      },
      loadReview: async (reviewId, ws) => loadClassifyReview(admin, reviewId, ws),
      extract: async (review) => {
        const result = await extractReviewForJob(admin, review);
        reviewModel = result.model;
        return result.extraction;
      },
      commitIntelligence: async (review, extraction) => {
        await commitValidatedExtraction(admin, review, extraction, reviewModel);
        await invalidateLocationSummaries(admin, review.workspaceId, review.locationId);
      },
    });
    processed += 1;
  }
  return processed;
}

async function loadClassifyReview(admin: Admin, reviewId: string, workspaceId: string): Promise<ClassifyReview | null> {
  const { data, error } = await admin
    .from("grm_reviews")
    .select("id, workspace_id, location_id, star_rating, comment, review_create_time, content_fingerprint, missing_on_google_at")
    .eq("id", reviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    locationId: data.location_id,
    starRating: data.star_rating,
    comment: data.comment,
    missingOnGoogleAt: data.missing_on_google_at,
    contentFingerprint:
      data.content_fingerprint ??
      contentFingerprint({
        starRating: data.star_rating,
        comment: data.comment,
        createTime: data.review_create_time,
      }),
  };
}
