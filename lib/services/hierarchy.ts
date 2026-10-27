import { createAdminClient } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit";
import { loadAuthProfiles } from "@/lib/services/auth-profiles";
import { getWorkspaceTone } from "@/lib/services/onboarding";
import { assertScoped } from "@/lib/services/access";
import { AppError, ValidationError } from "@/lib/errors";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { locationDisplayName } from "@/lib/ui/location-place";
import { DEFAULT_ESCALATION_POLICY } from "@/lib/escalations";
import type { ToneVoice } from "@/lib/onboarding";
import {
  connectionView,
  describeSetting,
  emptyFields,
  groupIdsInScope,
  groupAssignmentError,
  groupShapeError,
  locationMoveError,
  mergeGroupsError,
  sharedPlaceIds,
  type ConnectionView,
  type GroupKind,
  type ResolvedField,
  type RoutingLevel,
  type SettingFields,
  type SettingNode,
} from "@/lib/hierarchy";

async function assertManager(
  userId: string,
  workspaceId: string,
  target: { kind: "client" | "group" | "location"; id: string }
): Promise<void> {
  await assertScoped({ userId, workspaceId, permission: "manage_locations", target });
}

function dbMessage(error: { code?: string; message?: string }, fallback: string): never {
  if (error.code === "23505") throw new ValidationError("A group with that name already exists in this place.");
  const message = error.message ?? "";
  if (
    message.includes("another organization") ||
    message.includes("another brand") ||
    message.includes("own parent") ||
    message.includes("cannot contain") ||
    message.includes("needs a region") ||
    message.includes("under a region")
  ) {
    throw new ValidationError(message.replace(/^.*exception /, "").replace(/"/g, ""));
  }
  throw new AppError(fallback, "DB_ERROR", 500);
}

export interface HierarchyLocation {
  id: string;
  name: string;
  storeCode: string | null;
  subgroup: string | null;
  tags: string[];
  rating: number | null;
  connection: ConnectionView;
  managerUserId: string | null;
  managerLabel: string | null;
  clientId: string | null;
  groupId: string | null;
}

export interface HierarchySettingsView {
  tone: ResolvedField<string>;
  sla: ResolvedField<string>;
  routing: ResolvedField<string>;
  automation: ResolvedField<string>;
  own: SettingFields;
}

export interface HierarchyView {
  brands: Array<{
    id: string;
    name: string;
    regions: Array<{ id: string; name: string; count: number; cities: Array<{ id: string; name: string; count: number }> }>;
  }>;
  loose: Array<{ id: string; name: string; count: number }>;
  ungrouped: Array<{ clientId: string; count: number }>;
  places: Array<{ id: string; name: string; clientId: string | null; groupId: string | null; groupName: string | null }>;
  attention: { expired: number; duplicates: number; unverified: number };
  selected: {
    kind: "brand" | "group" | "location" | "attention" | "ungrouped";
    id: string;
    /** Client (brand) this selection belongs to, when known. */
    clientId: string | null;
    title: string;
    path: string;
    settings: HierarchySettingsView | null;
    locations: HierarchyLocation[];
  } | null;
  moveTargets: Array<{ id: string; label: string }>;
  tags: string[];
  members: Array<{ id: string; label: string }>;
}

interface GroupRow {
  id: string;
  name: string;
  client_id: string;
  brand_id: string;
  parent_id: string | null;
  kind: string;
}

interface LocationRow {
  id: string;
  client_id: string | null;
  group_id: string | null;
  location_title: string | null;
  store_code: string | null;
  address_formatted: string | null;
  is_active: boolean;
  hold_reason: "duplicate" | "unverified" | null;
  voice_of_merchant: boolean | null;
  google_duplicate_of: string | null;
  place_id: string | null;
  average_rating: number | null;
  google_account_id: string | null;
  manager_user_id: string | null;
}

const TONE_LABEL: Record<ToneVoice, string> = {
  warm: "Warm",
  professional: "Professional",
  brief: "Brief",
};

const ROUTING_LABEL: Record<RoutingLevel, string> = {
  store: "Store",
  regional: "Regional",
  leadership: "Leadership",
};

function asVoice(value: string | null | undefined): ToneVoice | null {
  return value === "warm" || value === "professional" || value === "brief" ? value : null;
}

function asRouting(value: string | null | undefined): RoutingLevel | null {
  return value === "store" || value === "regional" || value === "leadership" ? value : null;
}

function asKind(value: string): GroupKind {
  return value === "city" ? "city" : "region";
}

function fieldsFrom(row: {
  tone_voice: string | null;
  tone_note: string | null;
  sla_hours: number | null;
  routing_level: string | null;
  drafts_paused: boolean | null;
} | undefined): SettingFields {
  if (!row) return emptyFields();
  return {
    toneVoice: asVoice(row.tone_voice),
    toneNote: row.tone_note,
    slaHours: row.sla_hours,
    routingLevel: asRouting(row.routing_level),
    draftsPaused: row.drafts_paused,
  };
}

function presentSettings(
  chain: SettingNode[],
  fallback: { voice: ToneVoice | null; note: string | null; hours: number }
): HierarchySettingsView {
  const tone = describeSetting(chain, (fields) => fields.toneVoice, {
    value: fallback.voice,
    source: "the workspace",
  });
  const sla = describeSetting(chain, (fields) => fields.slaHours, {
    value: fallback.hours,
    source: "the workspace",
  });
  const routing = describeSetting(chain, (fields) => fields.routingLevel, {
    value: "store" as RoutingLevel,
    source: "the workspace",
  });
  const automation = describeSetting(chain, (fields) => fields.draftsPaused, {
    value: false,
    source: "the workspace",
  });
  return {
    tone: {
      value: tone.value ? TONE_LABEL[tone.value] : "Not set",
      source: tone.source,
      overridden: tone.overridden,
    },
    sla: { value: `${sla.value} hours`, source: sla.source, overridden: sla.overridden },
    routing: { value: ROUTING_LABEL[routing.value], source: routing.source, overridden: routing.overridden },
    automation: {
      value: automation.value
        ? "Drafts are paused here"
        : "Drafts are created when someone asks. Nothing is published without a person.",
      source: automation.source,
      overridden: automation.overridden,
    },
    own: chain[0]?.fields ?? emptyFields(),
  };
}

export async function scopedGroupIds(workspaceId: string, groupId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId);
  const groups = (data ?? []).map((group) => ({ id: group.id, parentId: group.parent_id }));
  const scope = groupIdsInScope(groupId, groups);
  return scope.length > 0 ? scope : [groupId];
}

export async function loadHierarchy(
  workspaceId: string,
  selection: {
    brandId?: string | null;
    groupId?: string | null;
    locationId?: string | null;
    ungroupedClientId?: string | null;
    attention?: string | null;
  },
  allowedClientIds: string[] | null = null
): Promise<HierarchyView> {
  const admin = createAdminClient();
  const [clients, groups, locations, accounts, connections, tags, links, managers, members, settings, tone, policy] =
    await Promise.all([
      admin
        .from("grm_clients")
        .select("id, name, notes")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name"),
      admin.from("grm_groups").select("id, name, client_id, brand_id, parent_id, kind").eq("workspace_id", workspaceId).order("name"),
      admin
        .from("grm_google_locations")
        .select(
          "id, client_id, group_id, location_title, store_code, address_formatted, is_active, hold_reason, voice_of_merchant, google_duplicate_of, place_id, average_rating, google_account_id, manager_user_id"
        )
        .eq("workspace_id", workspaceId)
        .order("location_title"),
      admin.from("grm_google_accounts").select("id, connection_id").eq("workspace_id", workspaceId),
      admin.from("grm_google_connections").select("id, status").eq("workspace_id", workspaceId),
      admin.from("grm_location_tags").select("id, name").eq("workspace_id", workspaceId).order("name"),
      admin.from("grm_location_tag_links").select("location_id, tag_id"),
      Promise.resolve({ data: [] as Array<{ location_id: string; user_id: string }>, error: null }),
      admin.from("grm_workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
      admin
        .from("grm_scope_settings")
        .select("scope, client_id, group_id, location_id, tone_voice, tone_note, sla_hours, routing_level, drafts_paused")
        .eq("workspace_id", workspaceId),
      getWorkspaceTone(workspaceId),
      admin.from("grm_escalation_policies").select("due_hours").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

  for (const result of [clients, groups, locations, accounts, connections, tags, links, managers, members, settings]) {
    if (result.error) throw new AppError("Could not load locations and groups.", "DB_ERROR", 500);
  }

  const allow = allowedClientIds ? new Set(allowedClientIds) : null;
  const brandRows = (clients.data ?? []).filter(
    (client) => client.notes !== UNASSIGNED_CLIENT_MARKER && (!allow || allow.has(client.id))
  );
  const brandNames = new Map(brandRows.map((brand) => [brand.id, brand.name]));
  const groupRows = ((groups.data ?? []) as GroupRow[]).filter(
    (group) => !allow || allow.has(group.client_id) || allow.has(group.brand_id)
  );
  const groupById = new Map(groupRows.map((group) => [group.id, group]));
  const locationRows = ((locations.data ?? []) as LocationRow[]).filter(
    (location) => !allow || (location.client_id ? allow.has(location.client_id) : false)
  );
  const statusByConnection = new Map((connections.data ?? []).map((row) => [row.id, row.status]));
  const statusByAccount = new Map(
    (accounts.data ?? []).map((account) => [account.id, statusByConnection.get(account.connection_id) ?? null])
  );
  const shared = sharedPlaceIds(locationRows.map((location) => ({ id: location.id, placeId: location.place_id })));
  const tagName = new Map((tags.data ?? []).map((tag) => [tag.id, tag.name]));
  const tagsByLocation = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const name = tagName.get(link.tag_id);
    if (!name) continue;
    const list = tagsByLocation.get(link.location_id) ?? [];
    list.push(name);
    tagsByLocation.set(link.location_id, list);
  }
  const managerByLocation = new Map(
    locationRows.flatMap((location) => (location.manager_user_id ? [[location.id, location.manager_user_id] as const] : []))
  );
  const memberIds = (members.data ?? []).map((member) => member.user_id);
  const profiles = await loadAuthProfiles(memberIds);
  const emailById = new Map(
    memberIds.map((userId) => [userId, profiles.get(userId)?.email ?? "Member"] as const)
  );

  const directCount = new Map<string, number>();
  for (const location of locationRows) {
    if (!location.group_id) continue;
    directCount.set(location.group_id, (directCount.get(location.group_id) ?? 0) + 1);
  }

  function countFor(groupId: string): number {
    const children = groupRows.filter((group) => group.parent_id === groupId);
    return (directCount.get(groupId) ?? 0) + children.reduce((sum, child) => sum + (directCount.get(child.id) ?? 0), 0);
  }

  const brands = brandRows.map((brand) => ({
    id: brand.id,
    name: brand.name,
    regions: groupRows
      .filter((group) => group.client_id === brand.id && !group.parent_id)
      .map((region) => ({
        id: region.id,
        name: region.name,
        count: countFor(region.id),
        cities: groupRows
          .filter((group) => group.parent_id === region.id)
          .map((city) => ({ id: city.id, name: city.name, count: directCount.get(city.id) ?? 0 })),
      })),
  }));
  const loose = groupRows
    .filter((group) => !group.client_id)
    .map((group) => ({ id: group.id, name: group.name, count: countFor(group.id) }));
  const ungrouped = brandRows.map((brand) => ({
    clientId: brand.id,
    count: locationRows.filter((location) => location.client_id === brand.id && !location.group_id).length,
  }));
  const places = locationRows.map((location) => ({
    id: location.id,
    name: locationDisplayName({
      title: location.location_title ?? "",
      brand: location.client_id ? brandNames.get(location.client_id) : null,
      storeCode: location.store_code,
      address: location.address_formatted,
    }),
    clientId: location.client_id,
    groupId: location.group_id,
    groupName: location.group_id ? groupById.get(location.group_id)?.name ?? null : null,
  }));

  function viewLocation(location: LocationRow, subgroup: string | null): HierarchyLocation {
    const place = location.place_id?.trim() ?? "";
    const status = location.google_account_id ? statusByAccount.get(location.google_account_id) : null;
    const managerUserId = managerByLocation.get(location.id) ?? null;
    return {
      id: location.id,
      name: locationDisplayName({
        title: location.location_title ?? "",
        brand: location.client_id ? brandNames.get(location.client_id) : null,
        storeCode: location.store_code,
        address: location.address_formatted,
      }),
      storeCode: location.store_code,
      subgroup,
      tags: tagsByLocation.get(location.id) ?? [],
      rating: location.average_rating,
      connection: connectionView({
        connectionStatus: status === "active" || status === "expired" || status === "revoked" ? status : null,
        isActive: location.is_active,
        holdReason: location.hold_reason,
        voiceOfMerchant: location.voice_of_merchant,
        googleDuplicateOf: location.google_duplicate_of,
        sharedPlace: Boolean(place && shared.has(place)),
      }),
      managerUserId,
      managerLabel: managerUserId ? emailById.get(managerUserId) ?? "Member" : null,
      clientId: location.client_id,
      groupId: location.group_id,
    };
  }

  const attentionRows = locationRows.filter((location) => {
    const viewed = viewLocation(location, null);
    return viewed.connection.kind === "expired" || viewed.connection.kind === "duplicate" || viewed.connection.kind === "unverified";
  });
  const attention = {
    expired: attentionRows.filter((location) => viewLocation(location, null).connection.kind === "expired").length,
    duplicates: attentionRows.filter((location) => viewLocation(location, null).connection.kind === "duplicate").length,
    unverified: attentionRows.filter((location) => viewLocation(location, null).connection.kind === "unverified").length,
  };

  const settingRows = settings.data ?? [];
  const fallback = {
    voice: tone?.voice ?? null,
    note: tone?.note ?? null,
    hours: policy.data?.due_hours ?? DEFAULT_ESCALATION_POLICY.dueHours,
  };

  function chainFor(target: { clientId?: string | null; groupId?: string | null; locationId?: string | null }): SettingNode[] {
    const nodes: SettingNode[] = [];
    const push = (id: string, label: string, row: (typeof settingRows)[number] | undefined) => {
      nodes.push({ id, label, fields: fieldsFrom(row) });
    };
    if (target.locationId) {
      const location = locationRows.find((row) => row.id === target.locationId);
      push(
        target.locationId,
        location?.location_title || "This location",
        settingRows.find((row) => row.location_id === target.locationId)
      );
      target = { groupId: location?.group_id, clientId: location?.client_id };
    }
    if (target.groupId) {
      const group = groupById.get(target.groupId);
      if (group) {
        push(group.id, group.name, settingRows.find((row) => row.group_id === group.id));
        if (group.parent_id) {
          const parent = groupById.get(group.parent_id);
          if (parent) push(parent.id, parent.name, settingRows.find((row) => row.group_id === parent.id));
        }
        target = { clientId: group.client_id ?? target.clientId };
      }
    }
    if (target.clientId && brandNames.has(target.clientId)) {
      push(target.clientId, brandNames.get(target.clientId)!, settingRows.find((row) => row.client_id === target.clientId));
    }
    return nodes;
  }

  let selected: HierarchyView["selected"] = null;
  const attentionKind = selection.attention === "expired" || selection.attention === "duplicate" || selection.attention === "unverified"
    ? selection.attention
    : null;

  if (selection.locationId) {
    const location = locationRows.find((row) => row.id === selection.locationId);
    if (location) {
      const group = location.group_id ? groupById.get(location.group_id) : null;
      selected = {
        kind: "location",
        id: location.id,
        clientId: location.client_id,
        title: viewLocation(location, null).name,
        path: [location.client_id ? brandNames.get(location.client_id) : null, group?.parent_id ? groupById.get(group.parent_id)?.name : null, group?.name]
          .filter(Boolean)
          .join(" › "),
        settings: presentSettings(chainFor({ locationId: location.id }), fallback),
        locations: [viewLocation(location, group?.parent_id ? group.name : null)],
      };
    }
  } else if (selection.groupId && groupById.has(selection.groupId)) {
    const group = groupById.get(selection.groupId)!;
    const scope = new Set(groupIdsInScope(group.id, groupRows.map((row) => ({ id: row.id, parentId: row.parent_id }))));
    const parent = group.parent_id ? groupById.get(group.parent_id) : null;
    selected = {
      kind: "group",
      id: group.id,
      clientId: group.client_id,
      title: `${group.name} · ${countFor(group.id)} location${countFor(group.id) === 1 ? "" : "s"}`,
      path: [group.client_id ? brandNames.get(group.client_id) : "Groups without a brand", parent?.name].filter(Boolean).join(" › "),
      settings: presentSettings(chainFor({ groupId: group.id, clientId: group.client_id }), fallback),
      locations: locationRows
        .filter((location) => location.group_id && scope.has(location.group_id))
        .map((location) => {
          const home = location.group_id ? groupById.get(location.group_id) : null;
          return viewLocation(location, home && home.id !== group.id ? home.name : home?.parent_id ? home.name : null);
        }),
    };
  } else if (selection.ungroupedClientId && brandNames.has(selection.ungroupedClientId)) {
    const clientId = selection.ungroupedClientId;
    selected = {
      kind: "ungrouped",
      id: clientId,
      clientId,
      title: `Ungrouped · ${brandNames.get(clientId)}`,
      path: brandNames.get(clientId) ?? "Organisation",
      settings: null,
      locations: locationRows
        .filter((location) => location.client_id === clientId && !location.group_id)
        .map((location) => viewLocation(location, null)),
    };
  } else if (selection.brandId && brandNames.has(selection.brandId)) {
    selected = {
      kind: "brand",
      id: selection.brandId,
      clientId: selection.brandId,
      title: brandNames.get(selection.brandId)!,
      path: brandNames.get(selection.brandId)!,
      settings: presentSettings(chainFor({ clientId: selection.brandId }), fallback),
      locations: locationRows
        .filter((location) => location.client_id === selection.brandId)
        .map((location) => viewLocation(location, location.group_id ? groupById.get(location.group_id)?.name ?? "Removed group" : null)),
    };
  } else if (attentionKind) {
    selected = {
      kind: "attention",
      id: attentionKind,
      clientId: null,
      title: attentionKind === "expired" ? "Access expired" : attentionKind === "duplicate" ? "Possible duplicates" : "Unverified locations",
      path: "Needs attention",
      settings: null,
      locations: locationRows
        .filter((location) => viewLocation(location, null).connection.kind === (attentionKind === "duplicate" ? "duplicate" : attentionKind))
        .map((location) => viewLocation(location, location.group_id ? groupById.get(location.group_id)?.name ?? "Removed group" : null)),
    };
  }

  const moveBrand = selected?.clientId ?? selected?.locations[0]?.clientId ?? selection.brandId ?? null;
  const moveTargets = groupRows
    .filter((group) => !moveBrand || !group.client_id || group.client_id === moveBrand)
    .map((group) => {
      const parent = group.parent_id ? groupById.get(group.parent_id)?.name : null;
      // When scoped to one brand, drop the brand prefix so the list stays short.
      const brand = moveBrand ? null : group.client_id ? brandNames.get(group.client_id) : "No brand";
      return { id: group.id, label: [brand, parent, group.name].filter(Boolean).join(" › ") };
    });

  return {
    brands,
    loose,
    attention,
    selected,
    moveTargets,
    tags: [...tagName.values()],
    members: memberIds.map((id) => ({ id, label: emailById.get(id) ?? "Member" })),
    ungrouped,
    places,
  };
}

async function ensureBrandId(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  clientId: string
): Promise<string> {
  const existing = await admin.from("grm_brands").select("id").eq("workspace_id", workspaceId).eq("client_id", clientId).limit(1);
  if (existing.error) throw new AppError("Could not load the organisation.", "DB_ERROR", 500);
  if (existing.data?.[0]?.id) return existing.data[0].id;
  const client = await admin.from("grm_clients").select("id, name").eq("id", clientId).eq("workspace_id", workspaceId).maybeSingle();
  if (client.error || !client.data) throw new ValidationError("That organisation is not in this workspace.");
  const inserted = await admin
    .from("grm_brands")
    .insert({ workspace_id: workspaceId, client_id: clientId, name: client.data.name })
    .select("id")
    .maybeSingle();
  if (inserted.data?.id) return inserted.data.id;
  if (inserted.error?.code === "23505") {
    const again = await admin.from("grm_brands").select("id").eq("workspace_id", workspaceId).eq("client_id", clientId).limit(1);
    if (again.data?.[0]?.id) return again.data[0].id;
  }
  throw new AppError("Could not prepare this organisation for groups.", "DB_ERROR", 500);
}

export async function createHierarchyGroup(input: {
  workspaceId: string;
  userId: string;
  name: string;
  kind: GroupKind;
  clientId: string | null;
  parentId: string | null;
  locationIds?: string[];
  managerUserId?: string | null;
}): Promise<string> {
  if (!input.clientId) throw new ValidationError("A group needs an organisation.");
  const locationIds = input.locationIds ?? [];
  if (input.kind === "region" && !input.parentId && locationIds.length === 0) {
    throw new ValidationError("Select at least one location.");
  }
  await assertManager(input.userId, input.workspaceId, { kind: "client", id: input.clientId });
  const admin = createAdminClient();
  const brandId = await ensureBrandId(admin, input.workspaceId, input.clientId);
  const parent = input.parentId
    ? await admin
        .from("grm_groups")
        .select("id, workspace_id, client_id, kind, parent_id")
        .eq("id", input.parentId)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle()
    : { data: null, error: null };
  if (parent.error) throw new AppError("Could not load the parent group.", "DB_ERROR", 500);
  if (input.parentId && !parent.data) throw new ValidationError("That region is not in this organization.");
  const shapeError = groupShapeError({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    kind: input.kind,
    parent: parent.data
      ? {
          id: parent.data.id,
          workspaceId: parent.data.workspace_id,
          clientId: parent.data.client_id,
          kind: asKind(parent.data.kind),
          parentId: parent.data.parent_id,
        }
      : null,
  });
  if (shapeError) throw new ValidationError(shapeError);
  if (locationIds.length > 0) {
    const chosen = await admin
      .from("grm_google_locations")
      .select("id, client_id")
      .eq("workspace_id", input.workspaceId)
      .in("id", locationIds);
    if (chosen.error) throw new AppError("Could not load the locations.", "DB_ERROR", 500);
    if ((chosen.data ?? []).length !== locationIds.length) {
      throw new ValidationError("One of those locations is not in this organisation.");
    }
    const assignment = groupAssignmentError({
      clientId: input.clientId,
      locationClientIds: (chosen.data ?? []).map((location) => location.client_id),
    });
    if (assignment) throw new ValidationError(assignment);
  }
  const { data, error } = await admin
    .from("grm_groups")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      kind: input.kind,
      client_id: input.clientId,
      brand_id: brandId,
      parent_id: input.parentId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) dbMessage(error ?? { message: "" }, "Could not create the group.");
  try {
    if (locationIds.length > 0) {
      await moveHierarchyLocations({
        workspaceId: input.workspaceId,
        userId: input.userId,
        locationIds,
        groupId: data.id,
        confirmHold: true,
      });
    }
    if (input.managerUserId) {
      await Promise.all(
        locationIds.map((locationId) =>
          setLocationManager({
            workspaceId: input.workspaceId,
            userId: input.userId,
            locationId,
            managerUserId: input.managerUserId ?? null,
          })
        )
      );
    }
  } catch (cause) {
    const held = await admin.from("grm_google_locations").select("id").eq("workspace_id", input.workspaceId).eq("group_id", data.id).limit(1);
    if (!held.data?.length) {
      await admin.from("grm_groups").delete().eq("id", data.id).eq("workspace_id", input.workspaceId);
    }
    throw cause;
  }
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.created",
    entityType: "grm_groups",
    entityId: data.id,
    metadata: { name: input.name.trim(), kind: input.kind, locations: locationIds.length },
  });
  return data.id;
}

