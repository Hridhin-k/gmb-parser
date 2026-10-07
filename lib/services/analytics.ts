import { createAdminClient } from "@/lib/supabase/admin";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { locationDisplayName } from "@/lib/ui/location-place";
import { previousDateRange, type DateRange } from "@/lib/date-range";

export interface TrendMonth {
  month: string;
  reviewCount: number;
  avgRating: number | null;
  negative: number;
  neutral: number;
  positive: number;
  replied: number;
  avgResponseHours: number | null;
}

export interface TrendSummary {
  reviewCount: number;
  avgRating: number | null;
  replyRate: number | null;
  avgResponseHours: number | null;
  negativeShare: number | null;
}

export interface AnalyticsData {
  months: TrendMonth[];
  current: TrendSummary;
  /** null for all-time ranges, which have nothing before them to compare. */
  previous: TrendSummary | null;
  clients: Array<{ id: string; name: string }>;
  locations: AnalyticsLocation[];
}

export interface AnalyticsLocation {
  id: string;
  clientId: string;
  name: string;
}

function summarize(months: TrendMonth[]): TrendSummary {
  let reviews = 0;
  let ratingSum = 0;
  let replied = 0;
  let negative = 0;
  let responseWeighted = 0;
  let responseWeight = 0;

  for (const m of months) {
    reviews += m.reviewCount;
    ratingSum += (m.avgRating ?? 0) * m.reviewCount;
    replied += m.replied;
    negative += m.negative;
    if (m.avgResponseHours !== null && m.replied > 0) {
      responseWeighted += m.avgResponseHours * m.replied;
      responseWeight += m.replied;
    }
  }

  return {
    reviewCount: reviews,
    avgRating: reviews > 0 ? ratingSum / reviews : null,
    replyRate: reviews > 0 ? replied / reviews : null,
    avgResponseHours: responseWeight > 0 ? responseWeighted / responseWeight : null,
    negativeShare: reviews > 0 ? negative / reviews : null,
  };
}

type TrendRow = {
  month: string;
  review_count: number;
  avg_rating: number | null;
  negative: number;
  positive: number;
  replied: number;
  avg_response_hours: number | null;
};

function toMonths(rows: TrendRow[] | null): TrendMonth[] {
  return (rows ?? []).map((row) => ({
    month: row.month,
    reviewCount: row.review_count,
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
    negative: row.negative,
    positive: row.positive,
    neutral: Math.max(0, row.review_count - row.negative - row.positive),
    replied: row.replied,
    avgResponseHours: row.avg_response_hours === null ? null : Number(row.avg_response_hours),
  }));
}

/**
 * Monthly review trends for `range`, plus the same-length window just before
 * it for comparison (none for all time).
 */
export async function getAnalyticsData(
  workspaceId: string,
  range: DateRange,
  clientId: string | null,
  locationId: string | null = null
): Promise<AnalyticsData> {
  const admin = createAdminClient();
  const scope = {
    p_workspace_id: workspaceId,
    p_client_id: clientId,
    p_location_id: locationId,
  };
  const previousWindow = previousDateRange(range);

  const [trends, previousTrends, clientsResult, locationsResult] = await Promise.all([
    admin.rpc("grm_review_trends", {
      ...scope,
      p_months: null,
      p_start: range.start?.toISOString() ?? null,
      p_end: range.end?.toISOString() ?? null,
    }),
    previousWindow
      ? admin.rpc("grm_review_trends", {
          ...scope,
          p_start: previousWindow.start.toISOString(),
          p_end: previousWindow.end.toISOString(),
        })
      : Promise.resolve(null),
    admin
      .from("grm_clients")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
      .order("name"),
    admin
      .from("grm_google_locations")
      .select("id, client_id, location_title, store_code, address_formatted")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .not("client_id", "is", null),
  ]);

  if (trends.error) {
    throw new Error(`Failed to load review trends: ${trends.error.message}`);
  }
  if (previousTrends?.error) {
    throw new Error(`Failed to load earlier review trends: ${previousTrends.error.message}`);
  }
  if (clientsResult.error) {
    throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  }
  if (locationsResult.error) {
    throw new Error(`Failed to load locations: ${locationsResult.error.message}`);
  }

  const clients = clientsResult.data ?? [];
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const locations: AnalyticsLocation[] = (locationsResult.data ?? [])
    .filter((l) => l.client_id && clientNames.has(l.client_id))
    .map((l) => ({
      id: l.id,
      clientId: l.client_id!,
      name: locationDisplayName({
        title: l.location_title,
        brand: clientNames.get(l.client_id!),
        storeCode: l.store_code,
        address: l.address_formatted,
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const months = toMonths(trends.data);

  return {
    months,
    current: summarize(months),
    previous: previousTrends ? summarize(toMonths(previousTrends.data)) : null,
    clients,
    locations,
  };
}
