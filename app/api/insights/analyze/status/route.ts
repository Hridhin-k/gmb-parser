import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import {
  ANALYSIS_RUN_SLICE_MS,
  claimStaleAnalysisRun,
  executeAnalysisRun,
  getAnalysisRun,
} from "@/lib/services/insight-pipeline";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/insights/analyze/status?runId=…
 *
 * Poll target for a running analysis. Workspace-checked: a run id from
 * another workspace reads as not found.
 *
 * Self-healing: analysis runs in bounded slices (the platform kills any
 * single invocation at maxDuration). If a running run's worker has gone
 * quiet for >20s, this poll claims the run and kicks the next slice —
 * so a run completes across as many slices as it needs while the user
 * keeps the page open.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const membership = await ensurePersonalWorkspace(user);
  const workspaceId = membership.workspace_id as string;
  const run = await getAnalysisRun(workspaceId, runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (run.status === "running") {
    const staleMs = Date.now() - new Date(run.updated_at as string).getTime();
    if (staleMs > 20_000 && (await claimStaleAnalysisRun(run.id as string))) {
      const scope = await readPageScope(user.id, workspaceId, {
        client: (run.client_id as string | null) ?? undefined,
        group: (run.group_id as string | null) ?? undefined,
        location: (run.location_id as string | null) ?? undefined,
      });
      if (scope.locationIds.length > 0) {
        const resumeScope = {
          locationIds: scope.locationIds,
          clientId: (run.client_id as string | null) ?? null,
          groupId: (run.group_id as string | null) ?? null,
          locationId: (run.location_id as string | null) ?? null,
          start: (run.range_start as string | null) ?? null,
          end: (run.range_end as string | null) ?? null,
        };
        after(async () => {
          await executeAnalysisRun(run.id as string, workspaceId, resumeScope, undefined, {
            sliceMs: ANALYSIS_RUN_SLICE_MS,
          });
        });
      }
    }
  }

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
  }, { headers: NO_STORE });
}
