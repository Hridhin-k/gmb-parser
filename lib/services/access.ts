import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import {
  canAct,
  isOrgScope,
  reviewPermission,
  type Permission,
  type ResourceRef,
  type ScopeIds,
} from "@/lib/access";

export interface MemberAccess {
  userId: string;
  workspaceId: string;
  role: string;
  enabled: boolean;
  scope: ScopeIds;
}

interface LocationRow {
  id: string;
  workspace_id: string;
  client_id: string | null;
  group_id: string | null;
}

/** One membership lookup per request — layout, catalog, and pages share it. */
export const getMemberAccess = cache(async (userId: string, workspaceId: string): Promise<MemberAccess | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_members")
    .select("user_id, role, access_enabled, scope_client_id, scope_group_id, scope_location_id")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    user_id: string;
    role: string;
    access_enabled?: boolean | null;
    scope_client_id?: string | null;
    scope_group_id?: string | null;
    scope_location_id?: string | null;
  };
  return {
    userId: row.user_id,
    workspaceId,
    role: row.role,
    enabled: row.access_enabled !== false,
    scope: {
      clientId: row.scope_client_id ?? null,
      groupId: row.scope_group_id ?? null,
      locationId: row.scope_location_id ?? null,
    },
  };
});

async function parentGroupId(groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("grm_groups").select("parent_id").eq("id", groupId).maybeSingle();
  return (data?.parent_id as string | null | undefined) ?? null;
}

export async function locationResource(locationId: string): Promise<(ResourceRef & { stars?: number }) | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_google_locations")
    .select("id, workspace_id, client_id, group_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!data) return null;
  const row = data as LocationRow;
  return {
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    groupId: row.group_id,
    parentGroupId: await parentGroupId(row.group_id),
    locationId: row.id,
  };
}

export async function assertPermission(input: {
  userId: string;
  workspaceId: string;
  permission: Permission;
  resource?: ResourceRef;
}): Promise<MemberAccess> {
  const access = await getMemberAccess(input.userId, input.workspaceId);
  if (!access) throw new AuthorizationError("You do not have access to this organization.");
  const allowed = canAct({
    role: access.role,
    enabled: access.enabled,
    permission: input.permission,
    scope: access.scope,
    actorWorkspaceId: input.workspaceId,
    resource: input.resource,
  });
  if (!allowed) {
    throw new AuthorizationError(
      access.enabled
        ? "You do not have permission for that."
        : "Your access to this organization is turned off."
    );
  }
  return access;
}

export async function assertScoped(input: {
  userId: string;
  workspaceId: string;
  permission: Permission;
  target:
    | { kind: "workspace" }
    | { kind: "client"; id: string }
    | { kind: "group"; id: string }
    | { kind: "location"; id: string };
}): Promise<void> {
  const admin = createAdminClient();
  let resource: ResourceRef = { workspaceId: input.workspaceId };
  if (input.target.kind === "client") {
    const { data } = await admin
      .from("grm_clients")
      .select("id, workspace_id")
      .eq("id", input.target.id)
      .maybeSingle();
    if (!data) throw new AuthorizationError("That brand is not in this organization.");
    resource = { workspaceId: data.workspace_id, clientId: data.id };
  } else if (input.target.kind === "group") {
    const { data } = await admin
      .from("grm_groups")
      .select("id, workspace_id, client_id, parent_id")
      .eq("id", input.target.id)
      .maybeSingle();
    if (!data) throw new AuthorizationError("That group is not in this organization.");
    resource = {
      workspaceId: data.workspace_id,
      clientId: data.client_id,
      groupId: data.id,
      parentGroupId: data.parent_id,
    };
  } else if (input.target.kind === "location") {
    const loaded = await locationResource(input.target.id);
    if (!loaded) throw new AuthorizationError("That location is not in this organization.");
    resource = loaded;
  }
  await assertPermission({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: input.permission,
    resource,
  });
}

