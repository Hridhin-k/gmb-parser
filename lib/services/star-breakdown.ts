import { createAdminClient } from "@/lib/supabase/admin";
import {
  tallyStarAggregates,
  tallyStarReviews,
  type StarAggregate,
  type StarMaps,
} from "@/lib/star-breakdown";

const PAGE = 1000;
const CAP = 25000;
const CHUNK = 80;

interface ReviewRow {
  star_rating: number | null;
  review_create_time: string;
  location_id: string;
  complaint_theme: string | null;
}

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

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "PGRST202" || error.code === "42883" || message.includes("grm_star_breakdown");
}

/**
 * Count 1★–5★ for every chart slice in this window.
 * Returns null when the window is larger than the cap, so the charts do not show a partial mix.
 *
 * Counts are aggregated in Postgres (`grm_star_breakdown`): one small result
 * per 80 locations instead of downloading up to 25k review rows page by page.
 * Until that migration is applied, it falls back to the original row scan so
 * the dashboard keeps working — just slower.
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

  if (results.some((result) => isMissingFunction(result.error))) {
    return loadStarBreakdownFromRows(input);
  }

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

/** Pre-migration fallback: the original paged row scan. Kept until `grm_star_breakdown` exists. */
async function loadStarBreakdownFromRows(input: StarBreakdownInput): Promise<StarMaps | null> {
  const admin = createAdminClient();
  const rows: ReviewRow[] = [];
  for (let offset = 0; offset < input.locationIds.length; offset += CHUNK) {
    const ids = input.locationIds.slice(offset, offset + CHUNK);
    let from = 0;
    while (rows.length < CAP) {
      let query = admin
        .from("grm_reviews")
        .select("star_rating, review_create_time, location_id, complaint_theme")
        .eq("workspace_id", input.workspaceId)
        .is("missing_on_google_at", null)
        .in("location_id", ids)
        .order("review_create_time", { ascending: true })
        .range(from, from + PAGE - 1);
      if (input.start) query = query.gte("review_create_time", input.start);
      if (input.end) query = query.lt("review_create_time", input.end);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to load star counts: ${error.message}`);
      const page = data ?? [];
      rows.push(...page);
      if (rows.length >= CAP) return null;
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }
  return tallyStarReviews(
    rows.map((row) => ({
      stars: row.star_rating ?? 0,
      createdAt: row.review_create_time,
      locationId: row.location_id,
      groupId: input.groupByLocation.get(row.location_id) ?? null,
      theme: row.complaint_theme,
    })),
    input.timezone
  );
}
