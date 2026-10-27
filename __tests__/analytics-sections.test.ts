import { describe, expect, it } from "vitest";
import { ANALYTICS_SECTIONS } from "@/lib/analytics-sections";
import { analyticsSectionLoads } from "@/lib/analytics-section-loads";
import { emptyAnalyticsSlice } from "@/lib/services/analytics-slice";
import { emptyInsightDashboard } from "@/lib/insight-dashboard";

describe("ANALYTICS_SECTIONS", () => {
  it("is a real array usable from Server Components", () => {
    expect(Array.isArray(ANALYTICS_SECTIONS)).toBe(true);
    expect(ANALYTICS_SECTIONS.some((item) => item.id === "performance")).toBe(true);
    expect(ANALYTICS_SECTIONS.some((item) => item.id === ("missing" as typeof item.id))).toBe(false);
  });
});

describe("analyticsSectionLoads", () => {
  it("loads slice only on performance, insights only on themes, roster only on team", () => {
    expect(analyticsSectionLoads("performance")).toEqual({
      needsSlice: true,
      needsInsights: false,
      needsRoster: false,
    });
    expect(analyticsSectionLoads("themes")).toEqual({
      needsSlice: false,
      needsInsights: true,
      needsRoster: false,
    });
    expect(analyticsSectionLoads("profile")).toEqual({
      needsSlice: false,
      needsInsights: false,
      needsRoster: false,
    });
    expect(analyticsSectionLoads("automation")).toEqual({
      needsSlice: false,
      needsInsights: false,
      needsRoster: false,
    });
    expect(analyticsSectionLoads("team")).toEqual({
      needsSlice: false,
      needsInsights: false,
      needsRoster: true,
    });
  });

  it("provides empty placeholders that keep board props typed", () => {
    expect(emptyAnalyticsSlice().window.reviews).toBe(0);
    expect(emptyInsightDashboard().counts.discovered).toBe(0);
  });
});
