import { describe, expect, it } from "vitest";
import {
  buildClientOverview,
  oneToThreeCount,
  summarizeOverviewWindow,
  type OverviewTrendMonth,
} from "@/lib/services/overview";

const july: OverviewTrendMonth = {
  month: "2026-07-01",
  reviewCount: 10,
  avgRating: 4,
  negative: 2,
  positive: 6,
  replied: 8,
};

describe("oneToThreeCount", () => {
  it("counts 1–2 star reviews plus the 3-star remainder", () => {
    expect(oneToThreeCount(july)).toBe(4);
  });
});

describe("summarizeOverviewWindow", () => {
  it("weights rating and treats 1–3 stars as the negative share", () => {
    const summary = summarizeOverviewWindow([
      july,
      {
        month: "2026-08-01",
        reviewCount: 10,
        avgRating: 5,
        negative: 0,
        positive: 10,
        replied: 10,
      },
    ]);
    expect(summary.reviewCount).toBe(20);
    expect(summary.avgRating).toBe(4.5);
    expect(summary.negativeShare).toBe(0.2);
    expect(summary.replyRate).toBe(0.9);
    expect(summary.unreplied).toBe(2);
  });
});

describe("buildClientOverview", () => {
  const locations = [
    {
      id: "l1",
      clientId: "c1",
      clientName: "ACME Retail",
      name: "Thrissur Round East",
      isActive: true,
    },
    {
      id: "l2",
      clientId: "c1",
      clientName: "ACME Retail",
      name: "Calicut Mavoor Rd",
      isActive: false,
    },
    {
      id: "l3",
      clientId: "c2",
      clientName: "Other",
      name: "Other store",
      isActive: true,
    },
  ];

  const stats = [
    {
      locationId: "l1",
      reviewCount: 10,
      unanswered: 4,
      drafts: 2,
      critical: 3,
      ratingSum: 36,
    },
    {
      locationId: "l2",
      reviewCount: 5,
      unanswered: 0,
      drafts: 0,
      critical: 0,
      ratingSum: 24,
    },
    {
      locationId: "l3",
      reviewCount: 8,
      unanswered: 8,
      drafts: 1,
      critical: 1,
      ratingSum: 16,
    },
  ];

  it("keeps the queue, lowest locations, and themes inside the selected client", () => {
    const overview = buildClientOverview({
      clientId: "c1",
      expiredConnections: 1,
      months: [july],
      previousMonths: null,
      stats,
      locations,
      clients: [
        { id: "c1", name: "ACME Retail" },
        { id: "c2", name: "Other" },
      ],
    });

    expect(overview.current.negativeShare).toBe(0.4);
    expect(overview.previous).toBeNull();
    expect(overview.attention.map((item) => item.id)).toEqual([
      "unanswered",
      "drafts",
      "connections",
      "inactive",
    ]);
    expect(overview.attention[0]?.href).toBe("/reviews?filter=unanswered&client=c1");
    expect(overview.lowest.map((location) => location.id)).toEqual(["l1", "l2"]);
    expect(overview.lowest[0]?.rating).toBeCloseTo(3.6);
    expect(overview.praised).toEqual([]);
    expect(overview.complained).toEqual([]);
  });

  it("omits empty attention rows", () => {
    const overview = buildClientOverview({
      clientId: null,
      expiredConnections: 0,
      months: [],
      previousMonths: [],
      stats: [],
      locations: [
        {
          id: "l1",
          clientId: "c1",
          clientName: "ACME",
          name: "Store",
          isActive: true,
        },
      ],
      clients: [],
    });
    expect(overview.attention).toEqual([]);
    expect(overview.previous?.reviewCount).toBe(0);
  });
});
