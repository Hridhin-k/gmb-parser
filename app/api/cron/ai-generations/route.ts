import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listStaleAiGenerationJobs } from "@/lib/services/ai-generation-jobs";
import { persistAiGenerationJob } from "@/lib/services/ai-generation-persist";

/**
 * GET /api/cron/ai-generations
 * Re-runs the background persister for AI generation jobs that never saved.
 * The generated content is already stored on each job, so no model is called.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jobs = await listStaleAiGenerationJobs(10);
    for (const job of jobs) {
      await persistAiGenerationJob(job.id);
    }
    return NextResponse.json({ processed: jobs.length });
  } catch (error) {
    logger.error("cron.ai_generations.failed", {
      message: error instanceof Error ? error.message : "Unknown",
    });
    return NextResponse.json({ error: "AI generation reconcile failed" }, { status: 500 });
  }
}
