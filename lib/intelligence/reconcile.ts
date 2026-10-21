import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import {
  cancelJob,
  enqueueClassifyJob,
  isOpenStatus,
  jobKey,
  recoverAbandonedJobs,
  succeedJob,
  type IntelligenceJob,
} from "@/lib/intelligence/job-machine";

export interface ReconcileReview {
  id: string;
  locationId: string;
  contentFingerprint: string;
  missingOnGoogleAt: string | null;
  downstreamStaleAt: string | null;
}

export interface ReconcileIntelligence {
  id: string;
  reviewId: string;
  contentHash: string;
  analysisVersion: string;
  isCurrent: boolean;
  status: string;
  createdAt: string;
}

export interface ReconcileSummary {
  id: string;
  status: string;
  locationId: string | null;
  memberLocationIds: string[];
  generatedAt: string | null;
}

export interface ReconcileSnapshot {
  workspaceId: string;
  now: string;
  reviews: ReconcileReview[];
  intelligence: ReconcileIntelligence[];
  jobs: IntelligenceJob[];
  summaries: ReconcileSummary[];
}

export interface ReconcileResult {
  jobs: IntelligenceJob[];
  staleIntelligenceIds: string[];
  staleSummaryIds: string[];
  enqueued: Array<{ reviewId: string; locationId: string; sourceHash: string; jobId: string }>;
  completedJobIds: string[];
  cancelledJobIds: string[];
  abandonedRecovered: number;
  missingReviewIds: string[];
  obsoleteReviewIds: string[];
  failedJobIds: string[];
}

let enqueueSeq = 0;

function nextId(): string {
  enqueueSeq += 1;
  return `reconcile-${enqueueSeq}`;
}

/** Reset only in tests that assert exact generated ids. */
export function resetReconcileIds(): void {
  enqueueSeq = 0;
}

function currentFor(
  rows: readonly ReconcileIntelligence[],
  reviewId: string,
  analysisVersion: string
): ReconcileIntelligence[] {
  return rows.filter((row) => row.reviewId === reviewId && row.analysisVersion === analysisVersion && row.isCurrent);
}

/**
 * Safe to run again. The second pass on the returned jobs and stale ids finds nothing new
 * once the caller has applied the result.
 */
export function reconcileSnapshot(snapshot: ReconcileSnapshot, ids: () => string = nextId): ReconcileResult {
  const recovered = recoverAbandonedJobs(snapshot.jobs, snapshot.now);
  let jobs = recovered.jobs;
  const cancelledJobIds: string[] = [];

  const openByKey = new Map<string, IntelligenceJob[]>();
  for (const job of jobs) {
    if (!isOpenStatus(job.status)) continue;
    const key = jobKey(job);
    const list = openByKey.get(key) ?? [];
    list.push(job);
    openByKey.set(key, list);
  }
  for (const group of openByKey.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const extra of ordered.slice(1)) {
      jobs = cancelJob(jobs, extra.id, "Duplicate open job", snapshot.now);
      cancelledJobIds.push(extra.id);
    }
  }

  const staleIntelligenceIds: string[] = [];
  const obsoleteReviewIds: string[] = [];
  const missingReviewIds: string[] = [];
  const enqueued: ReconcileResult["enqueued"] = [];
  const completedJobIds: string[] = [];

  for (const review of snapshot.reviews) {
    const currents = currentFor(snapshot.intelligence, review.id, EXTRACT_ANALYSIS_VERSION);
    const matching = currents.filter((row) => row.contentHash === review.contentFingerprint && row.status === "ready");
    const obsolete = currents.filter((row) => row.contentHash !== review.contentFingerprint || row.status !== "ready");
    if (currents.length > 1) {
      const keep = matching[0] ?? currents[0];
      for (const row of currents) {
        if (row.id !== keep.id) staleIntelligenceIds.push(row.id);
      }
    }
    for (const row of obsolete) {
      if (!staleIntelligenceIds.includes(row.id)) staleIntelligenceIds.push(row.id);
    }
    if (obsolete.length > 0) obsoleteReviewIds.push(review.id);

    const hasCurrent = matching.length > 0 && !review.missingOnGoogleAt;
    if (review.missingOnGoogleAt) {
      for (const row of matching) {
        if (!staleIntelligenceIds.includes(row.id)) staleIntelligenceIds.push(row.id);
      }
    }

    if (!review.missingOnGoogleAt && !hasCurrent) {
      missingReviewIds.push(review.id);
      const queued = enqueueClassifyJob(jobs, {
        id: ids(),
        workspaceId: snapshot.workspaceId,
        reviewId: review.id,
        locationId: review.locationId,
        sourceHash: review.contentFingerprint,
        now: snapshot.now,
      });
      jobs = queued.jobs;
      if (queued.created) {
        enqueued.push({
          reviewId: review.id,
          locationId: review.locationId,
          sourceHash: review.contentFingerprint,
          jobId: queued.job.id,
        });
      }
    }

    if (hasCurrent) {
      for (const job of jobs) {
        if (!isOpenStatus(job.status)) continue;
        if (job.reviewId !== review.id || job.sourceHash !== review.contentFingerprint) continue;
        if (job.analysisVersion !== EXTRACT_ANALYSIS_VERSION) continue;
        jobs = succeedJob(jobs, job.id, snapshot.now);
        completedJobIds.push(job.id);
      }
    }
  }

  const reviewsByLocation = new Map<string, ReconcileReview[]>();
  for (const review of snapshot.reviews) {
    const list = reviewsByLocation.get(review.locationId) ?? [];
    list.push(review);
    reviewsByLocation.set(review.locationId, list);
  }
  const staleSummaryIds: string[] = [];
  for (const summary of snapshot.summaries) {
    if (summary.status !== "ready") continue;
    const locationIds = new Set(summary.memberLocationIds);
    if (summary.locationId) locationIds.add(summary.locationId);
    const generated = summary.generatedAt ? Date.parse(summary.generatedAt) : Number.NEGATIVE_INFINITY;
    let stale = false;
    for (const locationId of locationIds) {
      for (const review of reviewsByLocation.get(locationId) ?? []) {
        if (review.downstreamStaleAt && Date.parse(review.downstreamStaleAt) > generated) stale = true;
        if (review.missingOnGoogleAt) stale = true;
        const currents = currentFor(snapshot.intelligence, review.id, EXTRACT_ANALYSIS_VERSION);
        const ready = currents.some((row) => row.contentHash === review.contentFingerprint && row.status === "ready");
        if (!review.missingOnGoogleAt && !ready) stale = true;
      }
    }
    if (stale) staleSummaryIds.push(summary.id);
  }

  return {
    jobs,
    staleIntelligenceIds,
    staleSummaryIds,
    enqueued,
    completedJobIds,
    cancelledJobIds,
    abandonedRecovered: recovered.recovered,
    missingReviewIds,
    obsoleteReviewIds,
    failedJobIds: jobs.filter((job) => job.status === "failed").map((job) => job.id),
  };
}
