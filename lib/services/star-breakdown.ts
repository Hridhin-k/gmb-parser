import { createAdminClient } from "@/lib/supabase/admin";
import { tallyStarReviews, type StarMaps } from "@/lib/star-breakdown";

const PAGE = 1000;
const CAP = 25000;
const CHUNK = 80;

interface ReviewRow {
  star_rating: number | null;
  review_create_time: string;
  location_id: string;
  complaint_theme: string | null;
}

/**
 * Count 1★–5★ for every chart slice in this window.
 * Returns null when the window is larger than the cap, so the charts do not show a partial mix.
 */
export async function loadStarBreakdown(input: {
  workspaceId: string;
  locationIds: string[];
  groupByLocation: Map<string, string | null>;
  start: string | null;
  end: string | null;
  timezone: string;
}): Promise<StarMaps | null> {
  if (input.locationIds.length === 0) return tallyStarReviews([], input.timezone);
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
