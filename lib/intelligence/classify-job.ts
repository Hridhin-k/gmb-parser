import { EXTRACT_ANALYSIS_VERSION, type ReviewExtraction } from "@/lib/intelligence/extraction";
import {
  cancelJob,
  failJob,
  processingErrorClass,
  publicProcessingStatus,
  succeedJob,
  type IntelligenceJob,
  type PublicProcessingStatus,
} from "@/lib/intelligence/job-machine";

export interface ClassifyReview {
  id: string;
  workspaceId: string;
  locationId: string;
  contentFingerprint: string;
  starRating: number;
  comment: string | null;
  missingOnGoogleAt: string | null;
}

export interface ClassifyDeps {
  now: () => string;
  /** Returns the running job only when this caller won the claim. */
  claim: (jobId: string) => Promise<IntelligenceJob | null>;
  saveJob: (job: IntelligenceJob) => Promise<void>;
  loadReview: (reviewId: string, workspaceId: string) => Promise<ClassifyReview | null>;
  /** Model call, or a rating-only record when the review has no text. Must not persist. */
  extract: (review: ClassifyReview) => Promise<ReviewExtraction>;
  /** Must resolve only after the intelligence row and summary invalidation are committed. */
  commitIntelligence: (review: ClassifyReview, extraction: ReviewExtraction) => Promise<void>;
}

/**
 * Claims the job, writes intelligence, then marks it succeeded.
 * A throw from commitIntelligence leaves the job queued for retry or terminally failed.
 */
export async function executeClassifyJob(jobId: string, deps: ClassifyDeps): Promise<PublicProcessingStatus> {
  const job = await deps.claim(jobId);
  if (!job) return "pending";

  try {
    const review = await deps.loadReview(job.reviewId, job.workspaceId);
    if (!review || review.missingOnGoogleAt) {
      const [cancelled] = cancelJob([job], job.id, "Review is unavailable", deps.now());
      if (cancelled) await deps.saveJob(cancelled);
      return "cancelled";
    }
    if (review.contentFingerprint !== job.sourceHash || job.analysisVersion !== EXTRACT_ANALYSIS_VERSION) {
      const [cancelled] = cancelJob([job], job.id, "Superseded by a newer review version", deps.now());
      if (cancelled) await deps.saveJob(cancelled);
      return "cancelled";
    }
    const extraction = await deps.extract(review);
    if (extraction.analysisVersion !== EXTRACT_ANALYSIS_VERSION) {
      throw new Error(`invalid_response: extraction version was not ${EXTRACT_ANALYSIS_VERSION}`);
    }
    await deps.commitIntelligence(review, extraction);
    const [done] = succeedJob([job], job.id, deps.now());
    if (done) await deps.saveJob(done);
    return "completed";
  } catch (error) {
    const failed = failJob([job], job.id, {
      errorClass: processingErrorClass(error),
      message: error instanceof Error ? error.message : "Processing failed",
      now: deps.now(),
    });
    if (failed.job) await deps.saveJob(failed.job);
    return failed.job ? publicProcessingStatus(failed.job, deps.now()) : "failed";
  }
}
