import { createAdminClient } from "@/lib/supabase/admin";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";

export const TREND_PERIODS = [3, 6, 12] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];

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
  previous: TrendSummary;
  clients: Array<{ id: string; name: string }>;
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

/**
 * Monthly review trends for the last `period` months, plus the same-length
 * period before it for comparison. One RPC call covers both windows.
 */
export async function getAnalyticsData(
  workspaceId: string,
  period: TrendPeriod,
  clientId: string | null
): Promise<AnalyticsData> {
  const admin = createAdminClient();

  const [trends, clientsResult] = await Promise.all([
    admin.rpc("grm_review_trends", {
      p_workspace_id: workspaceId,
      p_months: period * 2,
      p_client_id: clientId,
    }),
    admin
      .from("grm_clients")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
      .order("name"),
  ]);

  if (trends.error) {
    throw new Error(`Failed to load review trends: ${trends.error.message}`);
  }
  if (clientsResult.error) {
    throw new Error(`Failed to load clients: ${clientsResult.error.message}`);
  }

  const all: TrendMonth[] = (trends.data ?? []).map((row) => ({
    month: row.month,
    reviewCount: row.review_count,
    avgRating: row.avg_rating === null ? null : Number(row.avg_rating),
    negative: row.negative,
    positive: row.positive,
    neutral: Math.max(0, row.review_count - row.negative - row.positive),
    replied: row.replied,
    avgResponseHours: row.avg_response_hours === null ? null : Number(row.avg_response_hours),
  }));

  const months = all.slice(-period);
  const previousMonths = all.slice(0, Math.max(0, all.length - period));

  return {
    months,
    current: summarize(months),
    previous: summarize(previousMonths),
    clients: clientsResult.data ?? [],
  };
}
