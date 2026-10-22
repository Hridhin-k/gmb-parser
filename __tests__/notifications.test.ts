import { describe, expect, it } from "vitest";
import { FRESH_REVIEW_MS, isFreshReview } from "@/lib/services/notifications";

describe("isFreshReview", () => {
  const now = Date.parse("2026-10-22T00:00:00.000Z");

  it("counts a review from the last week", () => {
    expect(isFreshReview("2026-10-20T12:00:00.000Z", now)).toBe(true);
  });

  it("skips a review older than a week", () => {
    expect(isFreshReview(new Date(now - FRESH_REVIEW_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("skips a review with no usable time", () => {
    expect(isFreshReview("not-a-date", now)).toBe(false);
  });
});
