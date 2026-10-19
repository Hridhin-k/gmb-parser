import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { actingUser, guardReport, ReportService } from "@/lib/services/reporting";
import { reviewCsvLines } from "@/lib/services/review-export";
import { latestDelivery, nextDelivery, parseDeliveryTime, reportWindow } from "@/lib/reporting";
import { validateId } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }

  try {
    const actor = await actingUser(user);
    const report = await ReportService.load(actor.workspaceId, reportId);
    if (!report) return NextResponse.json({ error: "That report is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, report);
    const time = parseDeliveryTime(report.deliveryTime);
    if (!time) return NextResponse.json({ error: "The delivery time is not valid." }, { status: 400 });
    const spec = {
      frequency: report.frequency,
      hour: time.hour,
      minute: time.minute,
      weekday: report.weekday,
      dayOfMonth: report.dayOfMonth,
      timezone: report.timezone,
    };
    const now = new Date();
    const slot = latestDelivery(now, spec) ?? nextDelivery(now, spec);
    const window = reportWindow(slot, spec);
    const lines = reviewCsvLines(actor.workspaceId, {
      clientId: report.clientId,
      groupId: report.groupId,
      locationId: report.locationId,
      since: window.start.toISOString(),
      until: window.end.toISOString(),
      replyFilter: "all",
      ratingBucket: null,
      rating: null,
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("\uFEFF"));
        try {
          for await (const line of lines) controller.enqueue(encoder.encode(`${line}\r\n`));
          controller.close();
        } catch (error) {
          logger.error("reports.csv.failed", {
            workspaceId: actor.workspaceId,
            error: error instanceof Error ? error.message : "Unknown",
          });
          controller.error(error);
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${reportId.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not export the report." }, { status: 500 });
  }
}
