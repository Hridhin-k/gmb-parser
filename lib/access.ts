/**
 * Tenant roles, in order: owner, admin, managers, members.
 * Owner is the person who created the organisation and cannot be assigned.
 * Admin is the whole organisation. Managers are scoped to a brand, a group, or a location.
 * Member is everyone else who works replies. Agent and auditor remain only for people who already have them.
 */

export const ASSIGNABLE_ROLES = [
  "org_admin",
  "brand_manager",
  "group_manager",
  "store_manager",
  "member",
] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * The role form used to send "admin" for an organization admin, and a closed
 * select can submit a blank value while its options are still registering.
 * Both become a real assignable role, or no role, before validation.
 */
export function coerceAssignableRole(value: unknown): unknown {
  const raw =
    value && typeof value === "object" && "value" in value
      ? (value as { value: unknown }).value
      : value;
  if (raw === "admin") return "org_admin";
  if (raw === "") return undefined;
  return raw;
}

export type Permission =
  | "view"
  | "draft"
  | "publish_positive"
  | "approve_negative"
  | "edit_rules"
  | "manage_locations"
  | "manage_people";

type Grant = boolean | "own_group";

const MATRIX: Record<string, Record<Permission, Grant>> = {
  owner: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: true,
    edit_rules: true,
    manage_locations: true,
    manage_people: true,
  },
  org_admin: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: true,
    edit_rules: true,
    manage_locations: true,
    manage_people: true,
  },
  brand_manager: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: true,
    edit_rules: true,
    manage_locations: true,
    manage_people: false,
  },
  group_manager: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: true,
    edit_rules: "own_group",
    manage_locations: false,
    manage_people: false,
  },
  store_manager: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: false,
    edit_rules: false,
    manage_locations: false,
    manage_people: false,
  },
  agent: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: false,
    edit_rules: false,
    manage_locations: false,
    manage_people: false,
  },
  auditor: {
    view: true,
    draft: false,
    publish_positive: false,
    approve_negative: false,
    edit_rules: false,
    manage_locations: false,
    manage_people: false,
  },
  admin: {
    view: true,
    draft: true,
    publish_positive: true,
    approve_negative: true,
    edit_rules: true,
    manage_locations: true,
    manage_people: true,
  },
  member: {
    view: true,
    draft: true,
    publish_positive: false,
    approve_negative: false,
    edit_rules: false,
    manage_locations: false,
    manage_people: false,
  },
};

export interface ScopeIds {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}

export interface ResourceRef {
  workspaceId: string;
  clientId?: string | null;
  groupId?: string | null;
  parentGroupId?: string | null;
  locationId?: string | null;
}

export function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "org_admin":
    case "admin":
      return "Admin";
    case "brand_manager":
      return "Brand manager";
    case "group_manager":
      return "Group manager";
    case "store_manager":
      return "Store manager";
    case "agent":
      return "Agent";
    case "auditor":
      return "Auditor";
    default:
      return "Member";
  }
}

export function grantFor(role: string | null | undefined, permission: Permission): Grant {
  return MATRIX[role ?? ""]?.[permission] ?? false;
}

/** True when the role has the permission somewhere. Group-only edit counts for navigation. */
export function allows(role: string | null | undefined, permission: Permission): boolean {
  return grantFor(role, permission) !== false;
}

/** Invited members write a public reply only by asking the model. */
export function draftsWithAiOnly(role: string | null | undefined): boolean {
  return role === "member";
}

/** Workspace-wide grant. A group manager's "own group" cell does not count. */
export function workspaceGrant(role: string | null | undefined, permission: Permission): boolean {
  return grantFor(role, permission) === true;
}

export function isOrgScope(scope: ScopeIds): boolean {
  return !scope.clientId && !scope.groupId && !scope.locationId;
}

export function inScope(scope: ScopeIds, resource: ResourceRef, actorWorkspaceId: string): boolean {
  if (resource.workspaceId !== actorWorkspaceId) return false;
  if (isOrgScope(scope)) return true;
  if (scope.locationId) return resource.locationId === scope.locationId;
  if (scope.groupId) {
    return resource.groupId === scope.groupId || resource.parentGroupId === scope.groupId;
  }
  if (scope.clientId) return resource.clientId === scope.clientId;
  return false;
}

export function canAct(input: {
  role: string | null | undefined;
  enabled: boolean;
  permission: Permission;
  scope: ScopeIds;
  actorWorkspaceId: string;
  resource?: ResourceRef;
}): boolean {
  if (!input.enabled) return false;
  const grant = grantFor(input.role, input.permission);
  if (grant === false) return false;
  if (!input.resource) return grant === true;
  if (!inScope(input.scope, input.resource, input.actorWorkspaceId)) return false;
  if (grant === "own_group") {
    return (
      Boolean(input.scope.groupId) &&
      (input.resource.groupId === input.scope.groupId ||
        input.resource.parentGroupId === input.scope.groupId)
    );
  }
  return true;
}

/** 4–5 stars use the publish column. 1–3 stars use the approve column. */
export function reviewPermission(stars: number, action: "draft" | "approve" | "publish"): Permission {
  if (action === "draft") return "draft";
  if (stars >= 4) return "publish_positive";
  return "approve_negative";
}

export function roleScopeError(role: string, scope: ScopeIds): string | null {
  const set = [scope.clientId, scope.groupId, scope.locationId].filter(Boolean).length;
  if (set > 1) return "Pick one place: a brand, a group, or a location.";
  if (role === "brand_manager" && !scope.clientId) return "A brand manager needs a brand.";
  if (role === "group_manager" && !scope.groupId) return "A group manager needs a group.";
  if (role === "store_manager" && !scope.locationId) return "A store manager needs a location.";
  if (role === "owner") return "The organization owner already sees the whole organization.";
  return null;
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

export function clampListScope<T extends { clientId: string; locationId: string; groupId?: string }>(
  requested: T,
  scope: ScopeIds
): T {
  if (isOrgScope(scope)) return requested;
  const next = { ...requested };
  if (scope.locationId) {
    if (requested.locationId && requested.locationId !== scope.locationId) {
      next.locationId = NIL_ID;
    } else {
      next.locationId = scope.locationId;
    }
    return next;
  }
  if (scope.groupId) {
    if (requested.groupId && requested.groupId !== scope.groupId) {
      next.groupId = NIL_ID;
      next.locationId = NIL_ID;
    } else {
      next.groupId = scope.groupId;
    }
    return next;
  }
  if (scope.clientId) {
    if (requested.clientId && requested.clientId !== scope.clientId) {
      next.clientId = NIL_ID;
      next.locationId = NIL_ID;
    } else {
      next.clientId = scope.clientId;
    }
  }
  return next;
}

export function canAssignRole(actorRole: string | null | undefined, nextRole: string): boolean {
  if (nextRole === "owner") return false;
  if (actorRole === "owner" || actorRole === "org_admin" || actorRole === "admin") {
    return (ASSIGNABLE_ROLES as readonly string[]).includes(nextRole);
  }
  return false;
}
