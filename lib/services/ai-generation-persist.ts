import { getAiGenerationJob } from "@/lib/services/ai-generation-jobs";
import { AIReviewService } from "@/lib/services/ai-review";
import { LocationInsightService } from "@/lib/services/location-insights";
import { ScopeInsightService } from "@/lib/services/scope-insights";

/**
 * Runs the background persister for one generation job.
 * Each persister claims the job atomically, so duplicate runs are harmless.
 */
export async function persistAiGenerationJob(jobId: string): Promise<void> {
  const job = await getAiGenerationJob(jobId);
  if (!job) return;
  if (job.kind === "reply") {
    await AIReviewService.persistGenerationJob(jobId);
  } else if (job.kind === "location_insight") {
    await LocationInsightService.persistGenerationJob(jobId);
  } else {
    await ScopeInsightService.persistGenerationJob(jobId);
  }
}
