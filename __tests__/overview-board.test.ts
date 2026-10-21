import { describe, expect, it } from "vitest";
import { EMPTY_FACTS, type DashboardFacts } from "@/lib/metrics";
import { buildOverviewBoard, overviewQueryKey, type BoardLinks, type BoardPlace } from "@/lib/overview-board";

function facts(patch: Partial<DashboardFacts>): DashboardFacts {
  return { ...EMPTY_FACTS, ...patch };
}

const links: BoardLinks = {
  reviews: (extra) => `/reviews?${new URLSearchParams(extra).toString()}`,
  escalations: () => "/escalations",
  location: (place) => `/overview?location=${place.id}`,
  analytics: "/analytics",
  reports: "/reports",
  settings: "/settings",
};

const places: BoardPlace[] = [
  { id: "a", name: "Alpha", clientId: "c1", groupName: "North" },
  { id: "b", name: "Beta", clientId: "c1", groupName: "North" },
];

describe("overviewQueryKey", () => {
  it("keeps the scope and date params that change the page", () => {
    const params = new URLSearchParams("client=c1&group=g1&rating=2");
    expect(overviewQueryKey((key) => params.get(key))).toBe("c1|g1||||");
  });
});

describe("buildOverviewBoard", () => {
  it("weights the scope average by reviews and ranks outlets by their own average", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 10,
        ratingSum: 14,
        oneToThree: 9,
        replied: 4,
        unreplied: 6,
        locations: [
          { locationId: "a", reviews: 1, ratingSum: 5, oneToThree: 0, replied: 1, unreplied: 0, drafts: 0, responseHoursSum: 0, responseCount: 0 },
          { locationId: "b", reviews: 9, ratingSum: 9, oneToThree: 9, replied: 3, unreplied: 6, drafts: 0, responseHoursSum: 0, responseCount: 0 },
        ],
      }),
      previous: null,
      places,
      themes: [
        { locationId: "b", theme: "unspecified", count: 4 },
        { locationId: "b", theme: "staff", count: 2 },
      ],
      themesTruncated: false,
      links,
      attention: [],
    });

    expect(board.kpis.avgRating).toBeCloseTo(1.4);
    expect(board.kpis.avgRating).not.toBeCloseTo(3);
    expect(board.worst?.id).toBe("b");
    expect(board.worst?.complaint).toBe("Staff");
    expect(board.worst?.href).toBe("/overview?location=b");
    expect(board.lowest.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("hides outlet ranking when the scope is a single outlet", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 5,
        ratingSum: 20,
        locations: [
          { locationId: "a", reviews: 5, ratingSum: 20, oneToThree: 1, replied: 5, unreplied: 0, drafts: 0, responseHoursSum: 0, responseCount: 0 },
        ],
      }),
      previous: null,
      places: [places[0]!],
      themes: [],
      themesTruncated: false,
      links,
      attention: [],
    });
    expect(board.worst).toBeNull();
    expect(board.lowest).toEqual([]);
    expect(board.rankedCount).toBe(1);
  });

  it("calls a drop getting worse only when both periods have enough reviews", () => {
    const location = {
      locationId: "a",
      reviews: 5,
      ratingSum: 15,
      oneToThree: 2,
      replied: 5,
      unreplied: 0,
      drafts: 0,
      responseHoursSum: 0,
      responseCount: 0,
    };
    const previousLocation = { ...location, ratingSum: 25 };
    const thin = { ...previousLocation, reviews: 2, ratingSum: 10 };
    const enough = buildOverviewBoard({
      facts: facts({ reviews: 6, ratingSum: 20, locations: [location, { ...location, locationId: "b", ratingSum: 20 }] }),
      previous: facts({ reviews: 5, ratingSum: 25, locations: [previousLocation], themeMonths: [] }),
      places,
      themes: [],
      themesTruncated: false,
      links,
      attention: [],
    });
    expect(enough.insights.some((card) => card.tone === "worse" && card.title === "Alpha")).toBe(true);
    expect(enough.lowest.find((row) => row.id === "a")?.ratingChange).toBeCloseTo(-2);

    const small = buildOverviewBoard({
      facts: facts({ reviews: 5, ratingSum: 15, locations: [location] }),
      previous: facts({ reviews: 2, ratingSum: 10, locations: [thin] }),
      places,
      themes: [],
      themesTruncated: false,
      links,
      attention: [],
    });
    expect(small.insights.some((card) => card.tone === "worse")).toBe(false);
  });

  it("flags a complaint theme that was absent in the previous period", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 4,
        ratingSum: 8,
        themeMonths: [{ month: "2026-09-01", theme: "wait", count: 3 }],
      }),
      previous: facts({ reviews: 4, ratingSum: 16, themeMonths: [] }),
      places,
      themes: [],
      themesTruncated: false,
      links,
      attention: [],
    });
    const card = board.insights.find((item) => item.tone === "problem");
    expect(card?.title).toBe("Wait time");
    expect(card?.href).toContain("theme=wait");
    expect(board.themes[0]?.direction).toBe("new");
  });

  it("ignores a location that is outside the selected places", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 2,
        ratingSum: 6,
        locations: [
          { locationId: "a", reviews: 2, ratingSum: 6, oneToThree: 0, replied: 2, unreplied: 0, drafts: 0, responseHoursSum: 0, responseCount: 0 },
          { locationId: "other", reviews: 9, ratingSum: 9, oneToThree: 9, replied: 0, unreplied: 9, drafts: 0, responseHoursSum: 0, responseCount: 0 },
        ],
      }),
      previous: null,
      places: [places[0]!],
      themes: [],
      themesTruncated: false,
      links,
      attention: [],
    });
    expect(board.rankedCount).toBe(1);
    expect(board.worst).toBeNull();
  });
});
