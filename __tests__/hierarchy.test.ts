import { describe, expect, it } from "vitest";
import {
  connectionView,
  describeSetting,
  emptyFields,
  groupIdsInScope,
  groupAssignmentError,
  groupShapeError,
  locationInGroup,
  locationMoveError,
  mergeGroupsError,
  sharedPlaceIds,
  type SettingNode,
} from "@/lib/hierarchy";

function node(id: string, label: string, tone: SettingNode["fields"]["toneVoice"], hours: number | null = null): SettingNode {
  return { id, label, fields: { ...emptyFields(), toneVoice: tone, slaHours: hours } };
}

describe("inherited settings", () => {
  const workspace = { value: "professional" as const, source: "the workspace" };

  it("uses a child override before the parent", () => {
    const resolved = describeSetting(
      [node("city", "Kochi", "brief"), node("brand", "ACME Fashion", "warm")],
      (fields) => fields.toneVoice,
      workspace
    );
    expect(resolved).toEqual({ value: "brief", source: "Kochi", overridden: true });
  });

  it("restores the parent value when the override is cleared", () => {
    const resolved = describeSetting(
      [node("city", "Kochi", null), node("brand", "ACME Fashion", "warm")],
      (fields) => fields.toneVoice,
      workspace
    );
    expect(resolved).toEqual({ value: "warm", source: "ACME Fashion", overridden: false });
  });

  it("falls back to the workspace when nobody sets a value", () => {
    const resolved = describeSetting([node("city", "Kochi", null)], (fields) => fields.toneVoice, workspace);
    expect(resolved).toEqual({ value: "professional", source: "the workspace", overridden: false });
  });
});

describe("hierarchy rules", () => {
  it("rejects a city under a city and a group in another organization", () => {
    expect(
      groupShapeError({
        workspaceId: "org",
        clientId: "brand",
        kind: "city",
        parent: { id: "city", workspaceId: "org", clientId: "brand", kind: "city", parentId: "region" },
      })
    ).toMatch(/cannot contain/);
    expect(
      groupShapeError({
        workspaceId: "org",
        clientId: "brand",
        kind: "city",
        parent: { id: "region", workspaceId: "other", clientId: "brand", kind: "region", parentId: null },
      })
    ).toMatch(/another organization/);
  });

  it("rejects a location move into another brand", () => {
    expect(
      locationMoveError({
        locationWorkspaceId: "org",
        groupWorkspaceId: "org",
        locationClientId: "gympod",
        groupClientId: "kalyan",
      })
    ).toMatch(/another brand/);
    expect(
      locationMoveError({
        locationWorkspaceId: "org",
        groupWorkspaceId: "org",
        locationClientId: "gympod",
        groupClientId: "gympod",
      })
    ).toBeNull();
  });

  it("rejects merging a region into a city", () => {
    expect(
      mergeGroupsError({
        source: { id: "a", kind: "region", clientId: "brand", parentId: null },
        target: { id: "b", kind: "city", clientId: "brand", parentId: "a" },
      })
    ).toMatch(/region cannot be merged/);
  });

  it("includes child cities when a region is selected", () => {
    const groups = [
      { id: "region", parentId: null },
      { id: "kochi", parentId: "region" },
    ];
    expect(groupIdsInScope("region", groups).sort()).toEqual(["kochi", "region"]);
    expect(locationInGroup("kochi", "region", groups)).toBe(true);
    expect(locationInGroup("kochi", "other", groups)).toBe(false);
  });
});

describe("group assignment", () => {
  it("requires locations from the same organisation", () => {
    expect(groupAssignmentError({ clientId: "org", locationClientIds: [] })).toMatch(/at least one/);
    expect(groupAssignmentError({ clientId: "org", locationClientIds: ["org", "other"] })).toMatch(/organisation/);
    expect(groupAssignmentError({ clientId: "org", locationClientIds: ["org"] })).toBeNull();
  });
});

describe("location connection", () => {
  it("points an expired account at settings and flags a shared place", () => {
    expect(
      connectionView({
        connectionStatus: "expired",
        isActive: true,
        holdReason: null,
        voiceOfMerchant: true,
        googleDuplicateOf: null,
        sharedPlace: false,
      }).href
    ).toBe("/settings");
    expect(sharedPlaceIds([
      { id: "a", placeId: "same" },
      { id: "b", placeId: "same" },
      { id: "c", placeId: null },
    ]).has("same")).toBe(true);
  });
});
