import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewSyncService } from "@/lib/services/review-sync";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/reviews-sync
 * Incremental catch-up so new reviews arrive without a manual sync.
 * Vercel Hobby allows one run per day (04:00 UTC). Pro can use a denser schedule.
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

  let succeeded = 0;
  let failed = 0;
  let updated = 0;

  for (const ws of workspaces) {
    try {
      const result = await ReviewSyncService.syncAllWorkspaceLocations(
        ws.workspaceId,
        ws.userId,
        { mode: "incremental" }
      );
      succeeded += result.locationsSucceeded;
      failed += result.locationsFailed;
      updated += result.totalReviewsSynced;
    } catch (err) {
      failed += 1;
      logger.error("cron.reviews_sync.workspace_failed", {
        workspaceId: ws.workspaceId,
        message: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  return NextResponse.json({
    workspaces: workspaces.length,
    locationsSucceeded: succeeded,
    locationsFailed: failed,
    reviewsUpdated: updated,
  });
}
