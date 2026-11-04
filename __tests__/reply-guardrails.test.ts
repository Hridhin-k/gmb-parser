import { describe, expect, it } from "vitest";
import { adjustmentInstruction } from "@/lib/reply-adjustments";
import { comparePublishedReply } from "@/lib/reply-adjustments";
import { checkGeneratedReplyGuardrails, checkReplyGuardrails, negativeReviewNeedsApproval } from "@/lib/reply-guardrails";

describe("reply guardrails", () => {
  it("allows an ordinary apology", () => {
    expect(checkReplyGuardrails("We are sorry this visit fell short. Please contact the business directly.")).toEqual([]);
  });

  it("blocks compensation, medical claims, and legal claims", () => {
    expect(checkReplyGuardrails("We will refund your visit.").map((item) => item.code)).toContain("compensation");
    expect(checkReplyGuardrails("This will cure your pain.").map((item) => item.code)).toContain("medical");
    expect(checkReplyGuardrails("We accept liability for the injury.").map((item) => item.code)).toContain("legal");
  });

  it.each([
    "Email us at desk@example.com.",
    "Call 98470 12345 and we will help.",
    "Please call +91 (98470) 12345 or email support@example.com.",
  ])("allows human-added business contacts but blocks generated contacts: %s", (content) => {
    expect(checkReplyGuardrails(content)).toEqual([]);
    expect(checkGeneratedReplyGuardrails(content).map((item) => item.code)).toContain("personal_contact");
  });

  it("keeps the other content checks for generated replies", () => {
    expect(checkGeneratedReplyGuardrails("We will refund your visit. Email desk@example.com.").map((item) => item.code))
      .toEqual(["compensation", "personal_contact"]);
    expect(checkGeneratedReplyGuardrails("Thank you for visiting.")).toEqual([]);
  });

  it("does not treat a passing check as permission to publish", () => {
    expect(checkReplyGuardrails("Thank you for coming in.")).toEqual([]);
    expect(negativeReviewNeedsApproval(3)).toBe(true);
    expect(negativeReviewNeedsApproval(4)).toBe(false);
  });
});

describe("reply adjustments", () => {
  it("asks for a revision in the chosen language without translating the review", () => {
    const text = adjustmentInstruction({ kind: "language", language: "manglish" }, "Thank you.");
    expect(text).toContain("Manglish");
    expect(text).toContain("not a translation of their review");
    expect(adjustmentInstruction({ kind: "shorter" }, "Thank you for visiting.")).toContain("shorter");
    expect(adjustmentInstruction({ kind: "regenerate" }, "Thank you.")).toBe("");
  });

  it("matches a confirmed Google reply and refuses a different one", () => {
    expect(comparePublishedReply("Thank you.", "Thank you.")).toBe("matched");
    expect(comparePublishedReply("Thank you.", "  Thank   you. ")).toBe("matched");
    expect(comparePublishedReply("Thank you.", null)).toBe("absent");
    expect(comparePublishedReply("Thank you.", "A different reply")).toBe("different");
  });
});