export async function renameHierarchyGroup(input: {
  workspaceId: string;
  userId: string;
  groupId: string;
  name: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "group", id: input.groupId });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_groups")
    .update({ name: input.name.trim() })
    .eq("id", input.groupId)
    .eq("workspace_id", input.workspaceId)
    .select("id")
    .maybeSingle();
  if (error) dbMessage(error, "Could not rename the group.");
  if (!data) throw new ValidationError("That group is not in this organization.");
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.renamed",
    entityType: "grm_groups",
    entityId: input.groupId,
    metadata: { name: input.name.trim() },
  });
}

export async function mergeHierarchyGroups(input: {
  workspaceId: string;
  userId: string;
  sourceId: string;
  targetId: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "group", id: input.sourceId });
  await assertManager(input.userId, input.workspaceId, { kind: "group", id: input.targetId });
  const admin = createAdminClient();
  const rows = await admin
    .from("grm_groups")
    .select("id, kind, client_id, parent_id")
    .eq("workspace_id", input.workspaceId)
    .in("id", [input.sourceId, input.targetId]);
  if (rows.error) throw new AppError("Could not load the groups.", "DB_ERROR", 500);
  const source = rows.data?.find((row) => row.id === input.sourceId);
  const target = rows.data?.find((row) => row.id === input.targetId);
  if (!source || !target) throw new ValidationError("Both groups have to be in this organization.");
  const problem = mergeGroupsError({
    source: { id: source.id, kind: asKind(source.kind), clientId: source.client_id, parentId: source.parent_id },
    target: { id: target.id, kind: asKind(target.kind), clientId: target.client_id, parentId: target.parent_id },
  });
  if (problem) throw new ValidationError(problem);
  if (asKind(source.kind) === "region" && asKind(target.kind) === "region") {
    const reparent = await admin
      .from("grm_groups")
      .update({ parent_id: target.id })
      .eq("workspace_id", input.workspaceId)
      .eq("parent_id", source.id);
    if (reparent.error) dbMessage(reparent.error, "Could not move the cities into the other region.");
  }
  const moved = await admin
    .from("grm_google_locations")
    .update({ group_id: target.id })
    .eq("workspace_id", input.workspaceId)
    .eq("group_id", source.id);
  if (moved.error) throw new AppError("Could not move locations into the group.", "DB_ERROR", 500);
  const removed = await admin.from("grm_groups").delete().eq("id", source.id).eq("workspace_id", input.workspaceId);
  if (removed.error) dbMessage(removed.error, "Could not remove the merged group.");
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.merged",
    entityType: "grm_groups",
    entityId: target.id,
    metadata: { merged: source.id },
  });
}

