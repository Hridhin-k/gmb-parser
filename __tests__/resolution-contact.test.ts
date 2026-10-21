import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  insertResolutionContact,
  normalizeResolutionContact,
  resolutionContactSentence,
} from "@/lib/resolution-contact";

const contact = { phone: "+91 98470 11111", email: "care@example.com" };

describe("resolution contact", () => {
  it("builds a phone, email, or both sentence", () => {
    expect(resolutionContactSentence("phone", contact)).toBe(
      "You can reach us at +91 98470 11111 so we can resolve this with you."
    );
    expect(resolutionContactSentence("email", contact)).toBe(
      "You can reach us at care@example.com so we can resolve this with you."
    );
    expect(resolutionContactSentence("both", contact)).toBe(
      "You can reach us at +91 98470 11111 or care@example.com so we can resolve this with you."
    );
    expect(resolutionContactSentence("both", { phone: contact.phone, email: null })).toBeNull();
  });

  it("appends the sentence and replaces an earlier one", () => {
    const first = insertResolutionContact("Sorry about this.", resolutionContactSentence("phone", contact)!);
    expect(first).toBe(
      "Sorry about this.\n\nYou can reach us at +91 98470 11111 so we can resolve this with you."
    );
    const next = insertResolutionContact(first, resolutionContactSentence("both", contact)!);
    expect(next).toBe(
      "Sorry about this.\n\nYou can reach us at +91 98470 11111 or care@example.com so we can resolve this with you."
    );
  });

  it("rejects a phone without enough digits and stores a lowercase email", () => {
    expect(() => normalizeResolutionContact({ phone: "call us", email: "" })).toThrow(ValidationError);
    expect(normalizeResolutionContact({ phone: "", email: "Care@Example.com" })).toEqual({
      phone: null,
      email: "care@example.com",
    });
  });
});
