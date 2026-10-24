import { describe, expect, it } from "vitest";
import {
  canAct,
  clampListScope,
  coerceAssignableRole,
  inScope,
  reviewPermission,
  roleScopeError,
  workspaceGrant,
} from "@/lib/access";

const ORG = "org-1";
const OTHER = "org-2";
const BRAND = "brand-1";
const GROUP = "group-1";
const CITY = "city-1";
const LOCATION = "location-1";

const roles = ["owner", "org_admin", "brand_manager", "group_manager", "store_manager", "agent", "auditor"] as const;

function act(
  role: string,
  permission: Parameters<typeof canAct>[0]["permission"],
  scope: { clientId: string | null; groupId: string | null; locationId: string | null },
  resource?: Parameters<typeof canAct>[0]["resource"]
) {
  return canAct({
    role,
    enabled: true,
    permission,
    scope,
    actorWorkspaceId: ORG,
    resource,
  });
}

describe("permission matrix", () => {
  it("lets every role view and only the auditor is view-only", () => {
    for (const role of roles) {
      expect(act(role, "view", { clientId: null, groupId: null, locationId: null })).toBe(true);
    }
    expect(act("auditor", "draft", { clientId: null, groupId: null, locationId: null })).toBe(false);
    expect(act("auditor", "publish_positive", { clientId: null, groupId: null, locationId: null })).toBe(false);
  });

  it("publishes 4–5 star replies for every role except the auditor", () => {
    expect(reviewPermission(5, "publish")).toBe("publish_positive");
    expect(reviewPermission(3, "publish")).toBe("approve_negative");
    for (const role of ["owner", "org_admin", "brand_manager", "group_manager", "store_manager", "agent"]) {
      expect(act(role, "publish_positive", { clientId: null, groupId: null, locationId: null })).toBe(true);
    }
    for (const role of ["store_manager", "agent", "auditor", "member"]) {
      expect(act(role, "approve_negative", { clientId: null, groupId: null, locationId: null })).toBe(false);
    }
  });

  it("approves 1–3 star replies only for organization, brand, and group managers", () => {
    for (const role of ["owner", "org_admin", "brand_manager", "group_manager", "admin"]) {
      expect(act(role, "approve_negative", { clientId: null, groupId: null, locationId: null })).toBe(true);
    }
  });

  it("limits rule edits to the group a group manager can see", () => {
    const scope = { clientId: null, groupId: GROUP, locationId: null };
    const own = { workspaceId: ORG, groupId: CITY, parentGroupId: GROUP, locationId: LOCATION };
    const other = { workspaceId: ORG, groupId: "group-2", parentGroupId: null, locationId: "location-2" };
    expect(act("group_manager", "edit_rules", scope, own)).toBe(true);
    expect(act("group_manager", "edit_rules", scope, other)).toBe(false);
    expect(act("group_manager", "manage_locations", scope)).toBe(false);
    expect(workspaceGrant("group_manager", "edit_rules")).toBe(false);
  });

  it("lets only organization admins manage people", () => {
    expect(act("owner", "manage_people", { clientId: null, groupId: null, locationId: null })).toBe(true);
    expect(act("org_admin", "manage_people", { clientId: null, groupId: null, locationId: null })).toBe(true);
    expect(act("brand_manager", "manage_people", { clientId: BRAND, groupId: null, locationId: null })).toBe(false);
    expect(act("admin", "manage_people", { clientId: null, groupId: null, locationId: null })).toBe(true);
  });
});

describe("tenant and scope isolation", () => {
  const org = { clientId: null, groupId: null, locationId: null };

  it("denies a resource from another organization", () => {
    expect(inScope(org, { workspaceId: OTHER, locationId: LOCATION }, ORG)).toBe(false);
    expect(
      act("owner", "view", org, { workspaceId: OTHER, clientId: BRAND, locationId: LOCATION })
    ).toBe(false);
  });

  it("keeps a brand manager inside one brand", () => {
    const scope = { clientId: BRAND, groupId: null, locationId: null };
    expect(act("brand_manager", "draft", scope, { workspaceId: ORG, clientId: BRAND, locationId: LOCATION })).toBe(
      true
    );
    expect(
      act("brand_manager", "draft", scope, { workspaceId: ORG, clientId: "brand-2", locationId: "location-2" })
    ).toBe(false);
  });

  it("keeps a store manager on one location", () => {
    const scope = { clientId: null, groupId: null, locationId: LOCATION };
    expect(act("store_manager", "publish_positive", scope, { workspaceId: ORG, locationId: LOCATION })).toBe(true);
    expect(act("store_manager", "publish_positive", scope, { workspaceId: ORG, locationId: "other" })).toBe(false);
    expect(act("store_manager", "approve_negative", scope, { workspaceId: ORG, locationId: LOCATION })).toBe(false);
  });

  it("turns a changed location filter into an empty result", () => {
    const clamped = clampListScope(
      { clientId: "", locationId: "other-location", groupId: "" },
      { clientId: null, groupId: null, locationId: LOCATION }
    );
    expect(clamped.locationId).not.toBe("other-location");
    expect(clamped.locationId).not.toBe(LOCATION);
  });

  it("requires the scope that matches the role", () => {
    expect(roleScopeError("brand_manager", { clientId: null, groupId: null, locationId: null })).toMatch(/brand/);
    expect(roleScopeError("store_manager", { clientId: null, groupId: null, locationId: LOCATION })).toBeNull();
    expect(roleScopeError("agent", { clientId: BRAND, groupId: GROUP, locationId: null })).toMatch(/one place/);
  });

  it("treats the older admin value as an organization admin", () => {
    expect(coerceAssignableRole("admin")).toBe("org_admin");
    expect(coerceAssignableRole({ value: "admin" })).toBe("org_admin");
    expect(coerceAssignableRole("")).toBeUndefined();
    expect(coerceAssignableRole("member")).toBe("member");
    expect(coerceAssignableRole("auditor")).toBe("auditor");
  });

  it("denies a person whose access is turned off", () => {
    expect(
      canAct({
        role: "org_admin",
        enabled: false,
        permission: "view",
        scope: org,
        actorWorkspaceId: ORG,
      })
    ).toBe(false);
  });
});
