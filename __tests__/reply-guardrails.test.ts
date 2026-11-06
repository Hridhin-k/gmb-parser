import { describe, expect, it } from "vitest";
import { adjustmentInstruction } from "@/lib/reply-adjustments";
import { comparePublishedReply } from "@/lib/reply-adjustments";
import { checkGeneratedReplyGuardrails, checkReplyGuardrails, negativeReviewNeedsApproval } from "@/lib/reply-guardrails";

describe("selected contact details and numeric staff codes", () => {
  const contact = { phone: "+44 7700 900123", email: "care@example.test" };
  it("allows the selected store contact naturally in a sentence", () => {
    expect(checkGeneratedReplyGuardrails("Please call +44 7700 900123 or email care@example.test so we can help with your visit.", contact)).toEqual([]);
  });
  it("rejects unselected or substituted phone/email values even with an approved contact", () => {
    for (const text of ["Please email other@example.test.", "Call +44 7700 900124.", "Email care@example.test or extra@example.test."]) {
      expect(checkGeneratedReplyGuardrails(text, contact).map((item) => item.code)).toContain("personal_contact");
    }
  });
  it("does not mistake an approved contact address for an offer", () => {
    expect(checkGeneratedReplyGuardrails("Please email refund@example.test so our team can help.", { phone: null, email: "refund@example.test" })).toEqual([]);
    expect(checkGeneratedReplyGuardrails("We will refund your visit. Email care@example.test.", contact).map((item) => item.code)).toContain("compensation");
  });
  it("keeps checking promises inside a legacy-shaped contact sentence", () => {
    expect(checkGeneratedReplyGuardrails("You can reach us at care@example.test for a refund so we can resolve this with you.", contact).map((item) => item.code)).toContain("compensation");
  });
  it.each(["Staff Member 2079", "employee number 2079", "cashier #2079", "team member 12345678"])("rejects numeric staff identity: %s", (name) => {
    expect(checkGeneratedReplyGuardrails(`We will pass your kind words to ${name}.`).map((item) => item.code)).toContain("staff_identity");
  });
  it("allows general thanks, real names and selected contact numbers", () => {
    for (const text of ["Thank you for the kind words about our service.", "We will share your feedback with our team.", "Thank you for mentioning Jane."]) {
      expect(checkGeneratedReplyGuardrails(text)).toEqual([]);
    }
    expect(checkGeneratedReplyGuardrails("Please reach our team at +44 7700 900123.", contact)).toEqual([]);
  });
});

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
