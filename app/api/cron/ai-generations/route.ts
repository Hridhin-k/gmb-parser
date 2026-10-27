import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { listStaleAiGenerationJobs } from "@/lib/services/ai-generation-jobs";
import { persistAiGenerationJob } from "@/lib/services/ai-generation-persist";
import { failStaleAnalysisRuns } from "@/lib/services/insight-pipeline";
import { mapPool } from "@/lib/pool";

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
    await mapPool(jobs, 3, async (job) => {
      await persistAiGenerationJob(job.id);
    });
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleRuns } = await admin
      .from("grm_analysis_runs")
      .select("workspace_id")
      .eq("status", "running")
      .lt("updated_at", cutoff)
      .limit(50);
    const workspaces = [...new Set((staleRuns ?? []).map((row) => row.workspace_id))];
    await mapPool(workspaces, 3, async (workspaceId) => {
      await failStaleAnalysisRuns(workspaceId);
    });
    return NextResponse.json({ processed: jobs.length, staleAnalysisWorkspaces: workspaces.length });
  } catch (error) {
    logger.error("cron.ai_generations.failed", {
      message: error instanceof Error ? error.message : "Unknown",
    });
    return NextResponse.json({ error: "AI generation reconcile failed" }, { status: 500 });
  }
}
