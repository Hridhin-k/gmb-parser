import { describe, expect, it } from "vitest";
import {
  authMethods,
  holdReasons,
  inviteExpiresAt,
  isInviteExpired,
  matchCsvGroups,
  parseGroupCsv,
  placeFromStoredAddress,
  shouldEnterWizard,
  stepUnlocked,
  suggestGroups,
  toneInstruction,
} from "@/lib/onboarding";

describe("auth methods", () => {
  it("only lists Google when nothing else is configured", () => {
    const methods = authMethods();
    expect(methods.map((method) => method.id)).toEqual(["google"]);
    expect(methods[0]?.available).toBe(true);
  });

  it("adds a method only when its provider flag is set", () => {
    const methods = authMethods({ microsoft: true, email: true, ssoDomain: "acme.com", phone: true });
    expect(methods.map((method) => method.id)).toEqual([
      "google",
      "microsoft",
      "email",
      "sso",
      "phone",
    ]);
    expect(methods.every((method) => method.available)).toBe(true);
    expect(methods.find((method) => method.id === "sso")?.ssoDomain).toBe("acme.com");
  });
});

describe("location holds", () => {
  it("holds the later copy of a place id and a matching name", () => {
    const reasons = holdReasons([
      {
        id: "a",
        placeId: "p1",
        title: "East",
        address: "1 Road, Kochi, Kerala, 682001, IN",
        googleDuplicateOf: null,
        voiceOfMerchant: true,
        accountUnverified: false,
      },
      {
        id: "b",
        placeId: "p1",
        title: "East copy",
        address: "9 Road, Kochi, Kerala, 682001, IN",
        googleDuplicateOf: null,
        voiceOfMerchant: true,
        accountUnverified: false,
      },
    ]);
    expect(reasons.get("a")).toBeNull();
    expect(reasons.get("b")).toBe("duplicate");
  });

  it("holds a profile Google already calls a duplicate", () => {
    const reasons = holdReasons([
      {
        id: "a",
        placeId: "p1",
        title: "East",
        address: "1 Road, Kochi, Kerala, 682001, IN",
        googleDuplicateOf: "locations/original",
        voiceOfMerchant: null,
        accountUnverified: false,
      },
    ]);
    expect(reasons.get("a")).toBe("duplicate");
  });

  it("does not hold a profile when only the Google account is unverified", () => {
    const reasons = holdReasons([
      {
        id: "a",
        placeId: "p1",
        title: "East",
        address: "1 Road",
        googleDuplicateOf: null,
        voiceOfMerchant: null,
        accountUnverified: true,
      },
    ]);
    expect(reasons.get("a")).toBeNull();
  });

  it("does not treat a missing verification flag as unverified", () => {
    const reasons = holdReasons([
      {
        id: "a",
        placeId: "p1",
        title: "East",
        address: "1 Road",
        googleDuplicateOf: null,
        voiceOfMerchant: null,
        accountUnverified: false,
      },
    ]);
    expect(reasons.get("a")).toBeNull();
  });

  it("holds a profile Google says is unverified", () => {
    const reasons = holdReasons([
      {
        id: "a",
        placeId: null,
        title: "East",
        address: "1 Road",
        googleDuplicateOf: null,
        voiceOfMerchant: false,
        accountUnverified: false,
      },
    ]);
    expect(reasons.get("a")).toBe("unverified");
  });
});

describe("groups", () => {
  const locations = [
    {
      id: "1",
      title: "East Fort",
      address: "12 Street, Thiruvananthapuram, Kerala, 695001, IN",
      accountName: "Explained",
      holdReason: null,
    },
    {
      id: "2",
      title: "Duplicate",
      address: "12 Street, Thiruvananthapuram, Kerala, 695001, IN",
      accountName: "Explained",
      holdReason: "duplicate" as const,
    },
  ];

  it("reads city and state from the stored address order", () => {
    expect(placeFromStoredAddress(locations[0]?.address)).toEqual({
      city: "Thiruvananthapuram",
      state: "Kerala",
    });
  });

  it("suggests state and city groups and leaves held profiles out", () => {
    const suggestion = suggestGroups("state_city", locations);
    expect(suggestion.groups).toEqual([
      {
        name: "Kerala · Thiruvananthapuram",
        source: "state_city",
        locationIds: ["1"],
      },
    ]);
    expect(suggestion.unplacedIds).toEqual(["2"]);
  });

  it("parses a csv and refuses an ambiguous location name", () => {
    expect(parseGroupCsv("location,group\nEast Fort,Kerala\n")).toEqual([
      { location: "East Fort", group: "Kerala" },
    ]);
    const matched = matchCsvGroups(
      [
        { location: "East Fort", group: "Kerala" },
        { location: "Missing", group: "Kerala" },
      ],
      [
        { id: "1", title: "East Fort", holdReason: null },
        { id: "2", title: "East Fort", holdReason: null },
      ]
    );
    expect(matched.groups).toHaveLength(0);
    expect(matched.errors.join(" ")).toContain("matches 2");
    expect(matched.errors.join(" ")).toContain("Missing");
  });
});

describe("setup progress and invites", () => {
  it("sends an empty workspace into setup and leaves a connected one alone", () => {
    expect(shouldEnterWizard({ completed: false, connections: 0, locations: 0 })).toBe(true);
    expect(shouldEnterWizard({ completed: false, connections: 1, locations: 0 })).toBe(false);
    expect(shouldEnterWizard({ completed: true, connections: 0, locations: 0 })).toBe(false);
  });

  it("unlocks a step that already has its data", () => {
    expect(
      stepUnlocked("import", {
        step: "connect",
        connections: 1,
        locations: 0,
        grouping: null,
        toneVoice: null,
      })
    ).toBe(true);
    expect(
      stepUnlocked("tone", {
        step: "groups",
        connections: 1,
        locations: 2,
        grouping: null,
        toneVoice: null,
      })
    ).toBe(false);
  });

  it("expires an invite after 14 days", () => {
    const start = Date.parse("2026-10-01T00:00:00.000Z");
    const expires = inviteExpiresAt(start);
    expect(isInviteExpired(expires, start + 13 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(isInviteExpired(expires, start + 14 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("writes a tone instruction only when a voice or note exists", () => {
    expect(toneInstruction(null, "  ")).toBe("");
    expect(toneInstruction("warm", "Keep it local")).toContain("warm and human");
    expect(toneInstruction("warm", "Keep it local")).toContain("Keep it local");
  });
});
