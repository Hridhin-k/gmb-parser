import { createAdminClient } from "@/lib/supabase/admin";
import { rpcLocationReviewStats } from "@/lib/supabase/rpc";
import { loadAuthProfiles } from "@/lib/services/auth-profiles";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import type { DateRange } from "@/lib/date-range";
export type AgencyConnection = "connected" | "attention" | "waiting";

export interface AgencyClientRow {
  id: string;
  name: string;
  locations: number;
  rating: number | null;
  replyRate: number | null;
  unreplied: number;
  escalations: number;
  clientApprovals: number;
  reviewCount: number;
  connection: AgencyConnection;
  attentionCount: number;
  manager: string | null;
}

export interface AgencyUsageRow {
  id: string;
  name: string;
  locations: number;
  reviews: number;
  publishedReplies: number;
  recordedEvents: number;
}

export interface AgencyHome {
  hasConnection: boolean;
  /** Active Google connection used by "Sync profiles"; null until Google is connected. */
  connectionId: string | null;
  hasReviews: boolean;
  hasPublished: boolean;
  kpis: {
    clients: number;
    locations: number;
    unreplied: number;
    waitingApproval: number;
    openEscalations: number;
    connectionProblems: number;
  };
  rows: AgencyClientRow[];
  totalClients: number;
  page: number;
  pageSize: number;
  usage: AgencyUsageRow[];
  usageHeading: string;
  approvals: number;
}

interface ClientRef {
  id: string;
  name: string;
  manager: string | null;
  directConnection: "active" | "problem" | null;
}

interface LocationRef {
  id: string;
  clientId: string | null;
  title: string;
  connection: "active" | "problem" | "missing";
}

interface LocationStat {
  location_id: string;
  review_count: number;
  unanswered: number;
  approved: number;
  critical: number;
  rating_sum: number;
  published: number;
  open_escalations: number;
  client_approvals: number;
}

interface LocationCount {
  location_id: string;
  review_count: number;
}

const PAGE_SIZE = 8;

export function usageHeading(rangeLabel: string): string {
  return `Usage · ${rangeLabel.charAt(0).toLowerCase()}${rangeLabel.slice(1)}`;
}

interface PortfolioRow extends AgencyClientRow {
  approved: number;
}

