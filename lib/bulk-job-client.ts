export interface BulkJobItemResult {
  reviewId: string;
  ok: boolean;
  error?: string;
  replyId?: string;
  content?: string;
}

export interface BulkJobOutcome {
  status: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  results?: BulkJobItemResult[];
  error?: string | null;
}

/**
 * Polls a queued bulk generate/publish job until it finishes.
 * Resolves with the final outcome (including per-item results), or the last
 * seen state if the wait budget runs out.
 */
export async function pollBulkJob(
  jobId: string,
  options: { attempts?: number; intervalMs?: number } = {}
): Promise<BulkJobOutcome> {
  const attempts = options.attempts ?? 160;
  const intervalMs = options.intervalMs ?? 1500;
  let last: BulkJobOutcome = { status: "queued" };
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const response = await fetch(`/api/reviews/bulk/${jobId}`, { cache: "no-store" });
      if (!response.ok) continue;
      last = (await response.json()) as BulkJobOutcome;
      if (last.status === "done" || last.status === "failed") return last;
    } catch {
      // Keep polling; a transient network error should not lose the job state.
    }
  }
  return { ...last, status: "timeout" };
}
