import { ANALYSIS_VERSION } from "@/lib/review-intelligence";
import { emptyInsightDashboard, parseInsightDashboard, type InsightDashboardData } from "@/lib/insight-dashboard";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Chart data and coverage counts for the insights page.
 * One database call. The page must not page through reviews or observations.
 */
export async function loadInsightDashboard(
  workspaceId: string,
  input: { locationIds: string[]; start: string | null; end: string | null }
): Promise<InsightDashboardData> {
  if (input.locationIds.length === 0) return emptyInsightDashboard();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grm_insight_dashboard", {
    p_workspace_id: workspaceId,
    p_location_ids: input.locationIds,
    p_start: input.start,
    p_end: input.end,
    p_analysis_version: ANALYSIS_VERSION,
  });
  if (error) throw new Error(`Failed to load insights: ${error.message}`);
  return parseInsightDashboard(data);
}
