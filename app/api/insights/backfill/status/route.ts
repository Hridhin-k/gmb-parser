import { NextResponse } from "next/server";
import { getActiveWorkspace } from "@/lib/services/session";
import { getBackfillProgress } from "@/lib/services/backfill-progress";

/**
 * GET /api/insights/backfill/status?client=<id>
 * Poll target while an Update summary run is in flight. Returns
 * { running: false } when this instance has no run for the workspace.
 */
export async function GET(request: Request) {
  const { workspaceId } = await getActiveWorkspace();
  const clientId = new URL(request.url).searchParams.get("client");
  const progress = getBackfillProgress(workspaceId, clientId);
  if (!progress) return NextResponse.json({ running: false });
  return NextResponse.json({
    running: progress.phase !== "done" && progress.phase !== "failed",
    ...progress,
  });
}
