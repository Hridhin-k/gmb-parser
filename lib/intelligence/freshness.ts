import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import { INSIGHT_PROMPT_VERSION } from "@/lib/intelligence/insight";
import { SUMMARY_ANALYSIS_VERSION } from "@/lib/intelligence/summary-aggregate";
import { TAXONOMY_VERSION } from "@/lib/intelligence/taxonomy";

/**
 * Dependency chain. A change walks only as far as its boundary.
 *
 * Source review
 * → review intelligence (extract-v1, keyed by the content fingerprint)
 * → topic assignment, then an embedding of the comment text
 * → semantic cluster (topics plus embeddings)
 * → scope summary
 * → metric snapshot
 * → insight report
 *
 * Configuration joins at the step that reads it. Taxonomy and the extraction
 * model sit on review intelligence. The embedding model sits on embeddings.
 * Group membership sits on the summary. Tenant AI rules and the insight prompt
 * sit on the insight report. They do not move review_count or average_rating.
 */

export const FRESHNESS_ENQUEUE_CAP = 20;

export const FRESHNESS_LABELS = [
  "current",
  "refresh_pending",
  "processing",
  "partially_updated",
  "stale",
  "failed",
  "insufficient_data",
] as const;

export type FreshnessLabel = (typeof FRESHNESS_LABELS)[number];

export type FreshnessArtifact =
  | "intelligence"
  | "embedding"
  | "cluster"
  | "summary"
  | "metric_snapshot"
  | "insight_report";

export type FreshnessChange =
  | { kind: "review_inserted"; reviewId: string; locationId: string; contentHash: string; hasText: boolean }
  | { kind: "review_text_changed"; reviewId: string; locationId: string; contentHash: string; textHash: string }
  | { kind: "review_rating_changed"; reviewId: string; locationId: string; contentHash: string }
  | { kind: "review_date_changed"; reviewId: string; locationId: string; contentHash: string }
  | { kind: "review_deleted"; reviewId: string; locationId: string }
  | { kind: "membership_changed"; locationIds: readonly string[] }
  | { kind: "taxonomy_changed"; taxonomyVersion: string; reviewIds: readonly { reviewId: string; locationId: string; contentHash: string }[] }
  | { kind: "embedding_model_changed"; model: string; reviewIds: readonly { reviewId: string; locationId: string; textHash: string }[] }
  | { kind: "insight_prompt_changed"; promptVersion: string; summaryIds: readonly string[] }
  | { kind: "tenant_rules_changed"; rulesHash: string; summaryIds: readonly string[] };

export interface PlannedJob {
  operation: "classify_review" | "embed_review" | "build_summary" | "build_report" | "backfill";
  reviewId: string | null;
  locationId: string | null;
  summaryId: string | null;
  sourceHash: string;
  analysisVersion: string;
}

export interface InvalidationPlan {
  boundary: string;
  stale: FreshnessArtifact[];
  untouched: FreshnessArtifact[];
  jobs: PlannedJob[];
  /** review_count and average_rating stay valid. Topic shares may not. */
  metricsStayValid: boolean;
  rebuildClusters: boolean;
}

const ALL: FreshnessArtifact[] = ["intelligence", "embedding", "cluster", "summary", "metric_snapshot", "insight_report"];

function except(stale: FreshnessArtifact[]): FreshnessArtifact[] {
  return ALL.filter((item) => !stale.includes(item));
}

