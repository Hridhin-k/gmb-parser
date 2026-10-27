import type { AnalyticsSection } from "@/lib/analytics-sections";

/**
 * Which expensive loaders each Analytics tab needs.
 * Tabs are URL-driven so the server can skip RPCs the active section does not render.
 */
export function analyticsSectionLoads(section: AnalyticsSection): {
  needsSlice: boolean;
  needsInsights: boolean;
  needsRoster: boolean;
} {
  return {
    needsSlice: section === "performance",
    needsInsights: section === "themes",
    needsRoster: section === "team",
  };
}
