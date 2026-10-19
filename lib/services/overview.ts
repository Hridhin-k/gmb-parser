import { createAdminClient } from "@/lib/supabase/admin";
import { rpcLocationReviewStats } from "@/lib/supabase/rpc";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { locationDisplayName } from "@/lib/ui/location-place";
import { previousDateRange, type DateRange } from "@/lib/date-range";

/** One month from `grm_review_trends`. `negative` is 1–2★; `positive` is 4–5★. */
export interface OverviewTrendMonth {
  month: string;
  reviewCount: number;
  avgRating: number | null;
  negative: number;
  positive: number;
  replied: number;
}

export interface OverviewLocationStat {
  locationId: string;
  reviewCount: number;
  unanswered: number;
  drafts: number;
  /** Reviews rated 1 or 2 stars. */
  critical: number;
  ratingSum: number;
}

export interface OverviewLocationRef {
  id: string;
  clientId: string | null;
  clientName: string | null;
  name: string;
  isActive: boolean;
}

export interface OverviewInsightSnippet {
  locationId: string;
  highlights: string[];
  risks: string[];
}

export interface OverviewWindow {
  reviewCount: number;
  avgRating: number | null;
  /** Share of reviews rated 1–3★. */
  negativeShare: number | null;
  replyRate: number | null;
  unreplied: number;
}

export interface OverviewAttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface OverviewLowestLocation {
  id: string;
  name: string;
  clientName: string | null;
  rating: number;
  reviews: number;
  unreplied: number;
  critical: number;
  href: string;
}

export interface OverviewTheme {
  label: string;
  count: number;
}

export interface OverviewChartMonth {
  month: string;
  reviewCount: number;
  positive: number;
  oneToThree: number;
  avgRating: number | null;
}

export interface ClientOverview {
  clients: Array<{ id: string; name: string }>;
  current: OverviewWindow;
  previous: OverviewWindow | null;
  months: OverviewChartMonth[];
  attention: OverviewAttentionItem[];
  lowest: OverviewLowestLocation[];
  praised: OverviewTheme[];
  complained: OverviewTheme[];
}

export interface OverviewAssemblyInput {
  clientId: string | null;
  expiredConnections: number;
  months: OverviewTrendMonth[];
  previousMonths: OverviewTrendMonth[] | null;
  stats: OverviewLocationStat[];
  locations: OverviewLocationRef[];
  insights: OverviewInsightSnippet[];
  clients: Array<{ id: string; name: string }>;
}

/** 3★ reviews are whatever is left after 1–2★ and 4–5★. */
export function oneToThreeCount(month: {
  reviewCount: number;
  negative: number;
  positive: number;
}): number {
  const neutral = Math.max(0, month.reviewCount - month.negative - month.positive);
  return Math.min(month.reviewCount, month.negative + neutral);
}