function dedupeJobs(jobs: PlannedJob[]): PlannedJob[] {
  const seen = new Set<string>();
  const out: PlannedJob[] = [];
  for (const job of jobs) {
    const key = [job.operation, job.reviewId ?? "", job.summaryId ?? "", job.sourceHash].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

function capJobs(jobs: PlannedJob[], backfillHash: string, analysisVersion: string): PlannedJob[] {
  const unique = dedupeJobs(jobs);
  if (unique.length <= FRESHNESS_ENQUEUE_CAP) return unique;
  return [
    ...unique.slice(0, FRESHNESS_ENQUEUE_CAP),
    {
      operation: "backfill",
      reviewId: null,
      locationId: null,
      summaryId: null,
      sourceHash: backfillHash,
      analysisVersion,
    },
  ];
}

function summaryJob(locationId: string, sourceHash: string): PlannedJob {
  return {
    operation: "build_summary",
    reviewId: null,
    locationId,
    summaryId: null,
    sourceHash,
    analysisVersion: SUMMARY_ANALYSIS_VERSION,
  };
}

/** Smallest recalculation for one change. Equivalent jobs are already collapsed. */
export function planInvalidation(change: FreshnessChange): InvalidationPlan {
  switch (change.kind) {
    case "review_inserted": {
      const jobs: PlannedJob[] = [
        {
          operation: "classify_review",
          reviewId: change.reviewId,
          locationId: change.locationId,
          summaryId: null,
          sourceHash: change.contentHash,
          analysisVersion: EXTRACT_ANALYSIS_VERSION,
        },
        summaryJob(change.locationId, change.reviewId),
      ];
      if (change.hasText) {
        jobs.splice(1, 0, {
          operation: "embed_review",
          reviewId: change.reviewId,
          locationId: change.locationId,
          summaryId: null,
          sourceHash: change.contentHash,
          analysisVersion: "embed-v1",
        });
      }
      const stale: FreshnessArtifact[] = change.hasText
        ? ["summary", "metric_snapshot", "insight_report", "cluster"]
        : ["summary", "metric_snapshot", "insight_report"];
      return {
        boundary: "Process this review, then the summaries whose membership contains its location.",
        stale,
        untouched: except(stale),
        jobs,
        metricsStayValid: false,
        rebuildClusters: change.hasText,
      };
    }
    case "review_text_changed":
      return {
        boundary: "Reclassify this review and embed its new text. Refresh summaries for its location.",
        stale: ALL,
        untouched: [],
        jobs: [
          {
            operation: "classify_review",
            reviewId: change.reviewId,
            locationId: change.locationId,
            summaryId: null,
            sourceHash: change.contentHash,
            analysisVersion: EXTRACT_ANALYSIS_VERSION,
          },
          {
            operation: "embed_review",
            reviewId: change.reviewId,
            locationId: change.locationId,
            summaryId: null,
            sourceHash: change.textHash,
            analysisVersion: "embed-v1",
          },
          summaryJob(change.locationId, change.reviewId),
        ],
        metricsStayValid: false,
        rebuildClusters: true,
      };
    case "review_rating_changed":
      return {
        boundary: "The review row is the rating source. Refresh summaries, metric snapshots, and insight reports. Do not re-embed or call the model.",
        stale: ["summary", "metric_snapshot", "insight_report"],
        untouched: ["intelligence", "embedding", "cluster"],
        jobs: [summaryJob(change.locationId, change.contentHash)],
        metricsStayValid: false,
        rebuildClusters: false,
      };
    case "review_date_changed":
      return {
        boundary: "The date moves which windows include the review. Refresh those summaries. The text and embedding stay.",
        stale: ["summary", "metric_snapshot", "insight_report"],
        untouched: ["intelligence", "embedding", "cluster"],
        jobs: [summaryJob(change.locationId, change.contentHash)],
        metricsStayValid: false,
        rebuildClusters: false,
      };
    case "review_deleted":
      return {
        boundary: "Drop this review from its summaries and from findings that cite it. Do not classify it again.",
        stale: ["intelligence", "cluster", "summary", "metric_snapshot", "insight_report"],
        untouched: ["embedding"],
        jobs: [summaryJob(change.locationId, change.reviewId)],
        metricsStayValid: false,
        rebuildClusters: true,
      };
    case "membership_changed":
      return {
        boundary: "Refresh summaries and insight reports for the moved locations. Reviews, embeddings, and clusters stay.",
        stale: ["summary", "metric_snapshot", "insight_report"],
        untouched: ["intelligence", "embedding", "cluster"],
        jobs: capJobs(
          change.locationIds.map((locationId) => summaryJob(locationId, `membership:${locationId}`)),
          "membership",
          SUMMARY_ANALYSIS_VERSION
        ),
        metricsStayValid: false,
        rebuildClusters: false,
      };
    case "taxonomy_changed":
      return {
        boundary: "Reclassify reviews still on the previous taxonomy. Embeddings stay. review_count and average_rating stay valid until a summary is rebuilt for topic shares.",
        stale: ["intelligence", "cluster", "summary", "insight_report"],
        untouched: ["embedding", "metric_snapshot"],
        jobs: capJobs(
          change.reviewIds.map((review) => ({
            operation: "classify_review" as const,
            reviewId: review.reviewId,
            locationId: review.locationId,
            summaryId: null,
            sourceHash: review.contentHash,
            analysisVersion: EXTRACT_ANALYSIS_VERSION,
          })),
          change.taxonomyVersion,
          EXTRACT_ANALYSIS_VERSION
        ),
        metricsStayValid: true,
        rebuildClusters: true,
      };
    case "embedding_model_changed":
      return {
        boundary: "Re-embed with the new model and rebuild clusters. Numerical rating metrics stay.",
        stale: ["embedding", "cluster", "insight_report"],
        untouched: ["intelligence", "summary", "metric_snapshot"],
        jobs: capJobs(
          change.reviewIds.map((review) => ({
            operation: "embed_review" as const,
            reviewId: review.reviewId,
            locationId: review.locationId,
            summaryId: null,
            sourceHash: review.textHash,
            analysisVersion: "embed-v1",
          })),
          change.model,
          "embed-v1"
        ),
        metricsStayValid: true,
        rebuildClusters: true,
      };
    case "insight_prompt_changed":
      return {
        boundary: "Regenerate insight reports for the new prompt. Summaries and metric snapshots stay.",
        stale: ["insight_report"],
        untouched: ["intelligence", "embedding", "cluster", "summary", "metric_snapshot"],
        jobs: capJobs(
          change.summaryIds.map((summaryId) => ({
            operation: "build_report" as const,
            reviewId: null,
            locationId: null,
            summaryId,
            sourceHash: change.promptVersion,
            analysisVersion: INSIGHT_PROMPT_VERSION,
          })),
          change.promptVersion,
          INSIGHT_PROMPT_VERSION
        ),
        metricsStayValid: true,
        rebuildClusters: false,
      };
    case "tenant_rules_changed":
      return {
        boundary: "Future insight prose uses the new rules. Existing numerical metrics and summaries stay. Completed reports need a new version.",
        stale: ["insight_report"],
        untouched: ["intelligence", "embedding", "cluster", "summary", "metric_snapshot"],
        jobs: capJobs(
          change.summaryIds.map((summaryId) => ({
            operation: "build_report" as const,
            reviewId: null,
            locationId: null,
            summaryId,
            sourceHash: change.rulesHash,
            analysisVersion: INSIGHT_PROMPT_VERSION,
          })),
          change.rulesHash,
          INSIGHT_PROMPT_VERSION
        ),
        metricsStayValid: true,
        rebuildClusters: false,
      };
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

/** A job may commit only when its source and analysis version are still the current ones. */
export function commitIsCurrent(
  job: { sourceHash: string; analysisVersion: string },
  current: { sourceHash: string; analysisVersion: string }
): boolean {
  return job.sourceHash === current.sourceHash && job.analysisVersion === current.analysisVersion;
}

/** Keep the stored star in line with the review row without a model call. */
export function alignStoredIntelligence(extraction: unknown, stars: number): unknown | null {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return null;
  const copy = structuredClone(extraction) as { facts?: { rating?: { stars?: number } } };
  if (copy.facts?.rating && typeof copy.facts.rating === "object") copy.facts.rating.stars = stars;
  return copy;
}

export interface FreshnessViewInput {
  summaryStatus: "ready" | "stale" | "pending" | "failed" | "missing";
  reportStatus: "ready" | "stale" | "pending" | "failed" | "missing";
  reportMatchesSummary: boolean;
  openJob: "none" | "queued" | "running";
  insufficient: boolean;
  metricsMatch: boolean;
  clustersCurrent: boolean;
  hasCompletedReport: boolean;
}

export function freshnessLabel(input: FreshnessViewInput): { label: FreshnessLabel; showPrevious: boolean } {
  const current = input.summaryStatus === "ready" && input.reportStatus === "ready" && input.reportMatchesSummary;
  if (input.summaryStatus === "failed" || (input.reportStatus === "failed" && !input.hasCompletedReport)) {
    return { label: "failed", showPrevious: false };
  }
  if (current && input.insufficient) return { label: "insufficient_data", showPrevious: false };
  if (input.openJob === "running") {
    return { label: "processing", showPrevious: !current && input.hasCompletedReport };
  }
  if (input.openJob === "queued" && !current) {
    return { label: "refresh_pending", showPrevious: input.hasCompletedReport };
  }
  if (current && input.metricsMatch && !input.clustersCurrent) {
    return { label: "partially_updated", showPrevious: false };
  }
  if (!current) return { label: "stale", showPrevious: input.hasCompletedReport };
  return { label: "current", showPrevious: false };
}

export const FRESHNESS_HEADLINES: Record<FreshnessLabel, string> = {
  current: "Current",
  refresh_pending: "Refresh pending",
  processing: "Processing",
  partially_updated: "Partially updated",
  stale: "Stale",
  failed: "Failed",
  insufficient_data: "Insufficient data",
};

export interface FreshnessReconcileInput {
  now: string;
  taxonomyVersion: string;
  embeddingModel: string;
  insightPrompt: string;
  reviews: readonly { id: string; locationId: string; contentHash: string; textHash: string; missing: boolean }[];
  intelligence: readonly { reviewId: string; contentHash: string; taxonomyVersion: string; status: string }[];
  embeddings: readonly { reviewId: string; contentHash: string; model: string }[];
  summaries: readonly { id: string; status: string; sourceHash: string; taxonomyVersion: string }[];
  snapshots: readonly { id: string; summaryId: string; inputsHash: string }[];
  reports: readonly { id: string; summaryId: string; status: string; summarySourceHash: string | null; promptVersion: string; evidenceReviewIds: readonly string[] }[];
  jobs: readonly { id: string; status: string; attempts: number; maxAttempts: number; startedAt: string | null }[];
}

export interface FreshnessReconcileResult {
  missingIntelligenceReviewIds: string[];
  staleSummaryIds: string[];
  outdatedSnapshotIds: string[];
  staleReportIds: string[];
  failedJobIds: string[];
  abandonedRecovered: number;
  jobs: PlannedJob[];
  rebuildClusters: boolean;
}

/**
 * Idempotent repair plan. Applying it and running again on the repaired
 * snapshot adds no further jobs.
 */
export function reconcileFreshness(input: FreshnessReconcileInput): FreshnessReconcileResult {
  const recoveredIds: string[] = [];
  const failedJobIds = input.jobs.filter((job) => job.status === "failed").map((job) => job.id);
  for (const job of input.jobs) {
    if (job.status !== "running" || !job.startedAt) continue;
    if (Date.parse(job.startedAt) + 2 * 60 * 1000 > Date.parse(input.now)) continue;
    recoveredIds.push(job.id);
    if (job.attempts + 1 >= job.maxAttempts && !failedJobIds.includes(job.id)) failedJobIds.push(job.id);
  }
  const missingIntelligenceReviewIds: string[] = [];
  const jobs: PlannedJob[] = [];
  for (const review of input.reviews) {
    if (review.missing) continue;
    const ready = input.intelligence.some(
      (row) =>
        row.reviewId === review.id &&
        row.contentHash === review.contentHash &&
        row.taxonomyVersion === input.taxonomyVersion &&
        row.status === "ready"
    );
    if (!ready) {
      missingIntelligenceReviewIds.push(review.id);
      jobs.push({
        operation: "classify_review",
        reviewId: review.id,
        locationId: review.locationId,
        summaryId: null,
        sourceHash: review.contentHash,
        analysisVersion: EXTRACT_ANALYSIS_VERSION,
      });
    }
    const embedded = input.embeddings.some(
      (row) => row.reviewId === review.id && row.contentHash === review.textHash && row.model === input.embeddingModel
    );
    if (!embedded && review.textHash) {
      jobs.push({
        operation: "embed_review",
        reviewId: review.id,
        locationId: review.locationId,
        summaryId: null,
        sourceHash: review.textHash,
        analysisVersion: "embed-v1",
      });
    }
  }
  const staleSummaryIds = input.summaries
    .filter((summary) => summary.status === "ready" && summary.taxonomyVersion !== input.taxonomyVersion)
    .map((summary) => summary.id);
  const summaryHash = new Map(input.summaries.map((summary) => [summary.id, summary.sourceHash]));
  const outdatedSnapshotIds = input.snapshots
    .filter((snapshot) => summaryHash.get(snapshot.summaryId) !== undefined && snapshot.inputsHash !== summaryHash.get(snapshot.summaryId))
    .map((snapshot) => snapshot.id);
  const liveReviewIds = new Set(input.reviews.filter((review) => !review.missing).map((review) => review.id));
  const staleReportIds = input.reports
    .filter((report) => {
      if (report.status !== "ready") return false;
      if (report.promptVersion !== input.insightPrompt) return true;
      const summary = input.summaries.find((item) => item.id === report.summaryId);
      if (!summary || summary.status !== "ready") return true;
      if (report.summarySourceHash && report.summarySourceHash !== summary.sourceHash) return true;
      return report.evidenceReviewIds.some((id) => !liveReviewIds.has(id));
    })
    .map((report) => report.id);
  return {
    missingIntelligenceReviewIds,
    staleSummaryIds,
    outdatedSnapshotIds,
    staleReportIds,
    failedJobIds,
    abandonedRecovered: recoveredIds.length,
    jobs: capJobs(jobs, TAXONOMY_VERSION, EXTRACT_ANALYSIS_VERSION),
    rebuildClusters: jobs.some((job) => job.operation === "embed_review" || job.operation === "classify_review"),
  };
}
