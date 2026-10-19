import { createAdminClient } from "@/lib/supabase/admin";
import { rpcLocationReviewStats } from "@/lib/supabase/rpc";
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

  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(input.page, 1), pageCount);
  const start = (page - 1) * pageSize;
  const approvals = matched.reduce((sum, row) => sum + row.approved, 0);

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
    hasReviews: input.stats.some((stat) => stat.review_count > 0),
    hasPublished: input.stats.some((stat) => stat.published > 0),
    kpis: {
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
    totalClients: matched.length,
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

export async function getAgencyHome(
  workspaceId: string,
  filters: {
    clientId: string;
    range: DateRange;
    q: string;
    page: number;
    allowedClientIds?: string[] | null;
    locationIds?: string[] | null;
  }
): Promise<AgencyHome> {
  const admin = createAdminClient();

  const { range } = filters;
  const bounded = Boolean(range.start || range.end);

  let publishedQuery = admin
    .from("grm_review_replies")
    .select("review_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "published");
  let eventQuery = admin.from("grm_usage_events").select("client_id").eq("workspace_id", workspaceId);
  if (range.start) {
    publishedQuery = publishedQuery.gte("published_at", range.start.toISOString());
    eventQuery = eventQuery.gte("occurred_at", range.start.toISOString());
  }
  if (range.end) {
    publishedQuery = publishedQuery.lt("published_at", range.end.toISOString());
    eventQuery = eventQuery.lt("occurred_at", range.end.toISOString());
  }

  const [
    clientsResult,
    locationsResult,
    connectionsResult,
    accountsResult,
    escalationsResult,
    approvalsResult,
    eventsResult,
    publishedResult,
    reviewsResult,
    statsResult,
    countsResult,
  ] = await Promise.all([
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
    admin.from("grm_escalations").select("location_id").eq("workspace_id", workspaceId).is("resolved_at", null),
    admin.from("grm_review_replies").select("review_id").eq("workspace_id", workspaceId).eq("client_approval", "requested"),
    eventQuery,
    publishedQuery,
    admin.from("grm_reviews").select("id, location_id").eq("workspace_id", workspaceId),
    rpcLocationReviewStats(admin, workspaceId),
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
  if (accountsResult.error || escalationsResult.error || approvalsResult.error || eventsResult.error || publishedResult.error || reviewsResult.error) {
    throw new Error("Failed to load client activity");
  }
  if (statsResult.error) throw new Error("Failed to load review stats");
  if (countsResult?.error) throw new Error("Failed to load review counts for this range");

  const allowed = filters.allowedClientIds ?? null;
  const managerIds = [...new Set((clientsResult.data ?? []).flatMap((client) => client.account_manager_user_id ? [client.account_manager_user_id] : []))];
  const managerNames = new Map<string, string>();
  await Promise.all(managerIds.map(async (userId) => {
    const { data } = await admin.auth.admin.getUserById(userId);
    if (data.user?.email) managerNames.set(userId, data.user.email);
  }));

  const clients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .filter((client) => allowed === null || allowed.includes(client.id))
    .map((client) => {
      const direct = (connectionsResult.data ?? []).filter((connection) => connection.client_id === client.id);
      const directConnection = direct.length === 0
        ? null
        : direct.every((connection) => connection.status === "active")
          ? "active"
          : "problem";
      return {
        id: client.id,
        name: client.name,
        manager: client.account_manager_user_id ? managerNames.get(client.account_manager_user_id) ?? "Account manager" : null,
        directConnection,
      } as const;
    });

  const knownClients = new Set(clients.map((client) => client.id));
  const connectionByAccount = new Map((accountsResult.data ?? []).map((account) => [account.id, account.connection_id]));
  const connectionStatus = new Map((connectionsResult.data ?? []).map((connection) => [connection.id, connection.status]));
  const reviewLocation = new Map((reviewsResult.data ?? []).map((review) => [review.id, review.location_id]));
  const countByLocation = (ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const locationId = reviewLocation.get(id);
      if (!locationId) continue;
      counts.set(locationId, (counts.get(locationId) ?? 0) + 1);
    }
    return counts;
  };
  const escalationsByLocation = new Map<string, number>();
  for (const row of escalationsResult.data ?? []) {
    escalationsByLocation.set(row.location_id, (escalationsByLocation.get(row.location_id) ?? 0) + 1);
  }
  const approvalsByLocation = countByLocation((approvalsResult.data ?? []).map((row) => row.review_id));
  const publishedByLocation = countByLocation((publishedResult.data ?? []).map((row) => row.review_id));
  const eventsByClient = new Map<string, number>();
  for (const row of eventsResult.data ?? []) {
    if (!row.client_id) continue;
    eventsByClient.set(row.client_id, (eventsByClient.get(row.client_id) ?? 0) + 1);
  }
  const activeConnection = (connectionsResult.data ?? []).find((connection) => connection.status === "active");

  return buildAgencyHome({
    clients,
    locations: (locationsResult.data ?? [])
      .filter((location) => location.client_id && knownClients.has(location.client_id))
      .filter((location) => filters.locationIds == null || filters.locationIds.includes(location.id))
      .map((location) => {
        const connectionId = connectionByAccount.get(location.google_account_id);
        const status = connectionId ? connectionStatus.get(connectionId) : null;
        return {
          id: location.id,
          clientId: location.client_id,
          title: location.location_title,
          connection: !status ? "missing" : status === "active" ? "active" : "problem",
        } as const;
      }),
    stats: (statsResult.data ?? []).map((stat) => ({
      ...stat,
      open_escalations: escalationsByLocation.get(stat.location_id) ?? 0,
      client_approvals: approvalsByLocation.get(stat.location_id) ?? 0,
    })),
    hasConnection: Boolean(activeConnection),
    connectionId: activeConnection?.id ?? null,
    rangeCounts: countsResult?.data ?? null,
    publishedCounts: [...publishedByLocation.entries()].map(([location_id, review_count]) => ({ location_id, review_count })),
    eventsByClient: [...eventsByClient.entries()].map(([client_id, count]) => ({ client_id, count })),
    rangeLabel: range.label,
    clientId: filters.allowedClientIds && filters.clientId && !filters.allowedClientIds.includes(filters.clientId) ? "00000000-0000-0000-0000-000000000000" : filters.clientId,
    q: filters.q,
    page: filters.page,
  });
}
