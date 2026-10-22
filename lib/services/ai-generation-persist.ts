import { getAiGenerationJob } from "@/lib/services/ai-generation-jobs";
import { AIReviewService } from "@/lib/services/ai-review";

/**
 * Runs the background persister for one generation job.
 * The persister claims the job atomically, so duplicate runs are harmless.
 */
export async function persistAiGenerationJob(jobId: string): Promise<void> {
  const job = await getAiGenerationJob(jobId);
  if (!job) return;
  if (job.kind === "reply") {
    await AIReviewService.persistGenerationJob(jobId);
  }
}
