import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { runIntelligenceMaintenance } from "@/lib/services/intelligence-jobs";

/**
 * GET /api/cron/intelligence
 * Reconciles review versions and runs due classify jobs. Does not call Gemini.
 * The daily reviews-sync cron already calls the same maintenance after each workspace.
 * This route is the operator retry. It is not on the Vercel schedule, because this
 * project keeps one reviews cron per day.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections, error } = await admin
    .from("grm_google_connections")
    .select("workspace_id")
    .eq("status", "active");
  if (error) {
    return NextResponse.json({ error: "Could not list connections" }, { status: 500 });
  }

  const workspaces = [...new Set((connections ?? []).map((row) => row.workspace_id))];
  const reports = [];
  for (const workspaceId of workspaces) {
    try {
      reports.push(await runIntelligenceMaintenance(workspaceId));
    } catch (err) {
      logger.error("cron.intelligence.workspace_failed", {
        workspaceId,
        message: err instanceof Error ? err.message : "Unknown",
      });
      reports.push({ workspaceId, error: "failed" });
    }
  }
  return NextResponse.json({ workspaces: workspaces.length, reports });
}
