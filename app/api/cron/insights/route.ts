import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/config";
import { createAdminClient } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { mapPool } from "@/lib/pool";
import {
  createAnalysisRun,
  executeAnalysisRun,
  failStaleAnalysisRuns,
} from "@/lib/services/insight-pipeline";

export const maxDuration = 300;

/** Reviews older than this are left for an explicit analysis run. */
const WINDOW_MONTHS = 6;
/** Per workspace: stop starting new batches after this, the rest waits for tomorrow. */
const SLICE_MS = 8 * 60 * 1000;
const WORKSPACE_CONCURRENCY = 2;

/**
 * GET /api/cron/insights
 * Analyses the written reviews that no analysis covers yet, workspace by
 * workspace, so Insights is ready when someone opens it. Reviews already
 * analysed are skipped, so a quiet night costs nothing. Spending stays inside
 * each workspace's monthly AI budget.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!aiConfigured("extract")) {
    return NextResponse.json({ skipped: "AI is not configured", workspaces: 0 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_google_locations")
    .select("id, workspace_id")
    .eq("is_active", true);
  if (error) {
    logger.error("cron.insights.list_failed", { message: error.message });
    return NextResponse.json({ error: "Could not list locations" }, { status: 500 });
  }
  const byWorkspace = new Map<string, string[]>();
  for (const row of data ?? []) {
    byWorkspace.set(row.workspace_id, [...(byWorkspace.get(row.workspace_id) ?? []), row.id]);
  }

  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
  const results = { ok: 0, failed: 0 };

  await mapPool([...byWorkspace.entries()], WORKSPACE_CONCURRENCY, async ([workspaceId, locationIds]) => {
    try {
      await failStaleAnalysisRuns(workspaceId);
      const scope = {
        locationIds,
        clientId: null,
        groupId: null,
        locationId: null,
        start: start.toISOString(),
        end: null,
      };
      const runId = await createAnalysisRun(workspaceId, null, scope);
      await executeAnalysisRun(runId, workspaceId, scope, undefined, { sliceMs: SLICE_MS });
      results.ok += 1;
    } catch (cause) {
      results.failed += 1;
      logger.error("cron.insights.workspace_failed", {
        workspaceId,
        message: cause instanceof Error ? cause.message : "Unknown",
      });
    }
  });

  return NextResponse.json({ workspaces: byWorkspace.size, ...results });
}
