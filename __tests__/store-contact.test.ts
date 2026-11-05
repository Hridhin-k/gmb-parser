import { describe, expect, it } from "vitest";
import { bulkContactAvailability, resolvedContact } from "@/lib/resolution-contact";

const defaults = { phone: "+44 1234567890", email: "central@example.test" };
describe("store contact resolution", () => {
  it("uses the default only when both store fields are empty", () => {
    expect(resolvedContact({ phone: null, email: null }, defaults)).toEqual(defaults);
    expect(resolvedContact({ phone: "+44 9876543210", email: null }, defaults))
      .toEqual({ phone: "+44 9876543210", email: null });
    expect(resolvedContact({ phone: null, email: "manager@example.test" }, defaults))
      .toEqual({ phone: null, email: "manager@example.test" });
  });
  it("offers bulk phone/email only when every selected store supports it", () => {
    expect(bulkContactAvailability([defaults, { phone: null, email: "store@example.test" }]))
      .toEqual({ phone: null, email: "Each store’s saved email" });
    expect(bulkContactAvailability([defaults, { phone: null, email: null }]))
      .toEqual({ phone: null, email: null });
    expect(bulkContactAvailability([])).toEqual({ phone: null, email: null });
  });
});
