import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, AI_GENERATE_LIMIT, WORKSPACE_AI_LIMIT } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { parseDateRange } from "@/lib/date-range";
import {
  ANALYSIS_RUN_SLICE_MS,
  createAnalysisRun,
  executeAnalysisRun,
  failStaleAnalysisRuns,
} from "@/lib/services/insight-pipeline";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

/**
 * POST /api/insights/analyze
 *
 * Starts an end-to-end review analysis run for the caller's resolved
 * scope and date range. The scope is re-resolved on the server from
 * the posted scope parameters — posted location ids are never trusted.
 * Discovery and batch processing run in `after()` so large scopes do
 * not hit a request timeout; the client polls the status route.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = checkRateLimit(user.id, "ai.generate", AI_GENERATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait before starting another analysis." },
      { status: 429 }
    );
  }

  const membership = await ensurePersonalWorkspace(user);
  const workspaceId = membership.workspace_id as string;
  const workspaceLimit = checkRateLimit(
    `workspace:${workspaceId}`,
    "ai.generate",
    WORKSPACE_AI_LIMIT
  );
  if (!workspaceLimit.allowed) {
    return NextResponse.json(
      { error: "This workspace has reached its AI limit. Please wait before analysing again." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const scope = await readPageScope(user.id, workspaceId, {
    client: typeof body.client === "string" ? body.client : undefined,
    group: typeof body.group === "string" ? body.group : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
  });
  if (scope.locationIds.length === 0) {
    return NextResponse.json(
      { error: "No locations in the selected scope. Choose a client, group, or outlet first." },
      { status: 400 }
    );
  }

  const range = parseDateRange(
    {
      range: typeof body.range === "string" ? body.range : undefined,
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
    },
    "12m"
  );

  const runScope = {
    locationIds: scope.locationIds,
    clientId: scope.clientId,
    groupId: scope.groupId,
    locationId: scope.locationId,
    start: range.start ? range.start.toISOString() : null,
    end: range.end ? range.end.toISOString() : null,
  };

  try {
    await failStaleAnalysisRuns(workspaceId);
    const runId = await createAnalysisRun(workspaceId, user.id, runScope);
    after(async () => {
      // Bounded slice: the worker stops before maxDuration kills it, and
      // the status poll resumes the run slice by slice until it completes.
      await executeAnalysisRun(runId, workspaceId, runScope, undefined, {
        sliceMs: ANALYSIS_RUN_SLICE_MS,
      });
    });
    return NextResponse.json({ runId, status: "running" });
  } catch (error) {
    logger.error("insight_pipeline.start_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to start analysis. Please try again." }, { status: 500 });
  }
}