export async function removeEmptyGroup(input: { workspaceId: string; userId: string; groupId: string }): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "group", id: input.groupId });
  const admin = createAdminClient();
  const [children, locations] = await Promise.all([
    admin.from("grm_groups").select("id").eq("workspace_id", input.workspaceId).eq("parent_id", input.groupId),
    admin.from("grm_google_locations").select("id").eq("workspace_id", input.workspaceId).eq("group_id", input.groupId).limit(1),
  ]);
  if (children.error || locations.error) throw new AppError("Could not check the group.", "DB_ERROR", 500);
  if ((children.data ?? []).length > 0) throw new ValidationError("Move or remove the cities in this region first.");
  if ((locations.data ?? []).length > 0) throw new ValidationError("Move the locations out of this group first.");
  const removed = await admin.from("grm_groups").delete().eq("id", input.groupId).eq("workspace_id", input.workspaceId);
  if (removed.error) dbMessage(removed.error, "Could not remove the group.");
}

export async function moveHierarchyLocations(input: {
  workspaceId: string;
  userId: string;
  locationIds: string[];
  groupId: string | null;
  confirmHold: boolean;
}): Promise<void> {
  if (input.locationIds.length === 0) throw new ValidationError("Select at least one location.");
  for (const locationId of input.locationIds) {
    await assertManager(input.userId, input.workspaceId, { kind: "location", id: locationId });
  }
  if (input.groupId) {
    await assertManager(input.userId, input.workspaceId, { kind: "group", id: input.groupId });
  }
  const admin = createAdminClient();
  const locations = await admin
    .from("grm_google_locations")
    .select("id, workspace_id, client_id, hold_reason")
    .eq("workspace_id", input.workspaceId)
    .in("id", input.locationIds);
  if (locations.error) throw new AppError("Could not load the locations.", "DB_ERROR", 500);
  if ((locations.data ?? []).length !== input.locationIds.length) {
    throw new ValidationError("One of those locations is not in this organization.");
  }
  if ((locations.data ?? []).some((location) => location.hold_reason) && !input.confirmHold) {
    throw new ValidationError("A selected profile is unverified or a suspected duplicate. Confirm to move it.");
  }
  if (input.groupId) {
    const group = await admin
      .from("grm_groups")
      .select("id, workspace_id, client_id")
      .eq("id", input.groupId)
      .maybeSingle();
    if (group.error || !group.data) throw new ValidationError("That group is not in this organization.");
    for (const location of locations.data ?? []) {
      const problem = locationMoveError({
        locationWorkspaceId: location.workspace_id,
        groupWorkspaceId: group.data.workspace_id,
        locationClientId: location.client_id,
        groupClientId: group.data.client_id,
      });
      if (problem) throw new ValidationError(problem);
    }
  }
  const { error } = await admin
    .from("grm_google_locations")
    .update({ group_id: input.groupId })
    .eq("workspace_id", input.workspaceId)
    .in("id", input.locationIds);
  if (error) dbMessage(error, "Could not move the locations.");
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location.moved",
    entityType: "grm_google_locations",
    entityId: input.locationIds[0],
    metadata: { count: input.locationIds.length, groupId: input.groupId },
  });
}

