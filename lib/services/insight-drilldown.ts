import { createAdminClient } from "@/lib/db/client";
import { ANALYSIS_VERSION } from "@/lib/review-intelligence";

export interface ThemeEvidence {
  reviewId: string;
  locationId: string;
  starRating: number;
  createdAt: string;
  excerpt: string;
  severity: number | null;
}

/**
 * The quotes behind one theme in a scope and period: what the count on the
 * insights page is made of. Most severe first, then newest.
 */
export async function loadThemeEvidence(
  workspaceId: string,
  input: {
    locationIds: string[];
    start: string | null;
    end: string | null;
    topic: string;
    sentiment: "positive" | "negative";
    limit?: number;
  }
): Promise<ThemeEvidence[]> {
  const admin = createAdminClient();
  const limit = input.limit ?? 30;
  const out: ThemeEvidence[] = [];
  for (let i = 0; i < input.locationIds.length; i += 80) {
    let query = admin
      .from("grm_review_observations")
      .select("review_id, location_id, star_rating, review_create_time, evidence_excerpt, severity, grm_review_analyses!inner(status)")
      .eq("workspace_id", workspaceId)
      .in("location_id", input.locationIds.slice(i, i + 80))
      .eq("topic", input.topic)
      .eq("sentiment", input.sentiment)
      .eq("grm_review_analyses.status", "ready")
      .eq("grm_review_analyses.analysis_version", ANALYSIS_VERSION)
      .order("severity", { ascending: false, nullsFirst: false })
      .order("review_create_time", { ascending: false })
      .limit(limit);
    if (input.start) query = query.gte("review_create_time", input.start);
    if (input.end) query = query.lt("review_create_time", input.end);
    const { data } = await query;
    for (const row of data ?? []) {
      out.push({
        reviewId: row.review_id as string,
        locationId: row.location_id as string,
        starRating: row.star_rating as number,
        createdAt: row.review_create_time as string,
        excerpt: row.evidence_excerpt as string,
        severity: (row.severity as number | null) ?? null,
      });
    }
  }
  return out
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
