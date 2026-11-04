import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/client";
import { enqueueLocationPipelines, drainLocationPipelines } from "@/lib/services/location-pipeline";
import { getPool } from "@/lib/db/pool";
import { EscalationService } from "@/lib/services/escalations";
import { logger } from "@/lib/logger";
import { mapPool } from "@/lib/pool";

/**
 * GET /api/cron/reviews-sync
 * Incremental catch-up so new reviews arrive without a manual sync.
 * Vercel Hobby allows one run per day (04:00 UTC). Pro can use a denser schedule.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections, error } = await admin
    .from("grm_google_connections")
    .select("workspace_id, authorized_by_user_id")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: "Could not list connections" }, { status: 500 });
  }

  const seen = new Set<string>();
  const workspaces: Array<{ workspaceId: string; userId: string }> = [];
  for (const row of connections ?? []) {
    if (seen.has(row.workspace_id)) continue;
    seen.add(row.workspace_id);
    workspaces.push({
      workspaceId: row.workspace_id,
      userId: row.authorized_by_user_id,
    });
  }

  let failed = 0;
  let updated = 0;

  // Workspaces are independent: sync a few at a time instead of one by one.
  await mapPool(workspaces, 3, async (ws) => {
    try {
      const { rows } = await getPool().query<{ id: string }>(`SELECT l.id FROM grm_google_locations l
        JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
        JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
        WHERE l.workspace_id=$1 AND l.is_active AND c.status='active'`, [ws.workspaceId]);
      if (rows.length > 0) {
        // Scheduled catch-up stays in the recent window; history is explicit opt-in.
        const jobIds = await enqueueLocationPipelines(ws.workspaceId, ws.userId, rows.map((l) => l.id), { scheduled: true, period: { range: "30d" } });
        updated += jobIds.length;
      }
      await EscalationService.runScheduled(ws.workspaceId);
    } catch (err) {
      failed += 1;
      logger.error("cron.reviews_sync.workspace_failed", {
        workspaceId: ws.workspaceId,
        message: err instanceof Error ? err.message : "Unknown",
      });
    }
  });

  await drainLocationPipelines({ limit: 2 });

  // Surface it: a silent partial run means stale reviews until tomorrow.
  if (failed > 0) {
    logger.error("cron.reviews_sync.locations_failed", {
      workspaces: workspaces.length,
      workspacesFailed: failed,
      jobsQueued: updated,
    });
  }

  return NextResponse.json({
    workspaces: workspaces.length,
    workspacesFailed: failed,
    jobsQueued: updated,
  });
}
