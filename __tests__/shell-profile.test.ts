import { describe, expect, it } from "vitest";
import { mergeProfileAttention, parseShellProfileCounts } from "@/lib/shell-profile";

describe("parseShellProfileCounts", () => {
  it("maps RPC rows and drops bad entries", () => {
    const counts = parseShellProfileCounts([
      { locationId: "loc-1", unreplied: 3, drafts: 1, failed: 0, escalations: 2 },
      { locationId: "", unreplied: 9 },
      null,
      { locationId: "loc-2", unreplied: "4" },
    ]);
    expect(counts).toEqual([
      { locationId: "loc-1", unreplied: 3, drafts: 1, failed: 0, escalations: 2 },
      { locationId: "loc-2", unreplied: 4, drafts: 0, failed: 0, escalations: 0 },
    ]);
  });

  it("returns empty for a missing payload", () => {
    expect(parseShellProfileCounts(null)).toEqual([]);
  });
});

describe("mergeProfileAttention", () => {
  it("adds names and keeps only locations needing attention", () => {
    const merged = mergeProfileAttention(
      [
        { locationId: "loc-1", unreplied: 2, drafts: 0, failed: 0, escalations: 0 },
        { locationId: "loc-2", unreplied: 0, drafts: 0, failed: 0, escalations: 0 },
      ],
      new Map([["loc-1", "Fazyo — Kochi"]])
    );
    expect(merged).toEqual([
      { id: "loc-1", name: "Fazyo — Kochi", unreplied: 2, escalations: 0, drafts: 0, failed: 0 },
    ]);
  });
});
