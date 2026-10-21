import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";

export type IntelligenceJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Statuses operators can trust. Database rows keep the Phase 1 words. */
export type PublicProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "retry_scheduled"
  | "cancelled";

export interface IntelligenceJob {
  id: string;
  workspaceId: string;
  operation: "classify_review";
  status: IntelligenceJobStatus;
  attempts: number;
  maxAttempts: number;
  errorClass: string | null;
  lastError: string | null;
  reviewId: string;
  locationId: string;
  sourceHash: string;
  analysisVersion: string;
  notBefore: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export const JOB_LEASE_MS = 2 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export function publicProcessingStatus(job: IntelligenceJob, now: string): PublicProcessingStatus {
  if (job.status === "queued") {
    if (job.attempts > 0 && job.notBefore && Date.parse(job.notBefore) > Date.parse(now)) {
      return "retry_scheduled";
    }
    return "pending";
  }
  if (job.status === "running") return "processing";
  if (job.status === "succeeded") return "completed";
  if (job.status === "failed") return "failed";
  return "cancelled";
}

export function backoffMs(attemptsAfterFailure: number): number {
  const exponent = Math.max(0, attemptsAfterFailure - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

export function jobKey(job: Pick<IntelligenceJob, "workspaceId" | "operation" | "reviewId" | "sourceHash">): string {
  return `${job.workspaceId}|${job.operation}|${job.reviewId}|${job.sourceHash}`;
}

export function isOpenStatus(status: IntelligenceJobStatus): boolean {
  return status === "queued" || status === "running";
}

/** Repeated sync of the same review version reuses the open job. */
export function enqueueClassifyJob(
  jobs: readonly IntelligenceJob[],
  input: {
    id: string;
    workspaceId: string;
    reviewId: string;
    locationId: string;
    sourceHash: string;
    now: string;
    maxAttempts?: number;
  }
): { jobs: IntelligenceJob[]; job: IntelligenceJob; created: boolean } {
  const existing = jobs.find(
    (job) =>
      isOpenStatus(job.status) &&
      job.workspaceId === input.workspaceId &&
      job.operation === "classify_review" &&
      job.reviewId === input.reviewId &&
      job.sourceHash === input.sourceHash
  );
  if (existing) return { jobs: [...jobs], job: existing, created: false };
  const job: IntelligenceJob = {
    id: input.id,
    workspaceId: input.workspaceId,
    operation: "classify_review",
    status: "queued",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    errorClass: null,
    lastError: null,
    reviewId: input.reviewId,
    locationId: input.locationId,
    sourceHash: input.sourceHash,
    analysisVersion: EXTRACT_ANALYSIS_VERSION,
    notBefore: null,
    startedAt: null,
    finishedAt: null,
    createdAt: input.now,
  };
  return { jobs: [...jobs, job], job, created: true };
}

/** One worker wins. A second claim of the same queued job returns null. */
export function claimJob(
  jobs: readonly IntelligenceJob[],
  jobId: string,
  now: string
): { jobs: IntelligenceJob[]; claimed: IntelligenceJob | null } {
  const current = jobs.find((job) => job.id === jobId);
  if (!current || current.status !== "queued") return { jobs: [...jobs], claimed: null };
  if (current.notBefore && Date.parse(current.notBefore) > Date.parse(now)) {
    return { jobs: [...jobs], claimed: null };
  }
  const claimed: IntelligenceJob = { ...current, status: "running", startedAt: now };
  return { jobs: jobs.map((job) => (job.id === jobId ? claimed : job)), claimed };
}

export function succeedJob(jobs: readonly IntelligenceJob[], jobId: string, now: string): IntelligenceJob[] {
  return jobs.map((job) =>
    job.id === jobId
      ? { ...job, status: "succeeded", finishedAt: now, lastError: null, errorClass: null }
      : job
  );
}

/**
 * Processing failure. Provider outages are not passed here.
 * Attempts below the limit stay queued with not_before. The last attempt is terminal.
 */
export function failJob(
  jobs: readonly IntelligenceJob[],
  jobId: string,
  input: { errorClass: string; message: string; now: string }
): { jobs: IntelligenceJob[]; job: IntelligenceJob | null } {
  const current = jobs.find((job) => job.id === jobId);
  if (!current) return { jobs: [...jobs], job: null };
  const attempts = current.attempts + 1;
  const terminal = attempts >= current.maxAttempts;
  const next: IntelligenceJob = {
    ...current,
    attempts,
    errorClass: input.errorClass,
    lastError: input.message.slice(0, 500),
    status: terminal ? "failed" : "queued",
    notBefore: terminal ? current.notBefore : new Date(Date.parse(input.now) + backoffMs(attempts)).toISOString(),
    finishedAt: terminal ? input.now : null,
    startedAt: terminal ? current.startedAt : null,
  };
  return { jobs: jobs.map((job) => (job.id === jobId ? next : job)), job: next };
}

export function cancelJob(
  jobs: readonly IntelligenceJob[],
  jobId: string,
  reason: string,
  now: string
): IntelligenceJob[] {
  return jobs.map((job) =>
    job.id === jobId
      ? { ...job, status: "cancelled", finishedAt: now, lastError: reason.slice(0, 500), errorClass: null }
      : job
  );
}

/** A worker that died after claim and before commit is retried, or dead-lettered at the limit. */
export function recoverAbandonedJobs(
  jobs: readonly IntelligenceJob[],
  now: string,
  leaseMs = JOB_LEASE_MS
): { jobs: IntelligenceJob[]; recovered: number } {
  let recovered = 0;
  let next = [...jobs];
  for (const job of jobs) {
    if (job.status !== "running" || !job.startedAt) continue;
    if (Date.parse(job.startedAt) + leaseMs > Date.parse(now)) continue;
    const failed = failJob(next, job.id, {
      errorClass: "unavailable",
      message: "Processing was interrupted before it committed",
      now,
    });
    next = failed.jobs;
    recovered += 1;
  }
  return { jobs: next, recovered };
}

export function processingErrorClass(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = ["invalid_response", "quota", "timeout", "safety_blocked", "unavailable", "config", "conflict"];
  return known.find((name) => message.includes(name)) ?? "unknown";
}
