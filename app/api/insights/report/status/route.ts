import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { getReportById } from "@/lib/services/insight-report";

/**
 * GET /api/insights/report/status?reportId=…
 *
 * Poll target for report generation. Workspace-checked: a report id
 * from another workspace reads as not found.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const reportId = new URL(request.url).searchParams.get("reportId");
  if (!reportId) return NextResponse.json({ error: "reportId is required" }, { status: 400 });

  const membership = await ensurePersonalWorkspace(user);
  const report = await getReportById(membership.workspace_id as string, reportId);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  return NextResponse.json({
    reportId: report.id,
    status: report.status,
    phase: report.phase,
    discovered: report.discovered_count,
    eligible: report.eligible_count,
    analysed: report.analysed_count,
    failed: report.failed_count,
    pending: report.pending_count,
    insightCount: Array.isArray(report.insights) ? report.insights.length : 0,
    inputTokens: report.input_tokens,
    outputTokens: report.output_tokens,
    error: report.error,
    finishedAt: report.finished_at,
    updatedAt: report.updated_at,
  });
}
