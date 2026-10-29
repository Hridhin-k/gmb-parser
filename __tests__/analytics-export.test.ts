import { describe, expect, it } from "vitest";
import { buildLeaderboardExportRows, leaderboardExportLines } from "@/lib/analytics-export";
import { EMPTY_FACTS, type DashboardFacts } from "@/lib/metrics";

function emptyFacts(overrides: Partial<DashboardFacts> = {}): DashboardFacts {
  return { ...EMPTY_FACTS, ...overrides };
}

describe("leaderboardExportLines", () => {
  it("exports location rows with the table columns", () => {
    const facts = emptyFacts({
      locations: [
        {
          locationId: "loc-a",
          reviews: 10,
          ratingSum: 40,
          oneToThree: 0,
          replied: 8,
          unreplied: 2,
          drafts: 0,
          responseHoursSum: 16,
          responseCount: 8,
        },
        {
          locationId: "loc-b",
          reviews: 2,
          ratingSum: 10,
          oneToThree: 0,
          replied: 2,
          unreplied: 0,
          drafts: 0,
          responseHoursSum: 2,
          responseCount: 2,
        },
      ],
    });
    const rows = buildLeaderboardExportRows({
      facts,
      locationNames: new Map([
        ["loc-a", "Alpha"],
        ["loc-b", "Beta"],
      ]),
      groupNames: new Map([["g1", "North"]]),
      groupOf: (id) => (id === "loc-a" || id === "loc-b" ? "g1" : null),
      parentOf: () => null,
      rankBy: "rating",
      show: "locations",
    });
    expect(rows[0]).toMatchObject({ rank: 1, name: "Beta", group: "North", reviews: 2 });
    expect(rows[1]).toMatchObject({ rank: 2, name: "Alpha", reviews: 10 });

    const lines = leaderboardExportLines(rows, "locations");
    expect(lines[0]).toEqual(["Rank", "Location", "Group", "Rating", "Reviews", "Reply rate", "Reply time"]);
    expect(lines[1]?.[1]).toBe("Beta");
    expect(lines[1]?.[3]).toBe("5.00");
    expect(lines[1]?.[5]).toBe("100%");
  });

  it("rolls locations into groups when show=groups", () => {
    const facts = emptyFacts({
      locations: [
        {
          locationId: "loc-a",
          reviews: 4,
          ratingSum: 16,
          oneToThree: 0,
          replied: 2,
          unreplied: 2,
          drafts: 0,
          responseHoursSum: 4,
          responseCount: 2,
        },
        {
          locationId: "loc-b",
          reviews: 6,
          ratingSum: 24,
          oneToThree: 0,
          replied: 3,
          unreplied: 3,
          drafts: 0,
          responseHoursSum: 6,
          responseCount: 3,
        },
      ],
    });
    const rows = buildLeaderboardExportRows({
      facts,
      locationNames: new Map([
        ["loc-a", "Alpha"],
        ["loc-b", "Beta"],
      ]),
      groupNames: new Map([["g1", "North"]]),
      groupOf: () => "g1",
      parentOf: () => null,
      rankBy: "reviews",
      show: "groups",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "North", reviews: 10, rank: 1 });
    expect(leaderboardExportLines(rows, "groups")[0]?.[1]).toBe("Group");
  });
});
