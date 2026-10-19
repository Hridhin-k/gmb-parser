import { createAdminClient } from "@/lib/supabase/admin";
import { previousDateRange, type DateRange } from "@/lib/date-range";
import { ESCALATION_TIMEZONES } from "@/lib/escalations";
import { parseDashboardFacts, type DashboardFacts } from "@/lib/metrics";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { locationDisplayName } from "@/lib/ui/location-place";

export interface DashboardScope {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
}

export interface DashboardLocation {
  id: string;
  clientId: string | null;
  groupId: string | null;
  parentGroupId: string | null;
  name: string;
  isActive: boolean;
  holdReason: string | null;
  voiceOfMerchant: boolean | null;
  lastSyncedAt: string | null;
}

export interface DashboardContext {
  timezone: string;
  replyTarget: number | null;
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  clients: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  locations: DashboardLocation[];
  expiredConnections: number;
  revokedConnections: number;
  pauses: { workspace: boolean; clientIds: string[]; locationIds: string[] };
  insights: Array<{ locationId: string; summary: string; reviewCount: number; generatedAt: string }>;
}

async function loadFacts(
  workspaceId: string,
  scope: DashboardScope,
  start: string | null,
  end: string | null,
  timezone: string
): Promise<DashboardFacts> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grm_dashboard_bundle", {
    p_workspace_id: workspaceId,
    p_client_id: scope.clientId,
    p_group_id: scope.groupId,
    p_location_id: scope.locationId,
    p_start: start,
    p_end: end,
    p_timezone: timezone,
  });
  if (error) throw new Error(`Failed to load dashboard metrics: ${error.message}`);
  return parseDashboardFacts(data);
}

export async function getDashboardContext(
  workspaceId: string,
  range: DateRange,
  scope: DashboardScope
): Promise<DashboardContext> {
  const admin = createAdminClient();
  const previousWindow = previousDateRange(range);
  // Metrics RPCs do not depend on the catalog rows — start them with the default
  // timezone, then redo only if the workspace policy uses a different zone.
  const defaultTimezone = "Asia/Kolkata";
  const startIso = range.start?.toISOString() ?? null;
  const endIso = range.end?.toISOString() ?? null;
  const [
    policy,
    clientsResult,
    groupsResult,
    locationsResult,
    connectionsResult,
    pausesResult,
    insightsResult,
    factsDefault,
    previousDefault,
  ] = await Promise.all([
    admin
      .from("grm_escalation_policies")
      .select("timezone, reply_rate_target")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("grm_clients")
      .select("id, name, notes")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
      .order("name"),
    admin.from("grm_groups").select("id, name, parent_id").eq("workspace_id", workspaceId).order("name"),
    admin
      .from("grm_google_locations")
      .select(
        "id, client_id, group_id, location_title, store_code, address_formatted, is_active, hold_reason, voice_of_merchant, last_synced_at"
      )
      .eq("workspace_id", workspaceId),
    admin.from("grm_google_connections").select("status").eq("workspace_id", workspaceId),
    admin
      .from("grm_autoreply_pauses")
      .select("scope, client_id, location_id")
      .eq("workspace_id", workspaceId)
      .is("cleared_at", null),
    admin
      .from("grm_location_insights")
      .select("location_id, summary, review_count, generated_at")
      .eq("workspace_id", workspaceId),
    loadFacts(workspaceId, scope, startIso, endIso, defaultTimezone),
    previousWindow
      ? loadFacts(workspaceId, scope, previousWindow.start.toISOString(), previousWindow.end.toISOString(), defaultTimezone)
      : Promise.resolve(null),
  ]);

  if (policy.error) throw new Error(`Failed to load dashboard settings: ${policy.error.message}`);
  if (clientsResult.error) throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  if (groupsResult.error) throw new Error(`Failed to load groups: ${groupsResult.error.message}`);
  if (locationsResult.error) throw new Error(`Failed to load locations: ${locationsResult.error.message}`);
  if (connectionsResult.error) throw new Error(`Failed to load Google connections: ${connectionsResult.error.message}`);
  if (pausesResult.error) throw new Error(`Failed to load autoreply pauses: ${pausesResult.error.message}`);
  if (insightsResult.error) throw new Error(`Failed to load location insights: ${insightsResult.error.message}`);

  const timezone = ESCALATION_TIMEZONES.some((zone) => zone.id === policy.data?.timezone)
    ? policy.data!.timezone
    : defaultTimezone;
  const target = policy.data?.reply_rate_target;
  const replyTarget = target === null || target === undefined ? null : Number(target);

  const [facts, previous] =
    timezone === defaultTimezone
      ? [factsDefault, previousDefault]
      : await Promise.all([
          loadFacts(workspaceId, scope, startIso, endIso, timezone),
          previousWindow
            ? loadFacts(
                workspaceId,
                scope,
                previousWindow.start.toISOString(),
                previousWindow.end.toISOString(),
                timezone
              )
            : Promise.resolve(null),
        ]);

  const clients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .map((client) => ({ id: client.id, name: client.name }));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const parentByGroup = new Map((groupsResult.data ?? []).map((group) => [group.id, group.parent_id]));
  const locations: DashboardLocation[] = (locationsResult.data ?? [])
    .filter((location) => location.client_id && clientNames.has(location.client_id))
    .map((location) => ({
      id: location.id,
      clientId: location.client_id,
      groupId: location.group_id,
      parentGroupId: location.group_id ? parentByGroup.get(location.group_id) ?? null : null,
      name: locationDisplayName({
        title: location.location_title,
        brand: clientNames.get(location.client_id!),
        storeCode: location.store_code,
        address: location.address_formatted,
      }),
      isActive: location.is_active,
      holdReason: location.hold_reason,
      voiceOfMerchant: location.voice_of_merchant,
      lastSyncedAt: location.last_synced_at,
    }));

  const connections = connectionsResult.data ?? [];
  const pauses = pausesResult.data ?? [];
  return {
    timezone,
    replyTarget: Number.isFinite(replyTarget) ? replyTarget : null,
    facts,
    previous,
    clients,
    groups: groupsResult.data ?? [],
    locations,
    expiredConnections: connections.filter((row) => row.status === "expired").length,
    revokedConnections: connections.filter((row) => row.status === "revoked").length,
    pauses: {
      workspace: pauses.some((row) => row.scope === "workspace"),
      clientIds: pauses.flatMap((row) => (row.client_id ? [row.client_id] : [])),
      locationIds: pauses.flatMap((row) => (row.location_id ? [row.location_id] : [])),
    },
    insights: (insightsResult.data ?? []).map((row) => ({
      locationId: row.location_id,
      summary: row.summary,
      reviewCount: row.review_count,
      generatedAt: row.generated_at,
    })),
  };
}