export async function assertReviewAction(input: {
  userId: string;
  workspaceId: string;
  reviewId: string;
  action: "draft" | "approve" | "publish";
}): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_reviews")
    .select("id, workspace_id, location_id, star_rating")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (!data || data.workspace_id !== input.workspaceId) {
    throw new AuthorizationError("That review is not in this organization.");
  }
  const location = await locationResource(data.location_id);
  if (!location || location.workspaceId !== input.workspaceId) {
    throw new AuthorizationError("That review is not in this organization.");
  }
  await assertPermission({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: reviewPermission(data.star_rating, input.action),
    resource: location,
  });
}

export async function assertEscalationAction(input: {
  userId: string;
  workspaceId: string;
  escalationId: string;
  permission: Permission;
}): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_escalations")
    .select("id, workspace_id, location_id")
    .eq("id", input.escalationId)
    .maybeSingle();
  if (!data || data.workspace_id !== input.workspaceId) {
    throw new AuthorizationError("That escalation is not in this organization.");
  }
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: input.permission,
    target: { kind: "location", id: data.location_id },
  });
}

export function scopeBelongsToActor(actor: ScopeIds, resource: ResourceRef, workspaceId: string): boolean {
  return canAct({
    role: "owner",
    enabled: true,
    permission: "view",
    scope: actor,
    actorWorkspaceId: workspaceId,
    resource,
  });
}

export async function assertScopeAssignment(input: {
  actor: MemberAccess;
  scope: ScopeIds;
}): Promise<void> {
  if (!input.actor.enabled) {
    throw new AuthorizationError("Your access to this organization is turned off.");
  }
  const admin = createAdminClient();
  let resource: ResourceRef = { workspaceId: input.actor.workspaceId };
  if (input.scope.locationId) {
    const loaded = await locationResource(input.scope.locationId);
    if (!loaded || loaded.workspaceId !== input.actor.workspaceId) {
      throw new ValidationError("That location is not in this organization.");
    }
    resource = loaded;
  } else if (input.scope.groupId) {
    const { data } = await admin
      .from("grm_groups")
      .select("id, workspace_id, client_id, parent_id")
      .eq("id", input.scope.groupId)
      .maybeSingle();
    if (!data || data.workspace_id !== input.actor.workspaceId) {
      throw new ValidationError("That group is not in this organization.");
    }
    resource = {
      workspaceId: data.workspace_id,
      clientId: data.client_id,
      groupId: data.id,
      parentGroupId: data.parent_id,
    };
  } else if (input.scope.clientId) {
    const { data } = await admin
      .from("grm_clients")
      .select("id, workspace_id")
      .eq("id", input.scope.clientId)
      .maybeSingle();
    if (!data || data.workspace_id !== input.actor.workspaceId) {
      throw new ValidationError("That brand is not in this organization.");
    }
    resource = { workspaceId: data.workspace_id, clientId: data.id };
  }
  if (
    !scopeBelongsToActor(input.actor.scope, resource, input.actor.workspaceId) &&
    (input.scope.clientId || input.scope.groupId || input.scope.locationId || !isOrg(input.actor.scope))
  ) {
    if (!isOrg(input.actor.scope)) {
      throw new AuthorizationError("That place is outside the scope you can assign.");
    }
  }
}

function isOrg(scope: ScopeIds): boolean {
  return !scope.clientId && !scope.groupId && !scope.locationId;
}

export async function listScopeChoices(workspaceId: string): Promise<
  Array<{ id: string; label: string; kind: "client" | "group" | "location" }>
> {
  const admin = createAdminClient();
  const [clients, groups, locations] = await Promise.all([
    admin.from("grm_clients").select("id, name, notes").eq("workspace_id", workspaceId).eq("is_active", true).order("name"),
    admin.from("grm_groups").select("id, name").eq("workspace_id", workspaceId).order("name"),
    admin.from("grm_google_locations").select("id, location_title").eq("workspace_id", workspaceId).order("location_title"),
  ]);
  const choices: Array<{ id: string; label: string; kind: "client" | "group" | "location" }> = [];
  for (const client of clients.data ?? []) {
    if (client.notes === UNASSIGNED_CLIENT_MARKER) continue;
    choices.push({ id: client.id, label: client.name, kind: "client" });
  }
  for (const group of groups.data ?? []) choices.push({ id: group.id, label: group.name, kind: "group" });
  for (const location of locations.data ?? []) {
    choices.push({ id: location.id, label: location.location_title ?? "Location", kind: "location" });
  }
  return choices;
}

