import { createAdminClient } from "@/lib/supabase/admin";
import { previousDateRange, type DateRange } from "@/lib/date-range";
import { ESCALATION_TIMEZONES } from "@/lib/escalations";
import { parseDashboardFacts, type DashboardFacts } from "@/lib/metrics";
import { applyStarBreakdown } from "@/lib/star-breakdown";
import { loadStarBreakdown } from "@/lib/services/star-breakdown";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { loadCatalogTables } from "@/lib/services/catalog-tables";
import { dashboardContextCacheKey } from "@/lib/services/dashboard-cache";
import { remember } from "@/lib/ttl-cache";
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
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  clients: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  locations: DashboardLocation[];
  expiredConnections: number;
  revokedConnections: number;
  pauses: { workspace: boolean; clientIds: string[]; locationIds: string[] };
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

/**
 * Facts for one window (current + previous) without the catalog, policy,
 * connections or star-breakdown work of a full dashboard context. For
 * callers that already hold a context and only need a second window's
 * totals (e.g. the mobile 7-day brief inside a 30-day view).
 */
export async function loadDashboardWindowFacts(
  workspaceId: string,
  scope: DashboardScope,
  range: DateRange,
  timezone: string
): Promise<{ facts: DashboardFacts; previous: DashboardFacts | null }> {
  const previousWindow = previousDateRange(range);
  const [facts, previous] = await Promise.all([
    loadFacts(workspaceId, scope, range.start?.toISOString() ?? null, range.end?.toISOString() ?? null, timezone),
    previousWindow
      ? loadFacts(workspaceId, scope, previousWindow.start.toISOString(), previousWindow.end.toISOString(), timezone)
      : Promise.resolve(null),
  ]);
  return { facts, previous };
}

export async function getDashboardContext(
  workspaceId: string,
  range: DateRange,
  scope: DashboardScope
): Promise<DashboardContext> {
  const key = dashboardContextCacheKey(workspaceId, scope, {
    start: range.start?.toISOString() ?? null,
    end: range.end?.toISOString() ?? null,
  });
  return remember(key, 45_000, () => loadDashboardContext(workspaceId, range, scope));
}

/** Default zone used when the workspace policy is missing or unknown. */
export const DASHBOARD_DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Resolve the timezone the metrics RPCs must use. Pure so tests can cover it. */
export function resolveDashboardTimezone(policyTimezone: string | null | undefined): string {
  return ESCALATION_TIMEZONES.some((zone) => zone.id === policyTimezone)
    ? policyTimezone!
    : DASHBOARD_DEFAULT_TIMEZONE;
}

/**
 * Bundle RPC windows for one dashboard request. Current and previous periods
 * stay separate: they use different date bounds and must not share a cached
 * payload across tenants or filter combinations. All-time has no previous.
 */
export function dashboardFactWindows(
  range: DateRange,
  timezone: string
): Array<{ kind: "current" | "previous"; start: string | null; end: string | null; timezone: string }> {
  const windows: Array<{
    kind: "current" | "previous";
    start: string | null;
    end: string | null;
    timezone: string;
  }> = [
    {
      kind: "current",
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
      timezone,
    },
  ];
  const previousWindow = previousDateRange(range);
  if (previousWindow) {
    windows.push({
      kind: "previous",
      start: previousWindow.start.toISOString(),
      end: previousWindow.end.toISOString(),
      timezone,
    });
  }
  return windows;
}

async function loadDashboardContext(
  workspaceId: string,
  range: DateRange,
  scope: DashboardScope
): Promise<DashboardContext> {
  const admin = createAdminClient();
  // Resolve timezone before metrics RPCs so we never speculative-fetch under
  // Asia/Kolkata and then redo when the policy uses another zone.
  const policy = await admin
    .from("grm_escalation_policies")
    .select("timezone")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (policy.error) throw new Error(`Failed to load dashboard settings: ${policy.error.message}`);
  const timezone = resolveDashboardTimezone(policy.data?.timezone);
  const windows = dashboardFactWindows(range, timezone);
  const currentWindow = windows.find((window) => window.kind === "current")!;
  const previousWindow = windows.find((window) => window.kind === "previous") ?? null;
  const startIso = currentWindow.start;
  const endIso = currentWindow.end;
  const starsFor = (catalog: Awaited<ReturnType<typeof loadCatalogTables>>) => {
    const names = new Map(
      catalog.clients
        .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
        .map((client) => [client.id, client.name])
    );
    const parents = new Map(catalog.groups.map((group) => [group.id, group.parent_id]));
    const scoped = catalog.locations.filter((location) => {
      if (!location.client_id || !names.has(location.client_id)) return false;
      if (scope.locationId && location.id !== scope.locationId) return false;
      if (scope.clientId && location.client_id !== scope.clientId) return false;
      if (scope.groupId && location.group_id !== scope.groupId) {
        const parent = location.group_id ? parents.get(location.group_id) ?? null : null;
        if (parent !== scope.groupId) return false;
      }
      return true;
    });
    return loadStarBreakdown({
      workspaceId,
      locationIds: scoped.map((location) => location.id),
      groupByLocation: new Map(scoped.map((location) => [location.id, location.group_id])),
      start: startIso,
      end: endIso,
      timezone,
    });
  };
  const catalogPromise = loadCatalogTables(workspaceId);
  const [catalog, connectionsResult, pausesResult, factsBase, previous, starMaps] = await Promise.all([
    catalogPromise,
    admin.from("grm_google_connections").select("status").eq("workspace_id", workspaceId),
    admin
      .from("grm_autoreply_pauses")
      .select("scope, client_id, location_id")
      .eq("workspace_id", workspaceId)
      .is("cleared_at", null),
    loadFacts(workspaceId, scope, currentWindow.start, currentWindow.end, timezone),
    previousWindow
      ? loadFacts(workspaceId, scope, previousWindow.start, previousWindow.end, timezone)
      : Promise.resolve(null),
    catalogPromise.then((tables) => starsFor(tables)),
  ]);

  if (connectionsResult.error) throw new Error(`Failed to load Google connections: ${connectionsResult.error.message}`);
  if (pausesResult.error) throw new Error(`Failed to load autoreply pauses: ${pausesResult.error.message}`);

  const clients = catalog.clients
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .map((client) => ({ id: client.id, name: client.name }));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const parentByGroup = new Map(catalog.groups.map((group) => [group.id, group.parent_id]));
  const facts = starMaps ? applyStarBreakdown(factsBase, starMaps) : factsBase;
  const locations: DashboardLocation[] = catalog.locations
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
    facts,
    previous,
    clients,
    groups: catalog.groups.map((group) => ({ id: group.id, name: group.name })),
    locations,
    expiredConnections: connections.filter((row) => row.status === "expired").length,
    revokedConnections: connections.filter((row) => row.status === "revoked").length,
    pauses: {
      workspace: pauses.some((row) => row.scope === "workspace"),
      clientIds: pauses.flatMap((row) => (row.client_id ? [row.client_id] : [])),
      locationIds: pauses.flatMap((row) => (row.location_id ? [row.location_id] : [])),
    },
  };
}