export function buildAgencyHome(input: {
  clients: ClientRef[];
  locations: LocationRef[];
  stats: LocationStat[];
  hasConnection: boolean;
  connectionId?: string | null;
  /** Reviews per location inside the selected range; omit for all time. */
  rangeCounts?: LocationCount[] | null;
  publishedCounts?: LocationCount[] | null;
  eventsByClient?: Array<{ client_id: string; count: number }> | null;
  rangeLabel: string;
  clientId: string;
  q: string;
  page: number;
  pageSize?: number;
  /**
   * Set when the caller already paginated the client list on the server:
   * `clients`/`locations`/`stats` then cover only the requested page, and
   * these workspace-wide figures keep the KPIs and totals honest.
   */
  precomputed?: {
    totalClients: number;
    kpis: AgencyHome["kpis"];
    hasReviews: boolean;
    hasPublished: boolean;
    approvals: number;
  };
}): AgencyHome {
  const pageSize = input.pageSize ?? PAGE_SIZE;
  const statsByLocation = new Map(input.stats.map((stat) => [stat.location_id, stat]));
  const rangeCounts = input.rangeCounts
    ? new Map(input.rangeCounts.map((row) => [row.location_id, Number(row.review_count)]))
    : null;
  const rangeVolume = (locationId: string) =>
    rangeCounts
      ? (rangeCounts.get(locationId) ?? 0)
      : (statsByLocation.get(locationId)?.review_count ?? 0);
  const publishedByLocation = new Map(
    (input.publishedCounts ?? []).map((row) => [row.location_id, Number(row.review_count)])
  );
  const eventsByClient = new Map(
    (input.eventsByClient ?? []).map((row) => [row.client_id, Number(row.count)])
  );
  const query = input.q.trim().toLowerCase();

  const locationsByClient = new Map<string, LocationRef[]>();
  for (const location of input.locations) {
    if (!location.clientId) continue;
    const list = locationsByClient.get(location.clientId) ?? [];
    list.push(location);
    locationsByClient.set(location.clientId, list);
  }

  const allRows: PortfolioRow[] = input.clients.map((client) => {
    const locations = locationsByClient.get(client.id) ?? [];
    let reviewCount = 0;
    let ratingSum = 0;
    let unreplied = 0;
    let escalations = 0;
    let approved = 0;
    let clientApprovals = 0;
    let problems = 0;

    for (const location of locations) {
      if (location.connection !== "active") problems += 1;
      const stat = statsByLocation.get(location.id);
      if (!stat) continue;
      reviewCount += stat.review_count;
      ratingSum += Number(stat.rating_sum);
      unreplied += stat.unanswered;
      escalations += stat.open_escalations;
      approved += stat.client_approvals;
      clientApprovals += stat.client_approvals;
    }

    const replied = reviewCount - unreplied;
    let connection: AgencyConnection = "connected";
    if (locations.length === 0 && client.directConnection !== "active") connection = "waiting";
    if (client.directConnection === "problem" || problems > 0) connection = "attention";

    return {
      id: client.id,
      name: client.name,
      locations: locations.length,
      rating: reviewCount > 0 ? ratingSum / reviewCount : null,
      replyRate: reviewCount > 0 ? Math.round((replied / reviewCount) * 100) : null,
      unreplied,
      escalations,
      clientApprovals,
      reviewCount,
      connection,
      attentionCount: problems + (client.directConnection === "problem" ? 1 : 0),
      manager: client.manager,
      approved,
    };
  });

  const matched = allRows.filter((row) => {
    if (input.clientId && row.id !== input.clientId) return false;
    if (!query) return true;
    if (row.name.toLowerCase().includes(query)) return true;
    const locations = locationsByClient.get(row.id) ?? [];
    return locations.some((location) => location.title.toLowerCase().includes(query));
  });

  matched.sort((a, b) => a.name.localeCompare(b.name));

  const totalClients = input.precomputed?.totalClients ?? matched.length;
  const pageCount = Math.max(1, Math.ceil(totalClients / pageSize));
  const page = Math.min(Math.max(input.page, 1), pageCount);
  // With a precomputed page the caller already sliced; `matched` is the page.
  const start = input.precomputed ? 0 : (page - 1) * pageSize;
  const approvals = input.precomputed?.approvals ?? matched.reduce((sum, row) => sum + row.approved, 0);

  const usage = matched
    .map((row) => {
      const locations = locationsByClient.get(row.id) ?? [];
      const reviews = locations.reduce((sum, location) => sum + rangeVolume(location.id), 0);
      const publishedReplies = locations.reduce(
        (sum, location) => sum + (publishedByLocation.get(location.id) ?? 0),
        0
      );
      return {
        id: row.id,
        name: row.name,
        locations: row.locations,
        reviews,
        publishedReplies,
        recordedEvents: eventsByClient.get(row.id) ?? 0,
      };
    })
    .filter((row) => row.locations > 0 || row.reviews > 0);

  return {
    hasConnection: input.hasConnection,
    connectionId: input.connectionId ?? null,
    hasReviews: input.precomputed?.hasReviews ?? input.stats.some((stat) => stat.review_count > 0),
    hasPublished: input.precomputed?.hasPublished ?? input.stats.some((stat) => stat.published > 0),
    kpis: input.precomputed?.kpis ?? {
      clients: matched.length,
      locations: matched.reduce((sum, row) => sum + row.locations, 0),
      unreplied: matched.reduce((sum, row) => sum + row.unreplied, 0),
      waitingApproval: approvals,
      openEscalations: matched.reduce((sum, row) => sum + row.escalations, 0),
      connectionProblems: matched.filter((row) => row.connection === "attention").length,
    },
    rows: matched.slice(start, start + pageSize).map(({ approved: _approved, ...row }) => {
      void _approved;
      return row;
    }),
    totalClients,
    page,
    pageSize,
    usage,
    usageHeading: usageHeading(input.rangeLabel),
    approvals,
  };
}

export async function listAgencyClients(
  workspaceId: string,
  allowedIds: string[] | null = null
): Promise<Array<{ id: string; name: string }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_clients")
    .select("id, name, notes")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error("Failed to load clients");
  }

  return (data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .filter((client) => allowedIds === null || allowedIds.includes(client.id))
    .map((client) => ({ id: client.id, name: client.name }));
}

interface AgencyCounts {
  published: Map<string, number>;
  approvals: Map<string, number>;
  escalations: Map<string, number>;
  events: Map<string, number>;
}

function countRows(rows: Array<{ location_id?: string; client_id?: string; n?: number | string }> | null | undefined, key: "location_id" | "client_id"): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row[key];
    if (id) map.set(id, Number(row.n) || 0);
  }
  return map;
}

/**
 * Per-location / per-client activity counts for the portfolio. Aggregated in
 * Postgres (`grm_agency_counts`, applied in production) so the page never
 * downloads every reply, event, escalation and review id in the workspace.
 * There is deliberately no row-download fallback: if the RPC is missing the
 * page must fail loudly, not silently pull the whole reviews table.
 */
