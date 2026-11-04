import { describe, expect, it } from "vitest";
import { adjustmentInstruction } from "@/lib/reply-adjustments";
import { comparePublishedReply } from "@/lib/reply-adjustments";
import { checkReplyGuardrails, negativeReviewNeedsApproval } from "@/lib/reply-guardrails";

describe("reply guardrails", () => {
  it("allows an ordinary apology", () => {
    expect(checkReplyGuardrails("We are sorry this visit fell short. Please contact the business directly.")).toEqual([]);
  });

  it("blocks compensation, medical claims, legal claims, and contact details", () => {
    expect(checkReplyGuardrails("We will refund your visit.").map((item) => item.code)).toContain("compensation");
    expect(checkReplyGuardrails("This will cure your pain.").map((item) => item.code)).toContain("medical");
    expect(checkReplyGuardrails("We accept liability for the injury.").map((item) => item.code)).toContain("legal");
    expect(checkReplyGuardrails("Email us at desk@example.com.").map((item) => item.code)).toContain("personal_contact");
    expect(checkReplyGuardrails("Call 98470 12345 and we will help.").map((item) => item.code)).toContain("personal_contact");
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

describe("saved resolution contact", () => {
  const saved = { phone: "+91 98470 11111", email: "care@example.com" };

  it("lets the saved phone and email through and still blocks any other", () => {
    const line = "You can reach us at +91 98470 11111 or care@example.com so we can resolve this with you.";
    expect(checkReplyGuardrails(line, saved)).toEqual([]);
    expect(checkReplyGuardrails(line)).toHaveLength(1);
    expect(checkReplyGuardrails("Call me on 98470 12345.", saved).map((item) => item.code)).toContain("personal_contact");
    expect(checkReplyGuardrails("Write to boss@example.com.", saved).map((item) => item.code)).toContain("personal_contact");
  });

  it("ignores an empty saved contact", () => {
    expect(checkReplyGuardrails("Email desk@example.com.", { phone: null, email: null })).toHaveLength(1);
  });
});
