import { describe, expect, it } from "vitest";
import { ratingOnlyFallback } from "@/lib/rating-only-fallback";
import { checkGeneratedReplyGuardrails } from "@/lib/reply-guardrails";

const input = { comment: null, stars: 5, neverSay: [] };
describe("rating-only recovery", () => {
  it.each([1, 2, 3, 4, 5])("uses a safe acknowledgement without invented review details for %s stars", (stars) => {
    const text = ratingOnlyFallback({ ...input, stars });
    expect(text).toBeTruthy();
    expect(checkGeneratedReplyGuardrails(text!)).toEqual([]);
    expect(text).not.toMatch(/retrained|refund|discount|food|service was/);
    expect(text!.includes("understand how to improve")).toBe(stars <= 3);
  });
  it("honours never-say rules and gives up when no prepared wording is allowed", () => {
    expect(ratingOnlyFallback({ ...input, neverSay: ["thank you"] })).toMatch(/^Thanks/);
    expect(ratingOnlyFallback({ ...input, neverSay: ["thank you", "thanks"] })).toBeNull();
  });
  it("does not discard written review content, existing drafts or requested rewrites", () => {
    expect(ratingOnlyFallback({ ...input, comment: "A long wait." })).toBeNull();
    expect(ratingOnlyFallback({ ...input, previousDraft: "The edited draft." })).toBeNull();
    expect(ratingOnlyFallback({ ...input, adjustment: { kind: "language", language: "ml" } })).toBeNull();
    expect(ratingOnlyFallback({ ...input, adjustment: { kind: "shorter" } })).toBeNull();
  });
});
