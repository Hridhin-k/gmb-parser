import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EscalationService } from "@/lib/services/escalations";
import { runRequestJobs } from "@/lib/services/request-campaigns";
import { runReportingJobs } from "@/lib/services/reporting";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/escalations
 * Records due in-app reminders and opens new complaint records.
 * Safe to run more than once: a reminder is claimed with sent_at before it is recorded.
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
  let paused = 0;
  for (const workspace of data ?? []) {
    try {
      const result = await EscalationService.runScheduled(workspace.id);
      reminders += result.reminders;
      created += result.created;
      if (result.autoreplies === "paused") paused += 1;
    } catch (err) {
      logger.error("cron.escalations.workspace_failed", {
        workspaceId: workspace.id,
        message: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  let reporting: { reportsDelivered: number; alertsOpened: number } | null = null;
  try {
    reporting = await runReportingJobs();
  } catch (err) {
    logger.error("cron.escalations.reports_failed", {
      message: err instanceof Error ? err.message : "Unknown",
    });
  }

  let requests: { retried: number; reminded: number } | null = null;
  try {
    requests = await runRequestJobs();
  } catch (err) {
    logger.error("cron.escalations.requests_failed", {
      message: err instanceof Error ? err.message : "Unknown",
    });
  }

  return NextResponse.json({
    workspaces: data?.length ?? 0,
    escalationsOpened: created,
    remindersRecorded: reminders,
    pausedWorkspaces: paused,
    reportsDelivered: reporting?.reportsDelivered ?? 0,
    alertsOpened: reporting?.alertsOpened ?? 0,
    requestsRetried: requests?.retried ?? 0,
    requestsReminded: requests?.reminded ?? 0,
  });
}