export async function setLocationTags(input: {
  workspaceId: string;
  userId: string;
  locationId: string;
  tags: string[];
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "location", id: input.locationId });
  const names = [...new Set(input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0 && tag.length <= 40))];
  const admin = createAdminClient();
  const location = await admin
    .from("grm_google_locations")
    .select("id")
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (location.error || !location.data) throw new ValidationError("That location is not in this organization.");
  const existing = await admin.from("grm_location_tags").select("id, name").eq("workspace_id", input.workspaceId);
  if (existing.error) throw new AppError("Could not load tags.", "DB_ERROR", 500);
  const byName = new Map((existing.data ?? []).map((tag) => [tag.name, tag.id]));
  for (const name of names) {
    if (byName.has(name)) continue;
    const inserted = await admin.from("grm_location_tags").insert({ workspace_id: input.workspaceId, name }).select("id").maybeSingle();
    if (inserted.error || !inserted.data) dbMessage(inserted.error ?? { message: "" }, "Could not add the tag.");
    byName.set(name, inserted.data.id);
  }
  const cleared = await admin.from("grm_location_tag_links").delete().eq("location_id", input.locationId);
  if (cleared.error) throw new AppError("Could not update tags.", "DB_ERROR", 500);
  const wanted = names.map((name) => byName.get(name)).filter((id): id is string => Boolean(id));
  if (wanted.length) {
    const linked = await admin.from("grm_location_tag_links").insert(wanted.map((tagId) => ({ location_id: input.locationId, tag_id: tagId })));
    if (linked.error) throw new AppError("Could not update tags.", "DB_ERROR", 500);
  }
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location.tagged",
    entityType: "grm_google_locations",
    entityId: input.locationId,
    metadata: { tags: names },
  });
}

