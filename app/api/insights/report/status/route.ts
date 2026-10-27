import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { readPageScope } from "@/lib/services/scope-catalog";
import { claimStaleReport, generateReport, getReportById } from "@/lib/services/insight-report";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/insights/report/status?reportId=…
 *
 * Poll target for report generation. Workspace-checked: a report id from
 * another workspace reads as not found.
 *
 * Self-healing: if a processing report's generator has gone quiet for
 * >20s (killed invocation), this poll claims the report and resumes
 * generation — completed analysis is reused, so the resume goes straight
 * back to the synthesis step it died in.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const reportId = new URL(request.url).searchParams.get("reportId");
  if (!reportId) return NextResponse.json({ error: "reportId is required" }, { status: 400 });

  const membership = await ensurePersonalWorkspace(user);
  const workspaceId = membership.workspace_id as string;
  const report = await getReportById(workspaceId, reportId);
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  if (report.status === "processing" || report.status === "pending") {
    const staleMs = Date.now() - new Date(report.updated_at as string).getTime();
    if (staleMs > 20_000 && (await claimStaleReport(workspaceId, report.id as string))) {
      const scope = await readPageScope(user.id, workspaceId, {
        client: (report.client_id as string | null) ?? undefined,
        group: (report.group_id as string | null) ?? undefined,
        location: (report.location_id as string | null) ?? undefined,
      });
      if (scope.locationIds.length > 0) {
        // Previous period = the equal-length window before the stored
        // range (null for all-time), mirroring previousDateRange.
        const start = (report.range_start as string | null) ?? null;
        const end = (report.range_end as string | null) ?? null;
        let prevStart: string | null = null;
        let prevEnd: string | null = null;
        if (start) {
          const startMs = new Date(start).getTime();
          const endMs = end ? new Date(end).getTime() : Date.now();
          if (endMs > startMs) {
            prevStart = new Date(startMs - (endMs - startMs)).toISOString();
            prevEnd = new Date(startMs).toISOString();
          }
        }
        const input = {
          locationIds: scope.locationIds,
          clientId: (report.client_id as string | null) ?? null,
          groupId: (report.group_id as string | null) ?? null,
          locationId: (report.location_id as string | null) ?? null,
          start,
          end,
          prevStart,
          prevEnd,
          scopeLabel: scope.title,
        };
        after(async () => {
          await generateReport(report.id as string, workspaceId, input);
        });
      }
    }
  }

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
  }, { headers: NO_STORE });
}
