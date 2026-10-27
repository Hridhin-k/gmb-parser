import { createAdminClient } from "@/lib/supabase/admin";
import {
  tallyStarAggregates,
  tallyStarReviews,
  type StarAggregate,
  type StarMaps,
} from "@/lib/star-breakdown";

const CHUNK = 80;

export interface StarBreakdownInput {
  workspaceId: string;
  locationIds: string[];
  groupByLocation: Map<string, string | null>;
  start: string | null;
  end: string | null;
  timezone: string;
}

interface AggregateRow {
  month: string;
  location_id: string;
  star_rating: number | null;
  complaint_theme: string | null;
  review_count: number | string;
}

/**
 * Count 1★–5★ for every chart slice in this window.
 *
 * Counts are aggregated in Postgres (`grm_star_breakdown`): one result per
 * 80 locations instead of downloading review rows. The previous 25,000
 * review-count abort blanked charts for the workspace that already holds
 * 40,750 reviews, even though each chunk was a complete aggregate. A missing
 * RPC still fails loudly. There is no row-scan fallback.
 */
export async function loadStarBreakdown(input: StarBreakdownInput): Promise<StarMaps | null> {
  if (input.locationIds.length === 0) return tallyStarReviews([], input.timezone);
  const admin = createAdminClient();

  const chunks: string[][] = [];
  for (let offset = 0; offset < input.locationIds.length; offset += CHUNK) {
    chunks.push(input.locationIds.slice(offset, offset + CHUNK));
  }

  const results = await Promise.all(
    chunks.map((ids) =>
      admin.rpc("grm_star_breakdown", {
        p_workspace_id: input.workspaceId,
        p_location_ids: ids,
        p_start: input.start,
        p_end: input.end,
        p_timezone: input.timezone,
      })
    )
  );

  const aggregates: StarAggregate[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`Failed to load star counts: ${result.error.message}`);
    for (const row of (result.data ?? []) as AggregateRow[]) {
      const count = Number(row.review_count) || 0;
      aggregates.push({
        month: typeof row.month === "string" ? row.month.slice(0, 10) : "",
        locationId: row.location_id,
        groupId: input.groupByLocation.get(row.location_id) ?? null,
        stars: row.star_rating ?? 0,
        theme: row.complaint_theme,
        count,
      });
    }
  }
  return tallyStarAggregates(aggregates);
}
