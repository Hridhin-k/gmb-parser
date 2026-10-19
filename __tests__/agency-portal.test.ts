import { describe, expect, it } from "vitest";
import {
  createOnboardingSecret,
  domainStatus,
  hashOnboardingToken,
  onboardingLinkState,
  senderStatus,
  usageExportLines,
} from "@/lib/agency-portal";
import { clampListScope } from "@/lib/access";

describe("client onboarding links", () => {
  it("hides the token and expires the link", () => {
    const secret = createOnboardingSecret();
    expect(secret.token).not.toBe(secret.hash);
    expect(hashOnboardingToken(secret.token)).toBe(secret.hash);
    expect(onboardingLinkState({ expiresAt: "2026-10-20T00:00:00.000Z", usedAt: null }, new Date("2026-10-16T00:00:00.000Z"))).toBe("open");
    expect(onboardingLinkState({ expiresAt: "2026-10-01T00:00:00.000Z", usedAt: null }, new Date("2026-10-16T00:00:00.000Z"))).toBe("expired");
    expect(onboardingLinkState({ expiresAt: "2026-10-20T00:00:00.000Z", usedAt: "2026-10-16T00:00:00.000Z" })).toBe("used");
  });
});

describe("branding claims", () => {
  it("keeps a domain and sender inactive until they are verified", () => {
    expect(domainStatus({ domain: "reviews.example.com", verifiedAt: null }).active).toBe(false);
    expect(domainStatus({ domain: "reviews.example.com", verifiedAt: "2026-10-16T00:00:00.000Z" }).label).toMatch(/current address/);
    expect(senderStatus({ email: "hi@example.com", mailConfigured: false, configuredFrom: null }).active).toBe(false);
    expect(senderStatus({ email: "hi@example.com", mailConfigured: true, configuredFrom: "hi@example.com" }).active).toBe(true);
    expect(senderStatus({ email: "other@example.com", mailConfigured: true, configuredFrom: "hi@example.com" }).active).toBe(false);
  });
});

describe("usage export", () => {
  it("exports counts and no price", () => {
    const lines = usageExportLines(
      [{ name: "ACME", locations: 2, reviews: 10, publishedReplies: 4, recordedEvents: 1 }],
      "Last month"
    );
    expect(lines[0]?.join(",")).not.toMatch(/price|amount|invoice total/i);
    expect(lines[1]).toEqual(["ACME", "2", "10", "4", "1", "Last month"]);
  });
});

describe("tenant client filter", () => {
  it("drops another client's id", () => {
    const clamped = clampListScope(
      { clientId: "other-brand", locationId: "", groupId: "" },
      { clientId: "brand-1", groupId: null, locationId: null }
    );
    expect(clamped.clientId).toBe("00000000-0000-0000-0000-000000000000");
  });
});
