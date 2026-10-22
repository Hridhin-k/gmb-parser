import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { getAnalysisRun } from "@/lib/services/insight-pipeline";

/**
 * GET /api/insights/analyze/status?runId=…
 *
 * Poll target for a running analysis. Workspace-checked: a run id from
 * another workspace reads as not found.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const membership = await ensurePersonalWorkspace(user);
  const run = await getAnalysisRun(membership.workspace_id as string, runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json({
    runId: run.id,
    status: run.status,
    discovered: run.discovered,
    eligible: run.eligible,
    alreadyAnalysed: run.already_analysed,
    newlyAnalysed: run.newly_analysed,
    pending: run.pending,
    failed: run.failed,
    batchesTotal: run.batches_total,
    batchesCompleted: run.batches_completed,
    retries: run.retries,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    updatedAt: run.updated_at,
  });
}
