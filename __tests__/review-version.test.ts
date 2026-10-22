import { describe, expect, it } from "vitest";
import { absenceIsConfirmed, planReviewVersion, reviewsConfirmedMissing } from "@/lib/review-version";

const stored = {
  id: "r1",
  comment: "Great place!",
  starRating: 5,
  createTime: "2026-08-01T10:00:00Z",
  replyComment: null,
  contentFingerprint: null,
  responseFingerprint: null,
  missingOnGoogleAt: null,
};

describe("planReviewVersion", () => {
  it("treats a new review as created and changed", () => {
    const version = planReviewVersion(null, {
      starRating: 5,
      comment: "Great place!",
      createTime: "2026-08-01T10:00:00Z",
      replyComment: null,
    });
    expect(version.created).toBe(true);
    expect(version.contentChanged).toBe(true);
  });

  it("sees no content change when stars, text, and date match", () => {
    const version = planReviewVersion(stored, {
      starRating: 5,
      comment: "Great place!",
      createTime: "2026-08-01T10:00:00.000Z",
      replyComment: null,
    });
    expect(version.contentChanged).toBe(false);
    expect(version.responseChanged).toBe(false);
  });

  it("flags a Google reply change without a content change", () => {
    const version = planReviewVersion(stored, {
      starRating: 5,
      comment: "Great place!",
      createTime: "2026-08-01T10:00:00Z",
      replyComment: "Thanks!",
    });
    expect(version.contentChanged).toBe(false);
    expect(version.responseChanged).toBe(true);
  });
});

describe("absence detection", () => {
  it("confirms absence only after a complete full sync", () => {
    expect(absenceIsConfirmed({ mode: "full", providerFailed: false, truncated: false })).toBe(true);
    expect(absenceIsConfirmed({ mode: "incremental", providerFailed: false, truncated: false })).toBe(false);
    expect(absenceIsConfirmed({ mode: "full", providerFailed: true, truncated: false })).toBe(false);
    expect(absenceIsConfirmed({ mode: "full", providerFailed: false, truncated: true })).toBe(false);
  });

  it("lists stored reviews the sync did not return", () => {
    const missing = reviewsConfirmedMissing(
      [
        { googleReviewName: "a", missingOnGoogleAt: null },
        { googleReviewName: "b", missingOnGoogleAt: null },
        { googleReviewName: "c", missingOnGoogleAt: "2026-08-02T00:00:00Z" },
      ],
      new Set(["a"])
    );
    expect(missing.map((row) => row.googleReviewName)).toEqual(["b"]);
  });
});
