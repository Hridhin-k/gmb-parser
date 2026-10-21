import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/date-range";
import { checkRateLimit, AI_GENERATE_LIMIT, WORKSPACE_INSIGHT_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { SummaryAccessError } from "@/lib/intelligence/summary-scope";
import { generateInsightReport } from "@/lib/services/insight-report";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * POST /api/insights/reports
 * Writes one insight-v1 report for the signed-in member's scope.
 * A page view does not call this.
 */
export async function POST(request: Request) {
  const { user, workspaceId } = await getActiveWorkspace();
  const limited = checkRateLimit(user.id, "insights.report", { ...AI_GENERATE_LIMIT, limit: 6 });
  const form = await request.formData();
  const back = new URL("/insights", request.url);
  for (const key of ["range", "from", "to", "client", "group", "location"] as const) {
    const value = field(form, key);
    if (value) back.searchParams.set(key, value);
  }
  const workspaceLimited = checkRateLimit(`workspace:${workspaceId}`, "insights.report", WORKSPACE_INSIGHT_LIMIT);
  if (!limited.allowed || !workspaceLimited.allowed) {
    back.searchParams.set("notice", "Wait a minute before writing another report.");
    return NextResponse.redirect(back, 303);
  }
  try {
    const result = await generateInsightReport(createAdminClient(), {
      userId: user.id,
      workspaceId,
      clientId: field(form, "client") || null,
      groupId: field(form, "group") || null,
      locationId: field(form, "location") || null,
      range: parseDateRange({ range: field(form, "range"), from: field(form, "from"), to: field(form, "to") }, "12m"),
      force: field(form, "force") === "1",
    });
    const notice = result.status === "processing"
      ? "A report for these inputs is already being written."
      : result.reused
        ? "The saved report still matches these inputs."
        : result.insufficient
          ? result.insufficientReason ?? "There is not enough evidence for a finding."
          : `Report version ${result.version} was saved.`;
    back.searchParams.set("notice", notice);
  } catch (error) {
    if (error instanceof SummaryAccessError) {
      back.searchParams.set("notice", error.message);
    } else {
      logger.warn("intelligence.insight_generate_failed", {
        message: error instanceof Error ? error.message : "insight generate failed",
      });
      back.searchParams.set("notice", "The report could not be saved.");
    }
  }
  return NextResponse.redirect(back, 303);
}
