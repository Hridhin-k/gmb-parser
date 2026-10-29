import { describe, expect, it } from "vitest";
import {
  insightTopicInboxExtra,
  insightTrendMonths,
  parseInsightDashboard,
} from "@/lib/insight-dashboard";

describe("parseInsightDashboard", () => {
  it("maps the database summary into the chart and coverage shapes", () => {
    const parsed = parseInsightDashboard({
      counts: {
        discovered: 10,
        eligible: 7,
        alreadyAnalysed: 4,
        ratingOnly: 3,
        pending: 3,
        failed: 1,
      },
      reviewsAnalysed: 4,
      storedObservations: 9,
      severeCount: 12,
      positive: [{ topic: "staff", count: 5, reviews: 4 }],
      negative: [{ topic: "billing", count: 2, reviews: 2 }],
      byMonth: [{ month: "2026-01", positive: 5, negative: 2 }],
      byOutlet: [{ locationId: "loc-1", positive: 5, negative: 2, severe: 1 }],
      outletReviews: { "loc-1": 4 },
      staffPraise: [{ name: "Sanjana", count: 3 }],
      staffComplaints: [{ name: "Arjun", count: 1 }],
      severeIncidents: [
        {
          reviewId: "rev-1",
          severity: 5,
          starRating: 1,
          reviewCreateTime: "2026-01-02T00:00:00.000Z",
          evidenceExcerpt: "I was injured",
          severityRationale: "injury alleged",
        },
      ],
    });

    expect(parsed.counts.pending).toBe(3);
    expect(parsed.severeCount).toBe(12);
    expect(parsed.severeIncidents).toHaveLength(1);
    expect(parsed.aggregates.storedObservations).toBe(9);
    expect(parsed.aggregates.positive[0]).toEqual({ topic: "staff", count: 5, reviews: 4 });
    expect(parsed.aggregates.byOutlet[0]?.locationId).toBe("loc-1");
    expect(parsed.aggregates.outletReviews["loc-1"]).toBe(4);
    expect(parsed.aggregates.staffPraise[0]?.name).toBe("Sanjana");
  });

  it("returns zeros for a missing payload", () => {
    const parsed = parseInsightDashboard(null);
    expect(parsed.counts.discovered).toBe(0);
    expect(parsed.aggregates.byMonth).toEqual([]);
    expect(parsed.severeIncidents).toEqual([]);
  });

  it("keeps more than twelve months on the sentiment trend for all-time ranges", () => {
    const byMonth = Array.from({ length: 20 }, (_, index) => {
      const year = 2024 + Math.floor(index / 12);
      const month = String((index % 12) + 1).padStart(2, "0");
      return { month: `${year}-${month}`, positive: index + 1, negative: 1 };
    });
    const shuffled = [...byMonth].reverse();
    const months = insightTrendMonths(shuffled);
    expect(months).toHaveLength(20);
    expect(months[0]?.month).toBe("2024-01");
    expect(months[months.length - 1]?.month).toBe("2025-08");
  });
});

describe("insightTopicInboxExtra", () => {
  it("maps complaint topics onto inbox theme filters when possible", () => {
    expect(insightTopicInboxExtra("staff", "complaint")).toEqual({ theme: "staff", stars: "low" });
    expect(insightTopicInboxExtra("service_speed", "complaint")).toEqual({ theme: "wait", stars: "low" });
    expect(insightTopicInboxExtra("assortment", "complaint")).toEqual({
      q: "assortment",
      stars: "low",
    });
  });

  it("searches praise topics instead of complaint_theme", () => {
    expect(insightTopicInboxExtra("staff", "praise")).toEqual({ q: "staff", stars: "positive" });
  });
});
