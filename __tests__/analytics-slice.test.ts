import { describe, expect, it } from "vitest";
import { sliceFromRpc, summaryFromRpc } from "@/lib/analytics-slice";

const RAW = {
  reviews: 4,
  ratingSum: 14,
  replied: 3,
  medianHours: 2.5,
  untimedReplies: 1,
  buckets: { under1h: 1, h1to6: 1, h6to24: 0, over24h: 0 },
  bucketStars: {
    under1h: [0, 0, 0, 1, 0],
    h1to6: [1, 0, 0, 0, 0],
    h6to24: [0, 0, 0, 0, 0],
    over24h: [0, 0, 0, 0, 0],
  },
  languages: [
    { id: "en", count: 2 },
    { id: "xx", count: 1 },
    { id: "unset", count: 1 },
  ],
  publishedHere: 2,
  autoAi: 1,
};

describe("summaryFromRpc", () => {
  it("maps aggregates into a SampleSummary", () => {
    const s = summaryFromRpc(RAW);
    expect(s.reviews).toBe(4);
    expect(s.avgRating).toBeCloseTo(3.5);
    expect(s.replyRate).toBeCloseTo(0.75);
    expect(s.medianHours).toBe(2.5);
    expect(s.buckets.under1h).toBe(1);
    expect(s.bucketStars.h1to6[0]).toBe(1);
    expect(s.autoShare).toBeCloseTo(0.5);
    // Unknown language ids fold into "Not set", like the row-based code did.
    expect(s.languages.find((l) => l.id === "unset")?.count).toBe(2);
    expect(s.languages[0]?.label).toBe("English");
  });

  it("returns an empty summary for a missing payload", () => {
    const s = summaryFromRpc(null);
    expect(s.reviews).toBe(0);
    expect(s.avgRating).toBeNull();
    expect(s.autoShare).toBeNull();
  });
});

describe("sliceFromRpc", () => {
  it("keeps onboarding empty when onboarding never completed", () => {
    const slice = sliceFromRpc({ window: RAW, before: RAW, after: RAW }, null);
    expect(slice.onboarding.completedAt).toBeNull();
    expect(slice.onboarding.before.reviews).toBe(0);
    expect(slice.truncated).toBe(false);
  });

  it("uses before/after when onboarding completed", () => {
    const slice = sliceFromRpc({ window: RAW, before: RAW, after: RAW }, "2026-01-01T00:00:00.000Z");
    expect(slice.onboarding.completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(slice.onboarding.after.reviews).toBe(4);
  });
});
