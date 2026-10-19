import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runReportingJobs } from "@/lib/services/reporting";

/**
 * GET /api/cron/reports
 * Sends due report slots and evaluates alert rules.
 * A slot is claimed once. A failed slot is retried up to three times.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReportingJobs();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("cron.reports.failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "Report run failed" }, { status: 500 });
  }
}