export async function setLocationManager(input: {
  workspaceId: string;
  userId: string;
  locationId: string;
  managerUserId: string | null;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "location", id: input.locationId });
  const admin = createAdminClient();
  const location = await admin
    .from("grm_google_locations")
    .select("id")
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (location.error || !location.data) throw new ValidationError("That location is not in this organization.");
  if (input.managerUserId) {
    const member = await admin
      .from("grm_workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.managerUserId)
      .maybeSingle();
    if (member.error || !member.data) throw new ValidationError("The store manager has to be a member of this organization.");
  }
  const saved = await admin
    .from("grm_google_locations")
    .update({ manager_user_id: input.managerUserId })
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId);
  if (saved.error) throw new AppError("Could not assign the store manager.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location.manager_set",
    entityType: "grm_google_locations",
    entityId: input.locationId,
    metadata: { managerUserId: input.managerUserId },
  });
}

export async function saveScopeSettings(input: {
  workspaceId: string;
  userId: string;
  scope: "client" | "group" | "location";
  targetId: string;
  fields: SettingFields;
}): Promise<void> {
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: "edit_rules",
    target: { kind: input.scope, id: input.targetId },
  });
  if (input.fields.slaHours !== null && (input.fields.slaHours < 1 || input.fields.slaHours > 168)) {
    throw new ValidationError("SLA hours have to be between 1 and 168.");
  }
  const admin = createAdminClient();
  if (input.scope === "client") {
    const client = await admin.from("grm_clients").select("id").eq("id", input.targetId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (client.error || !client.data) throw new ValidationError("That brand is not in this organization.");
  } else if (input.scope === "group") {
    const group = await admin.from("grm_groups").select("id").eq("id", input.targetId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (group.error || !group.data) throw new ValidationError("That group is not in this organization.");
  } else {
    const location = await admin.from("grm_google_locations").select("id").eq("id", input.targetId).eq("workspace_id", input.workspaceId).maybeSingle();
    if (location.error || !location.data) throw new ValidationError("That location is not in this organization.");
  }
  const blank =
    !input.fields.toneVoice &&
    !input.fields.toneNote &&
    input.fields.slaHours === null &&
    !input.fields.routingLevel &&
    input.fields.draftsPaused === null;
  const column = input.scope === "client" ? "client_id" : input.scope === "group" ? "group_id" : "location_id";
  if (blank) {
    const removed = await admin.from("grm_scope_settings").delete().eq("workspace_id", input.workspaceId).eq(column, input.targetId);
    if (removed.error) throw new AppError("Could not clear the override.", "DB_ERROR", 500);
  } else {
    const payload = {
      tone_voice: input.fields.toneVoice,
      tone_note: input.fields.toneNote,
      sla_hours: input.fields.slaHours,
      routing_level: input.fields.routingLevel,
      drafts_paused: input.fields.draftsPaused,
    };
    const existing = await admin.from("grm_scope_settings").select("id").eq("workspace_id", input.workspaceId).eq(column, input.targetId).maybeSingle();
    if (existing.error) throw new AppError("Could not save the override.", "DB_ERROR", 500);
    const saved = existing.data
      ? await admin.from("grm_scope_settings").update(payload).eq("id", existing.data.id)
      : await admin.from("grm_scope_settings").insert({
          workspace_id: input.workspaceId,
          scope: input.scope,
          client_id: input.scope === "client" ? input.targetId : null,
          group_id: input.scope === "group" ? input.targetId : null,
          location_id: input.scope === "location" ? input.targetId : null,
          ...payload,
        });
    if (saved.error) throw new AppError("Could not save the override.", "DB_ERROR", 500);
  }
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location.settings_updated",
    entityType: "grm_scope_settings",
    entityId: input.targetId,
    metadata: { scope: input.scope, cleared: blank },
  });
}

