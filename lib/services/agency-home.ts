import { createAdminClient } from "@/lib/supabase/admin";
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
  reviewCount: number;
  connection: AgencyConnection;
  attentionCount: number;
}

export interface AgencyUsageRow {
  id: string;
  name: string;
  locations: number;
  reviews: number;
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
}

interface LocationRef {
  id: string;
  clientId: string | null;
  isActive: boolean;
  title: string;
}

interface LocationStat {
  location_id: string;
  review_count: number;
  unanswered: number;
  approved: number;
  critical: number;
  rating_sum: number;
  published: number;
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
  rangeLabel: string;
  clientId: string;
  q: string;
  page: number;
  pageSize?: number;
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
    let inactive = 0;

    for (const location of locations) {
      if (!location.isActive) inactive += 1;
      const stat = statsByLocation.get(location.id);
      if (!stat) continue;
      reviewCount += stat.review_count;
      ratingSum += Number(stat.rating_sum);
      unreplied += stat.unanswered;
      escalations += stat.critical;
      approved += stat.approved;
    }

    const replied = reviewCount - unreplied;
    let connection: AgencyConnection = "connected";
    if (!input.hasConnection || locations.length === 0) connection = "waiting";
    else if (inactive > 0) connection = "attention";

    return {
      id: client.id,
      name: client.name,
      locations: locations.length,
      rating: reviewCount > 0 ? ratingSum / reviewCount : null,
      replyRate: reviewCount > 0 ? Math.round((replied / reviewCount) * 100) : null,
      unreplied,
      escalations,
      reviewCount,
      connection,
      attentionCount: inactive,
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

  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(input.page, 1), pageCount);
  const start = (page - 1) * pageSize;
  const approvals = matched.reduce((sum, row) => sum + row.approved, 0);

  const usage = matched
    .map((row) => {
      const locations = locationsByClient.get(row.id) ?? [];
      const reviews = locations.reduce((sum, location) => sum + rangeVolume(location.id), 0);
      return {
        id: row.id,
        name: row.name,
        locations: row.locations,
        reviews,
      };
    })
    .filter((row) => row.locations > 0 || row.reviews > 0);

  return {
    hasConnection: input.hasConnection,
    connectionId: input.connectionId ?? null,
    hasReviews: input.stats.some((stat) => stat.review_count > 0),
    hasPublished: input.stats.some((stat) => stat.published > 0),
    kpis: {
      clients: matched.length,
      locations: matched.reduce((sum, row) => sum + row.locations, 0),
      unreplied: matched.reduce((sum, row) => sum + row.unreplied, 0),
      waitingApproval: approvals,
      connectionProblems: matched.filter((row) => row.connection !== "connected").length,
    },
    rows: matched.slice(start, start + pageSize).map(({ approved: _approved, ...row }) => {
      void _approved;
      return row;
    }),
    totalClients: matched.length,
    page,
    pageSize,
    usage,
    usageHeading: usageHeading(input.rangeLabel),
    approvals,
  };
}

export async function listAgencyClients(
  workspaceId: string
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
    .map((client) => ({ id: client.id, name: client.name }));
}

export async function getAgencyHome(
  workspaceId: string,
  filters: {
    clientId: string;
    range: DateRange;
    q: string;
    page: number;
  }
): Promise<AgencyHome> {
  const admin = createAdminClient();

  const { range } = filters;
  const bounded = Boolean(range.start || range.end);

  const [clientsResult, locationsResult, connectionsResult, statsResult, countsResult] =
    await Promise.all([
      admin
        .from("grm_clients")
        .select("id, name, notes")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("name"),
      admin
        .from("grm_google_locations")
        .select("id, client_id, is_active, location_title")
        .eq("workspace_id", workspaceId),
      admin.from("grm_google_connections").select("id, status").eq("workspace_id", workspaceId),
      admin.rpc("grm_location_review_stats", { p_workspace_id: workspaceId }),
      bounded
        ? admin.rpc("grm_location_review_counts", {
            p_workspace_id: workspaceId,
            p_start: range.start?.toISOString() ?? null,
            p_end: range.end?.toISOString() ?? null,
          })
        : Promise.resolve(null),
    ]);

  if (clientsResult.error) throw new Error("Failed to load clients");
  if (locationsResult.error) throw new Error("Failed to load locations");
  if (connectionsResult.error) throw new Error("Failed to load Google connection");
  if (statsResult.error) throw new Error("Failed to load review stats");
  if (countsResult?.error) throw new Error("Failed to load review counts for this range");

  const clients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .map((client) => ({ id: client.id, name: client.name }));

  const knownClients = new Set(clients.map((client) => client.id));
  const activeConnection = (connectionsResult.data ?? []).find(
    (connection) => connection.status === "active"
  );

  return buildAgencyHome({
    clients,
    locations: (locationsResult.data ?? [])
      .filter((location) => location.client_id && knownClients.has(location.client_id))
      .map((location) => ({
        id: location.id,
        clientId: location.client_id,
        isActive: location.is_active,
        title: location.location_title,
      })),
    stats: statsResult.data ?? [],
    hasConnection: Boolean(activeConnection),
    connectionId: activeConnection?.id ?? null,
    rangeCounts: countsResult?.data ?? null,
    rangeLabel: range.label,
    clientId: filters.clientId,
    q: filters.q,
    page: filters.page,
  });
}