export function summarizeOverviewWindow(months: OverviewTrendMonth[]): OverviewWindow {
  let reviews = 0;
  let ratingSum = 0;
  let replied = 0;
  let oneToThree = 0;

  for (const month of months) {
    reviews += month.reviewCount;
    ratingSum += (month.avgRating ?? 0) * month.reviewCount;
    replied += month.replied;
    oneToThree += oneToThreeCount(month);
  }

  return {
    reviewCount: reviews,
    avgRating: reviews > 0 ? ratingSum / reviews : null,
    negativeShare: reviews > 0 ? oneToThree / reviews : null,
    replyRate: reviews > 0 ? replied / reviews : null,
    unreplied: Math.max(0, reviews - replied),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function themeCounts(values: string[], limit = 5): OverviewTheme[] {
  const grouped = new Map<string, OverviewTheme>();
  for (const value of values) {
    const label = value.trim();
    const key = label.toLowerCase();
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { label, count: 1 });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

function queueHref(path: string, clientId: string | null, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (clientId) params.set("client", clientId);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Assemble the Overview screen from data the app already stores.
 * Period KPIs follow the selected dates. The queue and location ratings
 * follow every review on file, because that is what the existing aggregates store.
 */
export function buildClientOverview(input: OverviewAssemblyInput): ClientOverview {
  const scopedLocations = input.locations.filter(
    (location) => !input.clientId || location.clientId === input.clientId
  );
  const scopedIds = new Set(scopedLocations.map((location) => location.id));
  const statsByLocation = new Map(
    input.stats
      .filter((stat) => scopedIds.has(stat.locationId))
      .map((stat) => [stat.locationId, stat])
  );

  let drafts = 0;
  let unanswered = 0;
  let inactive = 0;
  for (const location of scopedLocations) {
    if (!location.isActive) inactive += 1;
    const stat = statsByLocation.get(location.id);
    if (!stat) continue;
    drafts += stat.drafts;
    unanswered += stat.unanswered;
  }

  const attention: OverviewAttentionItem[] = [];
  if (unanswered > 0) {
    attention.push({
      id: "unanswered",
      title: `${unanswered.toLocaleString("en-US")} reviews with no reply`,
      detail: "Current queue, across every stored review",
      href: queueHref("/reviews", input.clientId, { filter: "unanswered" }),
    });
  }
  if (drafts > 0) {
    attention.push({
      id: "drafts",
      title: `${drafts.toLocaleString("en-US")} drafts ready to approve`,
      detail: "Current queue, across every stored review",
      href: queueHref("/reviews", input.clientId, { filter: "draft" }),
    });
  }
  if (input.expiredConnections > 0) {
    attention.push({
      id: "connections",
      title: `${input.expiredConnections.toLocaleString("en-US")} Google ${input.expiredConnections === 1 ? "connection" : "connections"} expired`,
      detail: "Reconnect so review sync can continue",
      href: "/settings",
    });
  }
  if (inactive > 0) {
    attention.push({
      id: "inactive",
      title: `${inactive.toLocaleString("en-US")} ${inactive === 1 ? "location is" : "locations are"} paused`,
      detail: "Inactive locations stay imported and stop receiving new reviews",
      href: input.clientId ? `/clients/${input.clientId}` : "/clients",
    });
  }

  const lowest: OverviewLowestLocation[] = scopedLocations
    .flatMap((location) => {
      const stat = statsByLocation.get(location.id);
      if (!stat || stat.reviewCount <= 0) return [];
      return [
        {
          id: location.id,
          name: location.name,
          clientName: location.clientName,
          rating: stat.ratingSum / stat.reviewCount,
          reviews: stat.reviewCount,
          unreplied: stat.unanswered,
          critical: stat.critical,
          href: queueHref("/reviews", location.clientId, { location: location.id }),
        },
      ];
    })
    .sort((a, b) => a.rating - b.rating || b.reviews - a.reviews || a.name.localeCompare(b.name))
    .slice(0, 5);

  const praised: string[] = [];
  const complained: string[] = [];
  for (const insight of input.insights) {
    if (!scopedIds.has(insight.locationId)) continue;
    praised.push(...insight.highlights);
    complained.push(...insight.risks);
  }

  return {
    clients: input.clients,
    current: summarizeOverviewWindow(input.months),
    previous: input.previousMonths ? summarizeOverviewWindow(input.previousMonths) : null,
    months: input.months.map((month) => ({
      month: month.month,
      reviewCount: month.reviewCount,
      positive: month.positive,
      oneToThree: oneToThreeCount(month),
      avgRating: month.avgRating,
    })),
    attention,
    lowest,
    praised: themeCounts(praised),
    complained: themeCounts(complained),
  };
}

type TrendRow = {
  month: string;
  review_count: number;
  avg_rating: number | null;
  negative: number;
  positive: number;
  replied: number;
};

function toMonths(rows: TrendRow[] | null): OverviewTrendMonth[] {
  return (rows ?? []).map((row) => ({
    month: row.month,
    reviewCount: row.review_count,
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
    negative: row.negative,
    positive: row.positive,
    replied: row.replied,
  }));
}

/**
 * Overview for one workspace, optionally narrowed to one client.
 * Reads the existing trend and location aggregate functions. It does not
 * invent escalation, target, or digest records.
 */
export async function getClientOverview(
  workspaceId: string,
  clientId: string | null,
  range: DateRange
): Promise<ClientOverview> {
  const admin = createAdminClient();
  const scope = {
    p_workspace_id: workspaceId,
    p_client_id: clientId,
    p_location_id: null,
  };
  const previousWindow = previousDateRange(range);

  const [trends, previousTrends, statsResult, clientsResult, locationsResult, connectionsResult, insightsResult] =
    await Promise.all([
      admin.rpc("grm_review_trends", {
        ...scope,
        p_months: null,
        p_start: range.start?.toISOString() ?? null,
        p_end: range.end?.toISOString() ?? null,
      }),
      previousWindow
        ? admin.rpc("grm_review_trends", {
            ...scope,
            p_months: null,
            p_start: previousWindow.start.toISOString(),
            p_end: previousWindow.end.toISOString(),
          })
        : Promise.resolve(null),
      rpcLocationReviewStats(admin, workspaceId),
      admin
        .from("grm_clients")
        .select("id, name, notes")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
        .order("name"),
      admin
        .from("grm_google_locations")
        .select("id, client_id, location_title, store_code, address_formatted, is_active")
        .eq("workspace_id", workspaceId),
      admin
        .from("grm_google_connections")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "expired"),
      admin
        .from("grm_location_insights")
        .select("location_id, highlights, risks")
        .eq("workspace_id", workspaceId),
    ]);

  if (trends.error) throw new Error(`Failed to load review trends: ${trends.error.message}`);
  if (previousTrends?.error) {
    throw new Error(`Failed to load earlier review trends: ${previousTrends.error.message}`);
  }
  if (statsResult.error) throw new Error(`Failed to load location stats: ${statsResult.error.message}`);
  if (clientsResult.error) throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  if (locationsResult.error) throw new Error(`Failed to load locations: ${locationsResult.error.message}`);
  if (connectionsResult.error) {
    throw new Error(`Failed to load Google connections: ${connectionsResult.error.message}`);
  }
  if (insightsResult.error) throw new Error(`Failed to load location insights: ${insightsResult.error.message}`);

  const clients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .map((client) => ({ id: client.id, name: client.name }));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));

  const locations: OverviewLocationRef[] = (locationsResult.data ?? [])
    .filter((location) => location.client_id && clientNames.has(location.client_id))
    .map((location) => ({
      id: location.id,
      clientId: location.client_id,
      clientName: clientNames.get(location.client_id!) ?? null,
      name: locationDisplayName({
        title: location.location_title,
        brand: clientNames.get(location.client_id!),
        storeCode: location.store_code,
        address: location.address_formatted,
      }),
      isActive: location.is_active,
    }));

  const stats: OverviewLocationStat[] = (statsResult.data ?? []).map((row) => ({
    locationId: row.location_id,
    reviewCount: row.review_count,
    unanswered: row.unanswered,
    drafts: row.drafts,
    critical: row.critical,
    ratingSum: Number(row.rating_sum),
  }));

  return buildClientOverview({
    clientId,
    expiredConnections: connectionsResult.data?.length ?? 0,
    months: toMonths(trends.data),
    previousMonths: previousTrends ? toMonths(previousTrends.data) : null,
    stats,
    locations,
    insights: (insightsResult.data ?? []).map((row) => ({
      locationId: row.location_id,
      highlights: stringList(row.highlights),
      risks: stringList(row.risks),
    })),
    clients,
  });
}

export interface NewestReviewCard {
  id: string;
  reviewer: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  locationId: string;
}

/** Newest stored reviews for the locations already in scope. */
export async function listNewestReviews(
  workspaceId: string,
  locationIds: string[],
  range: { start: Date | null; end: Date | null },
  limit = 6
): Promise<NewestReviewCard[]> {
  if (locationIds.length === 0) return [];
  const admin = createAdminClient();
  let query = admin
    .from("grm_reviews")
    .select("id, star_rating, comment, reviewer_display_name, review_create_time, location_id")
    .eq("workspace_id", workspaceId)
    .in("location_id", locationIds);
  if (range.start) query = query.gte("review_create_time", range.start.toISOString());
  if (range.end) query = query.lt("review_create_time", range.end.toISOString());
  const { data, error } = await query.order("review_create_time", { ascending: false }).limit(limit);
  if (error) throw new Error(`Failed to load newest reviews: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    reviewer: row.reviewer_display_name,
    rating: row.star_rating,
    comment: row.comment,
    createdAt: row.review_create_time,
    locationId: row.location_id,
  }));
}
