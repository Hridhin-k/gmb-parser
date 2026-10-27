import { createAdminClient } from "@/lib/db/client";
import {
  tallyStarAggregates,
  tallyStarReviews,
  type StarAggregate,
  type StarMaps,
} from "@/lib/star-breakdown";

const CAP = 25000;
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
 * Returns null when the window is larger than the cap, so the charts do not show a partial mix.
 *
 * Counts are aggregated in Postgres (`grm_star_breakdown`, applied in
 * production): one small result per 80 locations instead of downloading up
 * to 25k review rows page by page. There is deliberately no row-scan
 * fallback: a missing RPC must fail loudly, not reintroduce the download.
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

  let total = 0;
  const aggregates: StarAggregate[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`Failed to load star counts: ${result.error.message}`);
    for (const row of (result.data ?? []) as AggregateRow[]) {
      const count = Number(row.review_count) || 0;
      total += count;
      if (total >= CAP) return null;
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
