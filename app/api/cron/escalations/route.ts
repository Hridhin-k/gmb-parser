import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/client";
import { EscalationService } from "@/lib/services/escalations";
import { logger } from "@/lib/logger";
import { mapPool } from "@/lib/pool";

/**
 * GET /api/cron/escalations
 * Records due in-app reminders and opens new complaint records.
 * Safe to run more than once: a reminder is claimed with sent_at before it is recorded.
 * Report delivery and review-request retries have their own crons
 * (/api/cron/reports, /api/cron/requests) and are not repeated here.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_workspaces").select("id");
  if (error) return NextResponse.json({ error: "Could not list workspaces" }, { status: 500 });

  let reminders = 0;
  let created = 0;
  let advanced = 0;
  let paused = 0;
  // Workspaces are independent: run a few at a time instead of one by one.
  await mapPool(data ?? [], 3, async (workspace) => {
    try {
      const result = await EscalationService.runScheduled(workspace.id);
      reminders += result.reminders;
      created += result.created;
      advanced += result.advanced;
      if (result.autoreplies === "paused") paused += 1;
    } catch (err) {
      logger.error("cron.escalations.workspace_failed", {
        workspaceId: workspace.id,
        message: err instanceof Error ? err.message : "Unknown",
      });
    }
  });

  return NextResponse.json({
    workspaces: data?.length ?? 0,
    escalationsOpened: created,
    remindersRecorded: reminders,
    levelsAdvanced: advanced,
    pausedWorkspaces: paused,
  });
}
