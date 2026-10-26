import { createAdminClient } from "@/lib/supabase/admin";
import type { OnboardingComparison, SampleSummary } from "@/lib/analytics-metrics";
import { sliceFromRpc } from "@/lib/analytics-slice";
import { remember } from "@/lib/ttl-cache";

export interface AnalyticsSlice {
  window: SampleSummary;
  onboarding: OnboardingComparison;
  truncated: boolean;
}

/**
 * Analytics window + onboarding summaries.
 * One RPC aggregates in Postgres; the page never downloads review rows.
 */
export async function loadAnalyticsSlice(input: {
  workspaceId: string;
  locationIds: string[];
  start: string | null;
  end: string | null;
}): Promise<AnalyticsSlice> {
  const places = [...input.locationIds].sort().join(",");
  const key = `slice:${input.workspaceId}:${input.start ?? ""}:${input.end ?? ""}:${places}`;
  return remember(key, 45_000, () => fetchAnalyticsSlice(input));
}

async function fetchAnalyticsSlice(input: {
  workspaceId: string;
  locationIds: string[];
  start: string | null;
  end: string | null;
}): Promise<AnalyticsSlice> {
  const admin = createAdminClient();
  const { data: onboardingRow, error: onboardingError } = await admin
    .from("grm_onboarding")
    .select("completed_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (onboardingError) throw new Error(`Failed to load onboarding: ${onboardingError.message}`);
  const completedAt = (onboardingRow?.completed_at as string | null) ?? null;

  const { data, error } = await admin.rpc("grm_analytics_slice", {
    p_workspace_id: input.workspaceId,
    p_location_ids: input.locationIds,
    p_start: input.start,
    p_end: input.end,
    p_onboarding_completed_at: completedAt,
  });
  if (error) throw new Error(`Failed to load analytics reviews: ${error.message}`);
  return sliceFromRpc(data, completedAt);
}
