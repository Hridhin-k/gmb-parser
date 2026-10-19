import { describe, expect, it } from "vitest";
import {
  inReviewWindow,
  median,
  rankRows,
  replySpeedBucket,
  responseHours,
  rollupByGroup,
  splitOnboarding,
  summarizeSamples,
  type ReviewSample,
} from "@/lib/analytics-metrics";

function sample(partial: Partial<ReviewSample> & Pick<ReviewSample, "stars">): ReviewSample {
  return {
    createdAt: "2026-06-01T00:00:00.000Z",
    hasReply: false,
    replyAt: null,
    language: null,
    autoReply: null,
    ...partial,
  };
}

describe("analytics aggregation", () => {
  it("weights the average by reviews instead of averaging location averages", () => {
    const rows = rankRows(
      [
        { id: "a", reviews: 1, ratingSum: 5, replied: 1, responseHoursSum: 1, responseCount: 1 },
        { id: "b", reviews: 99, ratingSum: 99, replied: 0, responseHoursSum: 0, responseCount: 0 },
      ],
      "rating"
    );
    expect(rows[0].id).toBe("a");
    expect(rows[0].ratingSum / rows[0].reviews).toBe(5);
    expect((5 + 99) / 100).toBeCloseTo(1.04);
    expect((5 + 1) / 2).toBe(3);
  });

  it("rolls a city into its region once", () => {
    const rolled = rollupByGroup(
      [
        { id: "city", groupId: "city", reviews: 2, ratingSum: 6, replied: 1, responseHoursSum: 4, responseCount: 1 },
        { id: "region", groupId: "region", reviews: 1, ratingSum: 5, replied: 1, responseHoursSum: 2, responseCount: 1 },
      ],
      (groupId) => (groupId === "city" ? "region" : null)
    );
    expect(rolled).toEqual([
      { id: "region", reviews: 3, ratingSum: 11, replied: 2, responseHoursSum: 6, responseCount: 2 },
    ]);
  });

  it("keeps an empty population as null rates", () => {
    const summary = summarizeSamples([]);
    expect(summary.reviews).toBe(0);
    expect(summary.avgRating).toBeNull();
    expect(summary.replyRate).toBeNull();
    expect(summary.medianHours).toBeNull();
    expect(summary.autoShare).toBeNull();
    expect(summary.buckets).toEqual({ under1h: 0, h1to6: 0, h6to24: 0, over24h: 0 });
  });
});

describe("reply time", () => {
  it("puts hour boundaries in the PDF buckets and ignores a missing timestamp", () => {
    expect(replySpeedBucket(0.9)).toBe("under1h");
    expect(replySpeedBucket(1)).toBe("h1to6");
    expect(replySpeedBucket(5.9)).toBe("h1to6");
    expect(replySpeedBucket(6)).toBe("h6to24");
    expect(replySpeedBucket(23.9)).toBe("h6to24");
    expect(replySpeedBucket(24)).toBe("over24h");
    expect(responseHours("2026-06-01T00:00:00.000Z", null)).toBeNull();
    expect(responseHours("2026-06-01T02:00:00.000Z", "2026-06-01T00:00:00.000Z")).toBeNull();
  });

  it("uses the middle pair for an even median", () => {
    expect(median([4, 1, 3])).toBe(3);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("window and onboarding", () => {
  const end = "2026-07-01T00:00:00.000Z";

  it("excludes a review that falls on the end boundary", () => {
    expect(inReviewWindow("2026-06-30T23:00:00.000Z", "2026-06-01T00:00:00.000Z", end)).toBe(true);
    expect(inReviewWindow(end, "2026-06-01T00:00:00.000Z", end)).toBe(false);
  });

  it("compares reviews before onboarding with reviews from that timestamp onward", () => {
    const rows = [
      sample({ stars: 2, createdAt: "2026-01-01T00:00:00.000Z", hasReply: true, replyAt: "2026-01-04T00:00:00.000Z" }),
      sample({ stars: 5, createdAt: "2026-05-01T00:00:00.000Z", hasReply: true, replyAt: "2026-05-01T03:00:00.000Z", autoReply: true }),
    ];
    const split = splitOnboarding(rows, "2026-04-01T00:00:00.000Z");
    expect(split.before.reviews).toBe(1);
    expect(split.before.avgRating).toBe(2);
    expect(split.before.medianHours).toBe(72);
    expect(split.after.avgRating).toBe(5);
    expect(split.after.medianHours).toBe(3);
    expect(split.after.autoShare).toBe(1);
    expect(splitOnboarding(rows, null).completedAt).toBeNull();
  });

  it("counts an unset language instead of dropping the review", () => {
    const summary = summarizeSamples([
      sample({ stars: 5, language: "en" }),
      sample({ stars: 4, language: null }),
    ]);
    expect(summary.languages.map((item) => item.label).sort()).toEqual(["English", "Not set"]);
    expect(summary.languages.every((item) => item.share === 0.5)).toBe(true);
  });
});

describe("ranking filters", () => {
  const rows = [
    { id: "slow", reviews: 4, ratingSum: 16, replied: 4, responseHoursSum: 40, responseCount: 4 },
    { id: "fast", reviews: 4, ratingSum: 12, replied: 2, responseHoursSum: 4, responseCount: 2 },
    { id: "empty", reviews: 0, ratingSum: 0, replied: 0, responseHoursSum: 0, responseCount: 0 },
  ];

  it("ranks by reply speed with missing times last", () => {
    expect(rankRows(rows, "time").map((row) => row.id)).toEqual(["fast", "slow", "empty"]);
    expect(rankRows(rows, "reply").map((row) => row.id)[0]).toBe("slow");
  });
});
