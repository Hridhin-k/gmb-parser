import { describe, expect, it } from "vitest";
import { isCountedSummary, findingsForScope, outletComparison, themeRowsFromGroups } from "@/lib/insight-page";
import type { DashboardFacts } from "@/lib/metrics";

function row(locationId: string, reviews: number, ratingSum: number, oneToThree = 0): DashboardFacts["locations"][number] {
  return {
    locationId,
    reviews,
    ratingSum,
    oneToThree,
    replied: 0,
    unreplied: 0,
    drafts: 0,
    responseHoursSum: 0,
    responseCount: 0,
  };
}

describe("outletComparison", () => {
  it("ranks each outlet by its own average and does not average the averages", () => {
    const result = outletComparison(
      [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      [row("a", 1, 5), row("b", 100, 200)]
    );
    expect(result.strongest?.id).toBe("a");
    expect(result.strongest?.rating).toBe(5);
    expect(result.weakest?.id).toBe("b");
    expect(result.weakest?.rating).toBe(2);
  });

  it("returns no comparison when the scope is one outlet", () => {
    const result = outletComparison([{ id: "a", name: "Alpha" }], [row("a", 10, 40, 2)]);
    expect(result.strongest?.rating).toBe(4);
    expect(result.weakest).toBeNull();
  });

  it("drops a finding that cites a location outside the selected scope", () => {
    const kept = findingsForScope(
      [
        { key: "in", locationIds: ["a"] },
        { key: "mixed", locationIds: ["a", "z"] },
        { key: "wide", locationIds: [] },
      ],
      ["a", "b"]
    );
    expect(kept.map((item) => item.key)).toEqual(["in", "wide"]);
  });

  it("treats a counted fallback as something other than a model interpretation", () => {
    expect(isCountedSummary("North covers 4 locations with 12 recent reviews averaging 3.8★. 8 positive, 2 need attention.")).toBe(true);
    expect(isCountedSummary("Marina has 3 reviews averaging 4.0★. 2 positive, 1 need attention.")).toBe(true);
    expect(isCountedSummary("Queue time is the complaint that repeats across both shops.")).toBe(false);
  });

  it("returns nothing when the period has no reviews", () => {
    expect(outletComparison([{ id: "a", name: "Alpha" }], [row("a", 0, 0)])).toEqual({
      strongest: null,
      weakest: null,
    });
  });
});

describe("themeRowsFromGroups", () => {
  it("sums the same theme across groups and sorts by count", () => {
    const rows = themeRowsFromGroups([
      { theme: "staff", count: 2 },
      { theme: "staff", count: 3 },
      { theme: "quality", count: 4 },
    ]);
    expect(rows[0]?.count).toBe(5);
    expect(rows[0]?.label.toLowerCase()).toMatch(/staff/);
    expect(rows[1]?.count).toBe(4);
  });
});
