export interface AiGenerationSaveResult {
  status: string;
  draftId?: string | null;
  replyId?: string | null;
  error?: string | null;
}

/**
 * Polls the background save for a generated draft or brief.
 * Resolves when the job saves, fails, or the wait budget runs out.
 */
export async function pollAiGeneration(
  jobId: string,
  options: { attempts?: number; intervalMs?: number } = {}
): Promise<AiGenerationSaveResult> {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 700;
  let last: AiGenerationSaveResult = { status: "generated" };
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const response = await fetch(`/api/ai-generations/${jobId}`, { cache: "no-store" });
      if (!response.ok) continue;
      last = (await response.json()) as AiGenerationSaveResult;
      if (last.status === "saved" || last.status === "failed" || last.status === "superseded") {
        return last;
      }
    } catch {
      // Keep polling; a transient network error should not lose the save state.
    }
  }
  return { ...last, status: "timeout" };
}

export async function retryAiGeneration(jobId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/ai-generations/${jobId}`, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}