/** A scoped person can open a record only when it sits inside their brand, group, or location. */
export async function assertScopeTarget(input: {
  userId: string;
  workspaceId: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}): Promise<void> {
  const access = await getMemberAccess(input.userId, input.workspaceId);
  if (!access?.enabled) throw new AuthorizationError("Access is turned off.");
  if (isOrgScope(access.scope)) return;
  if (input.locationId) {
    await assertScoped({
      userId: input.userId,
      workspaceId: input.workspaceId,
      permission: "view",
      target: { kind: "location", id: input.locationId },
    });
    return;
  }
  if (input.groupId) {
    await assertScoped({
      userId: input.userId,
      workspaceId: input.workspaceId,
      permission: "view",
      target: { kind: "group", id: input.groupId },
    });
    return;
  }
  if (input.clientId) {
    await assertScoped({
      userId: input.userId,
      workspaceId: input.workspaceId,
      permission: "view",
      target: { kind: "client", id: input.clientId },
    });
    return;
  }
  throw new AuthorizationError("That record covers the whole organization.");
}

/**
 * Null means every location. An array is the only Google profiles this person covers:
 * one outlet, a group's outlets, or every outlet of their brand.
 */
export const visibleLocationIds = cache(async function visibleLocationIds(
  workspaceId: string,
  scope: ScopeIds | null | undefined
): Promise<string[] | null> {
  const current = scope ?? { clientId: null, groupId: null, locationId: null };
  if (isOrgScope(current)) return null;
  const admin = createAdminClient();
  if (current.locationId) return [current.locationId];
  if (current.clientId) {
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("client_id", current.clientId);
    if (error) throw new Error("Failed to load profile scope.");
    return (data ?? []).map((location) => location.id);
  }
  const { data: groups, error: groupError } = await admin
    .from("grm_groups")
    .select("id, parent_id")
    .eq("workspace_id", workspaceId);
  if (groupError) throw new Error("Failed to load profile scope.");
  const groupIds = (groups ?? [])
    .filter((group) => group.id === current.groupId || group.parent_id === current.groupId)
    .map((group) => group.id);
  if (groupIds.length === 0) return [];
  const { data, error } = await admin
    .from("grm_google_locations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("group_id", groupIds);
  if (error) throw new Error("Failed to load profile scope.");
  return (data ?? []).map((location) => location.id);
});

/** Null means the whole organization. An array is the only client ids this person may see. */
export async function visibleClientIds(workspaceId: string, scope: ScopeIds | null | undefined): Promise<string[] | null> {
  const current = scope ?? { clientId: null, groupId: null, locationId: null };
  if (isOrgScope(current)) return null;
  const admin = createAdminClient();
  if (current.clientId) return [current.clientId];
  if (current.locationId) {
    const { data } = await admin
      .from("grm_google_locations")
      .select("client_id")
      .eq("workspace_id", workspaceId)
      .eq("id", current.locationId)
      .maybeSingle();
    return data?.client_id ? [data.client_id] : [];
  }
  const { data: groups } = await admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId);
  const groupIds = (groups ?? [])
    .filter((group) => group.id === current.groupId || group.parent_id === current.groupId)
    .map((group) => group.id);
  if (groupIds.length === 0) return [];
  const { data: locations } = await admin
    .from("grm_google_locations")
    .select("client_id")
    .eq("workspace_id", workspaceId)
    .in("group_id", groupIds);
  return [...new Set((locations ?? []).flatMap((location) => (location.client_id ? [location.client_id] : [])))];
}
