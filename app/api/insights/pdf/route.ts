import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { loadInsightsPage } from "@/lib/services/insights-page";
import { heatmapNote, locationHeatmap } from "@/lib/insight-mood";
import { insightsReportLines } from "@/lib/insights-pdf";
import { renderTextPdf } from "@/lib/report-pdf";
import { checkRateLimit, EXPORT_LIMIT } from "@/lib/rate-limit";
import { modernizeCopy } from "@/lib/ui/vocabulary";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

/**
 * GET /api/insights/pdf
 *
 * The Insights summary for the place and dates in the query, as a PDF to send
 * to a client. The place is re-resolved for the caller, like the page.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rl = checkRateLimit(user.id, "insights.pdf", EXPORT_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many downloads. Please wait a minute and try again." }, { status: 429 });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const data = await loadInsightsPage(user.id, membership.workspace_id as string, params);
    const placeName = modernizeCopy(data.scope.title);
    const heat = locationHeatmap(data.mood.locationTopics);
    const doc = insightsReportLines({
      placeName,
      periodLabel: data.range.label,
      generatedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      counts: { analysed: data.dashboard.counts.alreadyAnalysed, eligible: data.dashboard.counts.eligible },
      short: data.short,
      points: data.points,
      trends: data.trends,
      actions: data.actions,
      locationNote: data.scope.locationId ? null : heatmapNote(heat, data.locationNames),
    });
    const filename = `insights-${placeName.replace(/[^\w.-]+/g, "-").slice(0, 50).toLowerCase() || "report"}.pdf`;
    return new NextResponse(Buffer.from(renderTextPdf(doc.title, doc.lines)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("insights.pdf_failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not build the PDF." }, { status: 500 });
  }
}
