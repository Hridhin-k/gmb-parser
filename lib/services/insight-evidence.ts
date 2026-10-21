import { createAdminClient } from "@/lib/supabase/admin";
import { readableReviewText } from "@/lib/review-text";

export interface ComplaintSample {
  id: string;
  reviewer: string;
  stars: number;
  comment: string;
  when: string;
  locationId: string;
  locationName: string;
}

const CHUNK = 80;

/**
 * Recent 1–3 star reviews with a readable comment, inside the selected window.
 * These are stored reviews, not a model summary.
 */
export async function loadComplaintSamples(
  workspaceId: string,
  locationIds: string[],
  start: string | null,
  end: string | null,
  names: Map<string, string>
): Promise<ComplaintSample[]> {
  if (!locationIds.length) return [];
  const admin = createAdminClient();
  const chunks: string[][] = [];
  for (let index = 0; index < locationIds.length; index += CHUNK) {
    chunks.push(locationIds.slice(index, index + CHUNK));
  }
  const batches = await Promise.all(
    chunks.map(async (chunk) => {
      let query = admin
        .from("grm_reviews")
        .select("id, reviewer_display_name, star_rating, comment, review_create_time, location_id")
        .eq("workspace_id", workspaceId)
        .in("location_id", chunk)
        .lte("star_rating", 3)
        .order("review_create_time", { ascending: false })
        .limit(8);
      if (start) query = query.gte("review_create_time", start);
      if (end) query = query.lt("review_create_time", end);
      const { data, error } = await query;
      if (error) throw new Error("Could not load supporting reviews");
      return data ?? [];
    })
  );
  const collected: ComplaintSample[] = [];
  for (const rows of batches) {
    for (const row of rows) {
      const comment = readableReviewText(row.comment);
      if (!comment || !row.location_id) continue;
      collected.push({
        id: row.id,
        reviewer: row.reviewer_display_name?.trim() || "Customer",
        stars: row.star_rating ?? 0,
        comment,
        when: row.review_create_time ?? "",
        locationId: row.location_id,
        locationName: names.get(row.location_id) ?? "Location",
      });
    }
  }

  collected.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  return collected.slice(0, 5);
}