export async function reviewDuplicate(input: {
  workspaceId: string;
  userId: string;
  locationId: string;
  duplicate: boolean;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId, { kind: "location", id: input.locationId });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_google_locations")
    .update({ hold_reason: input.duplicate ? "duplicate" : null })
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new ValidationError("That location is not in this organization.");
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location.duplicate_reviewed",
    entityType: "grm_google_locations",
    entityId: input.locationId,
    metadata: { duplicate: input.duplicate },
  });
}

async function chainForLocation(workspaceId: string, locationId: string): Promise<SettingNode[]> {
  const admin = createAdminClient();
  const locationResult = await admin
    .from("grm_google_locations")
    .select("id, client_id, group_id, location_title")
    .eq("workspace_id", workspaceId)
    .eq("id", locationId);
  const location = Array.isArray(locationResult.data) ? locationResult.data[0] : null;
  if (!location) return [];
  const [groupsResult, settingsResult, clientResult] = await Promise.all([
    admin.from("grm_groups").select("id, name, parent_id, client_id").eq("workspace_id", workspaceId),
    admin
      .from("grm_scope_settings")
      .select("client_id, group_id, location_id, tone_voice, tone_note, sla_hours, routing_level, drafts_paused")
      .eq("workspace_id", workspaceId),
    location.client_id
      ? admin.from("grm_clients").select("id, name").eq("id", location.client_id).eq("workspace_id", workspaceId)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const groups = new Map((Array.isArray(groupsResult.data) ? groupsResult.data : []).map((group) => [group.id, group]));
  const settings = Array.isArray(settingsResult.data) ? settingsResult.data : [];
  const client = Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  const nodes: SettingNode[] = [
    {
      id: location.id,
      label: location.location_title || "This location",
      fields: fieldsFrom(settings.find((row) => row.location_id === location.id)),
    },
  ];
  const group = location.group_id ? groups.get(location.group_id) : null;
  if (group) {
    nodes.push({ id: group.id, label: group.name, fields: fieldsFrom(settings.find((row) => row.group_id === group.id)) });
    const parent = group.parent_id ? groups.get(group.parent_id) : null;
    if (parent) nodes.push({ id: parent.id, label: parent.name, fields: fieldsFrom(settings.find((row) => row.group_id === parent.id)) });
  }
  if (client) nodes.push({ id: client.id, label: client.name, fields: fieldsFrom(settings.find((row) => row.client_id === client.id)) });
  return nodes;
}

export async function resolvedToneForLocation(
  workspaceId: string,
  locationId: string
): Promise<{ voice: ToneVoice | null; note: string | null } | null> {
  const workspace = await getWorkspaceTone(workspaceId);
  const chain = await chainForLocation(workspaceId, locationId);
  const voice = describeSetting(chain, (fields) => fields.toneVoice, { value: workspace?.voice ?? null, source: "the workspace" });
  const note = describeSetting(chain, (fields) => fields.toneNote, { value: workspace?.note ?? null, source: "the workspace" });
  if (!voice.overridden && !note.overridden && chain.slice(1).every((node) => !node.fields.toneVoice && !node.fields.toneNote)) {
    return workspace;
  }
  return { voice: voice.value, note: note.value };
}

export async function draftsPausedForLocation(workspaceId: string, locationId: string): Promise<boolean> {
  const chain = await chainForLocation(workspaceId, locationId);
  return describeSetting(chain, (fields) => fields.draftsPaused, { value: false, source: "the workspace" }).value;
}

export async function escalationTiming(
  workspaceId: string,
  locationIds: string[],
  fallbackHours: number
): Promise<Map<string, { hours: number; level: RoutingLevel | null }>> {
  const unique = [...new Set(locationIds)];
  const result = new Map<string, { hours: number; level: RoutingLevel | null }>();
  if (unique.length === 0) return result;
  const admin = createAdminClient();
  const [locationsResult, groupsResult, settingsResult] = await Promise.all([
    admin.from("grm_google_locations").select("id, client_id, group_id, location_title").eq("workspace_id", workspaceId).in("id", unique),
    admin.from("grm_groups").select("id, name, parent_id, client_id").eq("workspace_id", workspaceId),
    admin.from("grm_scope_settings").select("client_id, group_id, location_id, tone_voice, tone_note, sla_hours, routing_level, drafts_paused").eq("workspace_id", workspaceId),
  ]);
  if (locationsResult.error || groupsResult.error || settingsResult.error) {
    throw new AppError("Could not load location settings.", "DB_ERROR", 500);
  }
  const locations = Array.isArray(locationsResult.data) ? locationsResult.data : [];
  const groups = new Map((Array.isArray(groupsResult.data) ? groupsResult.data : []).map((group) => [group.id, group]));
  const settings = Array.isArray(settingsResult.data) ? settingsResult.data : [];
  for (const location of locations) {
    const nodes: SettingNode[] = [
      { id: location.id, label: location.location_title || "This location", fields: fieldsFrom(settings.find((row) => row.location_id === location.id)) },
    ];
    const group = location.group_id ? groups.get(location.group_id) : null;
    if (group) {
      nodes.push({ id: group.id, label: group.name, fields: fieldsFrom(settings.find((row) => row.group_id === group.id)) });
      const parent = group.parent_id ? groups.get(group.parent_id) : null;
      if (parent) nodes.push({ id: parent.id, label: parent.name, fields: fieldsFrom(settings.find((row) => row.group_id === parent.id)) });
    }
    if (location.client_id) {
      nodes.push({
        id: location.client_id,
        label: "Brand",
        fields: fieldsFrom(settings.find((row) => row.client_id === location.client_id)),
      });
    }
    const hours = describeSetting(nodes, (fields) => fields.slaHours, { value: fallbackHours, source: "the workspace" });
    const routing = describeSetting(nodes, (fields) => fields.routingLevel, { value: null as RoutingLevel | null, source: "the workspace" });
    const inheritedHours = !hours.overridden && nodes.slice(1).every((node) => node.fields.slaHours === null);
    const inheritedLevel = !routing.overridden && nodes.slice(1).every((node) => !node.fields.routingLevel);
    result.set(location.id, { hours: inheritedHours ? fallbackHours : hours.value, level: inheritedLevel ? null : routing.value });
  }
  return result;
}
