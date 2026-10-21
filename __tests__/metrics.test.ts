import { describe, expect, it } from "vitest";
import {
  average,
  buildAttention,
  buildInsights,
  EMPTY_FACTS,
  parseDashboardFacts,
  reviewWindow,
  share,
  type DashboardFacts,
} from "@/lib/metrics";

const facts: DashboardFacts = {
  ...EMPTY_FACTS,
  reviews: 10,
  ratingSum: 40,
  negative: 2,
  oneToThree: 4,
  positive: 6,
  replied: 8,
  unreplied: 2,
  drafts: 1,
  responseHoursSum: 16,
  responseCount: 4,
  stars: [1, 1, 2, 3, 3],
  openEscalations: 2,
  overdueEscalations: 1,
  themeMonths: [{ month: "2026-07-01", theme: "wait", count: 3 }],
};

describe("dashboard metric definitions", () => {
  it("returns null rates when a period has no reviews", () => {
    expect(share(0, 0)).toBeNull();
    expect(average(0, 0)).toBeNull();
    expect(reviewWindow(EMPTY_FACTS)).toEqual({
      avgRating: null,
      negativeShare: null,
      replyRate: null,
      avgResponseHours: null,
    });
  });

  it("counts 1–3 stars as the negative share and weights the average", () => {
    const window = reviewWindow(facts);
    expect(window.avgRating).toBe(4);
    expect(window.negativeShare).toBe(0.4);
    expect(window.replyRate).toBe(0.8);
    expect(window.avgResponseHours).toBe(4);
  });

  it("states only the numbers it was given", () => {
    const lines = buildInsights({
      periodLabel: "Last 12 months",
      scopeLabel: "All brands",
      facts,
      previous: { ...EMPTY_FACTS, reviews: 5, ratingSum: 15 },
      lowestLocation: { name: "East Fort", rating: 3.2, reviews: 4 },
    });
    const text = lines.join(" ");
    expect(text).toContain("Last 12 months");
    expect(text).toContain("All brands");
    expect(text).toContain("Reply rate is 80%.");
    expect(text).toContain("East Fort");
    expect(text.toLowerCase()).not.toContain("because");
    expect(text.toLowerCase()).not.toContain("competitor");
  });

  it("keeps overdue items inside the open count and ignores a missing payload", () => {
    expect(facts.overdueEscalations).toBeLessThanOrEqual(facts.openEscalations);
    expect(parseDashboardFacts(null).reviews).toBe(0);
    const attention = buildAttention({
      facts,
      expiredConnections: 0,
      revokedConnections: 1,
      heldLocations: 0,
      inactiveLocations: 0,
      href: (extra) => `/reviews?filter=${extra?.filter ?? ""}`,
      escalationHref: "/escalations?queue=past_sla",
    });
    expect(attention.map((item) => item.id)).toEqual(["overdue", "drafts", "unreplied", "connections"]);
  });
});
