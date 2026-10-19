import { describe, expect, it } from "vitest";
import {
  detectComplaintTheme,
  detectReviewLanguage,
  shouldReopenReview,
  workflowState,
} from "@/lib/review-inbox";

describe("review inbox signals", () => {
  it("detects script language from the original text, not the Google translation", () => {
    expect(detectReviewLanguage(null)).toBe("none");
    expect(detectReviewLanguage("   ")).toBe("none");
    expect(detectReviewLanguage("Great service")).toBe("en");
    expect(detectReviewLanguage("വളരെ നല്ലത്")).toBe("ml");
    expect(detectReviewLanguage("बहुत अच्छा")).toBe("hi");
    expect(detectReviewLanguage("மிகவும் நல்லது")).toBe("ta");
    expect(detectReviewLanguage("خدمة ممتازة")).toBe("ar");
    expect(
      detectReviewLanguage("(Translated by Google) Very good\n\n(Original)\nവളരെ നല്ലത്")
    ).toBe("ml");
  });

  it("tags a complaint theme only for 1–3 star reviews", () => {
    expect(detectComplaintTheme("The wait was too long", 2)).toBe("wait");
    expect(detectComplaintTheme("Rude staff at the counter", 1)).toBe("staff");
    expect(detectComplaintTheme("Too expensive", 3)).toBe("price");
    expect(detectComplaintTheme("The room was dirty", 2)).toBe("cleanliness");
    expect(detectComplaintTheme("The product was broken", 1)).toBe("quality");
    expect(detectComplaintTheme("Not happy", 2)).toBe("unspecified");
    expect(detectComplaintTheme(null, 1)).toBe("unspecified");
    expect(detectComplaintTheme("The wait was too long", 5)).toBeNull();
    expect(detectComplaintTheme("Loved it", 4)).toBeNull();
  });

  it("derives one workflow label and does not invent a scheduled state", () => {
    expect(workflowState({ replyStatus: "none", starRating: 5, reopenedAt: null, hasGoogleReply: false }).id).toBe(
      "unreplied"
    );
    expect(workflowState({ replyStatus: "none", starRating: 2, reopenedAt: null, hasGoogleReply: false }).id).toBe(
      "escalated"
    );
    expect(workflowState({ replyStatus: "draft", starRating: 5, reopenedAt: null, hasGoogleReply: false }).id).toBe(
      "draft"
    );
    expect(workflowState({ replyStatus: "approved", starRating: 5, reopenedAt: null, hasGoogleReply: false }).id).toBe(
      "ready"
    );
    expect(workflowState({ replyStatus: "published", starRating: 5, reopenedAt: null, hasGoogleReply: true }).id).toBe(
      "replied"
    );
    expect(
      workflowState({
        replyStatus: "published",
        starRating: 2,
        reopenedAt: "2026-10-16T00:00:00.000Z",
        hasGoogleReply: true,
      }).id
    ).toBe("reopened");
    expect(workflowState({ replyStatus: "failed", starRating: 1, reopenedAt: null, hasGoogleReply: false }).id).toBe(
      "failed"
    );
  });

  it("reopens only a published reply whose stars or text changed", () => {
    expect(
      shouldReopenReview({
        replyStatus: "published",
        previousComment: "Good",
        previousStars: 5,
        nextComment: "Good",
        nextStars: 5,
      })
    ).toBe(false);
    expect(
      shouldReopenReview({
        replyStatus: "published",
        previousComment: "Good",
        previousStars: 5,
        nextComment: "Actually bad",
        nextStars: 5,
      })
    ).toBe(true);
    expect(
      shouldReopenReview({
        replyStatus: "draft",
        previousComment: "Good",
        previousStars: 5,
        nextComment: "Bad",
        nextStars: 1,
      })
    ).toBe(false);
    expect(
      shouldReopenReview({
        replyStatus: "pending_publish",
        previousComment: "Good",
        previousStars: 5,
        nextComment: "Good",
        nextStars: 1,
      })
    ).toBe(true);
  });
});
