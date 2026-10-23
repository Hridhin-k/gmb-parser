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
  insights: "/insights",
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
      complaints: [{ locationId: "b", topic: "wait_time", count: 4 }],
      topics: [],
      coverage: { analysed: 0, ratingOnly: 0 },
      links,
      attention: [],
    });

    expect(board.kpis.avgRating).toBeCloseTo(1.4);
    expect(board.kpis.avgRating).not.toBeCloseTo(3);
    expect(board.worst?.id).toBe("b");
    expect(board.worst?.complaint).toBe("Wait Time");
    expect(board.worst?.href).toBe("/overview?location=b");
    expect(board.lowest.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("names the negative topic with the most mentions and leaves a blank when there is none", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 10,
        ratingSum: 14,
        locations: [
          { locationId: "a", reviews: 1, ratingSum: 5, oneToThree: 0, replied: 1, unreplied: 0, drafts: 0, responseHoursSum: 0, responseCount: 0 },
          { locationId: "b", reviews: 9, ratingSum: 9, oneToThree: 9, replied: 3, unreplied: 6, drafts: 0, responseHoursSum: 0, responseCount: 0 },
        ],
      }),
      previous: null,
      places,
      complaints: [{ locationId: "b", topic: "staff", count: 6 }],
      topics: [
        { topic: "food_quality", count: 2, reviews: 2 },
        { topic: "staff", count: 6, reviews: 5 },
      ],
      coverage: { analysed: 8, ratingOnly: 3 },
      links,
      attention: [],
    });

    expect(board.worst?.complaint).toBe("Staff");
    expect(board.lowest.find((row) => row.id === "a")?.complaint).toBeNull();
    expect(board.themes.map((theme) => theme.label)).toEqual(["Staff", "Food Quality"]);
    expect(board.themes[0]?.href).toBe("/insights");
    expect(board.coverage).toEqual({ analysed: 8, ratingOnly: 3 });
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
      complaints: [],
      topics: [],
      coverage: { analysed: 0, ratingOnly: 0 },
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
      complaints: [],
      topics: [],
      coverage: { analysed: 0, ratingOnly: 0 },
      links,
      attention: [],
    });
    expect(enough.lowest.find((row) => row.id === "a")?.ratingChange).toBeCloseTo(-2);

    const small = buildOverviewBoard({
      facts: facts({ reviews: 5, ratingSum: 15, locations: [location] }),
      previous: facts({ reviews: 2, ratingSum: 10, locations: [thin] }),
      places,
      complaints: [],
      topics: [],
      coverage: { analysed: 0, ratingOnly: 0 },
      links,
      attention: [],
    });
  });

  it("splits the month chart into 4–5, 3, and 1–2 stars", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 4,
        ratingSum: 8,
        stars: [1, 0, 2, 1, 0],
        months: [{
          month: "2026-09-01",
          reviews: 4,
          ratingSum: 8,
          positive: 1,
          oneToThree: 3,
          negative: 1,
          replied: 2,
        }],
      }),
      previous: null,
      places,
      complaints: [],
      topics: [{ topic: "wait_time", count: 3, reviews: 2 }],
      coverage: { analysed: 2, ratingOnly: 1 },
      links,
      attention: [],
    });
    expect(board.months[0]).toMatchObject({ positive: 1, neutral: 2, negative: 1 });
    expect(board.starMix.map((row) => row.count)).toEqual([0, 1, 2, 0, 1]);
    expect(board.themes[0]?.label).toBe("Wait Time");
    expect(board.themes[0]?.count).toBe(3);
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
      complaints: [],
      topics: [],
      coverage: { analysed: 0, ratingOnly: 0 },
      links,
      attention: [],
    });
    expect(board.rankedCount).toBe(1);
    expect(board.worst).toBeNull();
  });

  it("summarises the period and keeps a short AI report glimpse", () => {
    const board = buildOverviewBoard({
      facts: facts({
        reviews: 10,
        ratingSum: 40,
        oneToThree: 2,
        replied: 8,
        unreplied: 2,
        responseHoursSum: 80,
        responseCount: 4,
        locations: [
          { locationId: "a", reviews: 4, ratingSum: 16, oneToThree: 1, replied: 4, unreplied: 0, drafts: 0, responseHoursSum: 20, responseCount: 2 },
          { locationId: "b", reviews: 6, ratingSum: 24, oneToThree: 1, replied: 4, unreplied: 2, drafts: 0, responseHoursSum: 60, responseCount: 2 },
        ],
      }),
      previous: facts({ reviews: 8, ratingSum: 24, responseHoursSum: 40, responseCount: 4 }),
      places,
      complaints: [],
      topics: [
        { topic: "staff", count: 4, reviews: 3 },
        { topic: "price", count: 1, reviews: 1 },
      ],
      praise: [
        { topic: "staff", count: 6, reviews: 5 },
        { topic: "cleanliness", count: 2, reviews: 2 },
      ],
      staff: [
        { name: "Asha", count: 3 },
        { name: "Ravi", count: 1 },
      ],
      severeCount: 1,
      severeExcerpt: "  The queue reached the street.  ",
      severeStars: 1,
      reportStatus: "partial",
      reportFinishedAt: "2026-10-01T12:00:00.000Z",
      periodLabel: "Last 3 months",
      reportInsights: [
        {
          title: "Queues are the main complaint",
          detail: "Wait time shows up on 4 analysed reviews.",
          sentiment: "negative",
          category: "recurring_issue",
          suggestedAction: "Staff the counter at lunch.",
          supportingReviews: 4,
          evidenceExcerpts: ["We waited 40 minutes."],
          severity: 2,
        },
        {
          title: "Staff are the reason people return",
          detail: "Named staff are praised more often than they are criticised.",
          sentiment: "positive",
          category: "recurring_strength",
          supportingReviews: 6,
          evidenceExcerpts: ["Asha was patient."],
        },
      ],
      coverage: { analysed: 8, ratingOnly: 2 },
      links,
      attention: [],
    });

    expect(board.periodLabel).toBe("Last 3 months");
    expect(board.brief[0]).toContain("Last 3 months. 10 reviews, average 4.00.");
    expect(board.brief[0]).toContain("Up 1.00 from the previous period");
    expect(board.brief[1]).toBe("20% are 1–3 stars, the reply rate is 80%, the average reply time is 20h.");
    expect(board.brief[2]).toContain("Staff (4 mentions)");
    expect(board.brief[2]).toContain("Staff (6 mentions)");
    expect(board.kpis.avgResponseHours).toBe(20);
    expect(board.kpis.previousAvgResponseHours).toBe(10);
    expect(board.sentiment).toEqual({ positive: 8, negative: 5 });
    expect(board.praiseThemes[0]).toMatchObject({ label: "Staff", count: 6, reviews: 5 });
    expect(board.themes[0]).toMatchObject({ label: "Staff", count: 4, reviews: 3 });
    expect(board.themeMix[0]).toMatchObject({ label: "Staff", positive: 6, negative: 4, total: 10 });
    expect(board.themeMix[0]?.share).toBeCloseTo(10 / 13);
    expect(board.staff.map((row) => row.name)).toEqual(["Asha", "Ravi"]);
    expect(board.severe).toEqual({ count: 1, excerpt: "The queue reached the street.", stars: 1 });
    expect(board.report?.status).toBe("partial");
    expect(board.report?.cards.map((card) => card.kind)).toEqual(["concern", "strength", "action"]);
    expect(board.report?.cards[2]?.detail).toBe("Staff the counter at lunch.");
    expect(board.report?.cards[0]?.excerpt).toBe("We waited 40 minutes.");
    expect(board.analysis.map((card) => card.label)).toEqual(["Main complaint", "Strongest praise"]);
    expect(board.analysis[0]).toMatchObject({ title: "Staff", supportingReviews: 3 });
    expect(board.analysis[1]).toMatchObject({ title: "Staff", supportingReviews: 5 });
  });

  it("leaves the written report out when nothing has been saved for the period", () => {
    const board = buildOverviewBoard({
      facts: facts({ reviews: 0 }),
      previous: null,
      places,
      complaints: [],
      topics: [],
      reportStatus: "processing",
      reportInsights: [{ title: "Ignored", detail: "Still running.", sentiment: "negative", category: "trend" }],
      coverage: { analysed: 0, ratingOnly: 0 },
      links,
      attention: [],
    });
    expect(board.report).toBeNull();
    expect(board.analysis).toEqual([]);
    expect(board.brief).toEqual(["This period. No reviews in this period."]);
  });
});