async function loadAgencyCounts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  range: DateRange
): Promise<AgencyCounts> {
  const result = await admin.rpc("grm_agency_counts", {
    p_workspace_id: workspaceId,
    p_start: range.start?.toISOString() ?? null,
    p_end: range.end?.toISOString() ?? null,
  });
  if (result.error) throw new Error("Failed to load client activity");
  const data = (result.data ?? {}) as {
    published?: Array<{ location_id: string; n: number }>;
    approvals?: Array<{ location_id: string; n: number }>;
    escalations?: Array<{ location_id: string; n: number }>;
    events?: Array<{ client_id: string; n: number }>;
  };
  return {
    published: countRows(data.published, "location_id"),
    approvals: countRows(data.approvals, "location_id"),
    escalations: countRows(data.escalations, "location_id"),
    events: countRows(data.events, "client_id"),
  };
}

/**
 * Portfolio home. The client list is paginated here, on the server: only the
 * requested page of clients is enriched with locations, stats and manager
 * names, while KPIs are computed from workspace-wide DB aggregates. Passing
 * `allPages` returns every matched client (used by the usage CSV export).
 */
export async function getAgencyHome(
  workspaceId: string,
  filters: {
    clientId: string;
    range: DateRange;
    q: string;
    page: number;
    allowedClientIds?: string[] | null;
    locationIds?: string[] | null;
    allPages?: boolean;
  }
): Promise<AgencyHome> {
  const admin = createAdminClient();
  const { range } = filters;
  const bounded = Boolean(range.start || range.end);

  const [clientsResult, locationsResult, connectionsResult, accountsResult, statsResult, countsResult, counts] =
    await Promise.all([
      admin
        .from("grm_clients")
        .select("id, name, notes, account_manager_user_id")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name"),
      admin
        .from("grm_google_locations")
        .select("id, client_id, location_title, google_account_id")
        .eq("workspace_id", workspaceId),
      admin.from("grm_google_connections").select("id, status, client_id").eq("workspace_id", workspaceId),
      admin.from("grm_google_accounts").select("id, connection_id").eq("workspace_id", workspaceId),
      rpcLocationReviewStats(admin, workspaceId),
      bounded
        ? admin.rpc("grm_location_review_counts", {
            p_workspace_id: workspaceId,
            p_start: range.start?.toISOString() ?? null,
            p_end: range.end?.toISOString() ?? null,
          })
        : Promise.resolve(null),
      loadAgencyCounts(admin, workspaceId, range),
    ]);

  if (clientsResult.error) throw new Error("Failed to load clients");
  if (locationsResult.error) throw new Error("Failed to load locations");
  if (connectionsResult.error) throw new Error("Failed to load Google connection");
  if (accountsResult.error) throw new Error("Failed to load client activity");
  if (statsResult.error) throw new Error("Failed to load review stats");
  if (countsResult?.error) throw new Error("Failed to load review counts for this range");

  const allowed = filters.allowedClientIds ?? null;
  const connectionByAccount = new Map((accountsResult.data ?? []).map((account) => [account.id, account.connection_id]));
  const connectionStatus = new Map((connectionsResult.data ?? []).map((connection) => [connection.id, connection.status]));
  const directConnectionFor = (clientId: string): "active" | "problem" | null => {
    const direct = (connectionsResult.data ?? []).filter((connection) => connection.client_id === clientId);
    if (direct.length === 0) return null;
    return direct.every((connection) => connection.status === "active") ? "active" : "problem";
  };
  const toLocationRef = (location: { id: string; client_id: string | null; location_title: string; google_account_id: string }): LocationRef => {
    const connectionId = connectionByAccount.get(location.google_account_id);
    const status = connectionId ? connectionStatus.get(connectionId) : null;
    return {
      id: location.id,
      clientId: location.client_id,
      title: location.location_title,
      connection: !status ? "missing" : status === "active" ? "active" : "problem",
    };
  };

  const visibleClients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .filter((client) => allowed === null || allowed.includes(client.id));
  const visibleClientIds = new Set(visibleClients.map((client) => client.id));
  const scopedLocations = (locationsResult.data ?? [])
    .filter((location) => location.client_id && visibleClientIds.has(location.client_id))
    .filter((location) => filters.locationIds == null || filters.locationIds.includes(location.id));

  // Match the pure builder's semantics: client-id filter (with the nil-UUID
  // sentinel for an out-of-scope request), then name / location-title search.
  const effectiveClientId =
    allowed && filters.clientId && !allowed.includes(filters.clientId)
      ? "00000000-0000-0000-0000-000000000000"
      : filters.clientId;
  const query = filters.q.trim().toLowerCase();
  const titlesByClient = new Map<string, string[]>();
  for (const location of scopedLocations) {
    if (!location.client_id) continue;
    const list = titlesByClient.get(location.client_id) ?? [];
    list.push(location.location_title.toLowerCase());
    titlesByClient.set(location.client_id, list);
  }
  const matched = visibleClients
    .filter((client) => !effectiveClientId || client.id === effectiveClientId)
    .filter(
      (client) =>
        !query ||
        client.name.toLowerCase().includes(query) ||
        (titlesByClient.get(client.id) ?? []).some((title) => title.includes(query))
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalClients = matched.length;
  const pageCount = Math.max(1, Math.ceil(totalClients / PAGE_SIZE));
  const page = Math.min(Math.max(filters.page, 1), pageCount);
  const pageClients = filters.allPages ? matched : matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageClientIds = new Set(pageClients.map((client) => client.id));

  const statsByLocation = new Map((statsResult.data ?? []).map((stat) => [stat.location_id, stat]));
  const matchedLocations = scopedLocations.filter((location) => location.client_id && matched.some((c) => c.id === location.client_id));
  const matchedClientOfLocation = new Map(matchedLocations.map((location) => [location.id, location.client_id!]));

  // Workspace-wide KPI figures across every matched client, from aggregates.
  let kpiLocations = 0;
  let kpiUnreplied = 0;
  let kpiEscalations = 0;
  let kpiApprovals = 0;
  let hasReviews = false;
  let hasPublished = false;
  for (const location of matchedLocations) {
    kpiLocations += 1;
    const stat = statsByLocation.get(location.id);
    if (stat) {
      kpiUnreplied += stat.unanswered;
      if (stat.review_count > 0) hasReviews = true;
      if (stat.published > 0) hasPublished = true;
    }
    kpiEscalations += counts.escalations.get(location.id) ?? 0;
    kpiApprovals += counts.approvals.get(location.id) ?? 0;
  }
  const connectionProblems = matched.filter((client) => {
    if (directConnectionFor(client.id) === "problem") return true;
    return matchedLocations.some(
      (location) => location.client_id === client.id && toLocationRef(location).connection !== "active"
    );
  }).length;

  // Manager names only for the clients about to render.
  const managerIds = [...new Set(pageClients.flatMap((client) => (client.account_manager_user_id ? [client.account_manager_user_id] : [])))];
  const managerProfiles = await loadAuthProfiles(managerIds);
  const managerName = (userId: string | null): string | null => {
    if (!userId) return null;
    const email = managerProfiles.get(userId)?.email;
    return email && email !== "Unknown email" ? email : "Account manager";
  };

  const pageLocations = scopedLocations.filter((location) => location.client_id && pageClientIds.has(location.client_id));
  const activeConnection = (connectionsResult.data ?? []).find((connection) => connection.status === "active");

  return buildAgencyHome({
    clients: pageClients.map((client) => ({
      id: client.id,
      name: client.name,
      manager: managerName(client.account_manager_user_id),
      directConnection: directConnectionFor(client.id),
    })),
    locations: pageLocations.map(toLocationRef),
    stats: pageLocations.flatMap((location) => {
      const stat = statsByLocation.get(location.id);
      return stat
        ? [
            {
              ...stat,
              open_escalations: counts.escalations.get(location.id) ?? 0,
              client_approvals: counts.approvals.get(location.id) ?? 0,
            },
          ]
        : [];
    }),
    hasConnection: Boolean(activeConnection),
    connectionId: activeConnection?.id ?? null,
    rangeCounts: countsResult?.data ?? null,
    publishedCounts: [...counts.published.entries()]
      .filter(([locationId]) => matchedClientOfLocation.has(locationId))
      .map(([location_id, review_count]) => ({ location_id, review_count })),
    eventsByClient: [...counts.events.entries()].map(([client_id, count]) => ({ client_id, count })),
    rangeLabel: range.label,
    clientId: effectiveClientId,
    q: filters.q,
    page,
    pageSize: filters.allPages ? Math.max(totalClients, 1) : PAGE_SIZE,
    precomputed: {
      totalClients,
      kpis: {
        clients: totalClients,
        locations: kpiLocations,
        unreplied: kpiUnreplied,
        waitingApproval: kpiApprovals,
        openEscalations: kpiEscalations,
        connectionProblems,
      },
      hasReviews,
      hasPublished,
      approvals: kpiApprovals,
    },
  });
}
