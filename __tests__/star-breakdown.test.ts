import { describe, expect, it } from "vitest";
import { EMPTY_FACTS } from "@/lib/metrics";
import { applyStarBreakdown, monthKeyInZone, tallyStarReviews } from "@/lib/star-breakdown";

describe("star breakdown", () => {
  it("puts a review in the workspace month, not the UTC month", () => {
    expect(monthKeyInZone("2026-04-30T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-05-01");
    expect(monthKeyInZone("2026-04-30T18:00:00.000Z", "Asia/Kolkata")).toBe("2026-04-01");
  });

  it("counts 1★–5★ for a month, location, group, and low-star theme", () => {
    const maps = tallyStarReviews(
      [
        { stars: 5, createdAt: "2026-05-02T00:00:00.000Z", locationId: "a", groupId: "g", theme: "wait" },
        { stars: 1, createdAt: "2026-05-03T00:00:00.000Z", locationId: "a", groupId: "g", theme: null },
        { stars: 4, createdAt: "2026-06-01T00:00:00.000Z", locationId: "b", groupId: null, theme: "wait" },
      ],
      "UTC"
    );
    expect(maps.months.get("2026-05-01")).toEqual([1, 0, 0, 0, 1]);
    expect(maps.locations.get("a")).toEqual([1, 0, 0, 0, 1]);
    expect(maps.groups.get("g")).toEqual([1, 0, 0, 0, 1]);
    expect(maps.themes.get("2026-05-01\tunspecified")).toEqual([1, 0, 0, 0, 0]);
    expect(maps.themes.has("2026-05-01\twait")).toBe(false);
    expect(maps.themeGroups.get("\twait")).toBeUndefined();

    const facts = applyStarBreakdown(
      {
        ...EMPTY_FACTS,
        months: [
          {
            month: "2026-05-01",
            reviews: 2,
            ratingSum: 6,
            positive: 1,
            oneToThree: 1,
            negative: 1,
            replied: 0,
          },
        ],
      },
      maps
    );
    expect(facts.months[0]?.stars).toEqual([1, 0, 0, 0, 1]);
  });
});
