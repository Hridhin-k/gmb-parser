import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 1000;
export const EXPORT_MAX_ROWS = 50_000;

export interface ReviewExportFilters {
  clientId: string | null;
  locationId: string | null;
  since: string | null;
  replyFilter: string;
  ratingBucket: "negative" | "positive" | null;
  rating: number | null;
}

const HEADER = [
  "Review date",
  "Client",
  "Location",
  "Reviewer",
  "Rating",
  "Review",
  "Reply status",
  "Reply on Google",
  "Reply date",
];

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

type ExportRow = {
  review_create_time: string;
  reviewer_display_name: string;
  reviewer_is_anonymous: boolean;
  star_rating: number;
  comment: string | null;
  reply_status: string;
  google_reply_comment: string | null;
  google_reply_update_time: string | null;
  grm_google_locations:
    | { location_title: string; grm_clients: { name: string } | { name: string }[] | null }
    | { location_title: string; grm_clients: { name: string } | { name: string }[] | null }[]
    | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Yields CSV lines (header first) for every review matching the filters. */
export async function* reviewCsvLines(
  workspaceId: string,
  filters: ReviewExportFilters
): AsyncGenerator<string> {
  const admin = createAdminClient();
  yield csvRow(HEADER);

  let locationIds: string[] | null = null;
  if (filters.locationId) {
    locationIds = [filters.locationId];
  } else if (filters.clientId) {
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("client_id", filters.clientId);
    if (error) throw new Error(`Failed to load locations: ${error.message}`);
    locationIds = (data ?? []).map((l) => l.id);
    if (locationIds.length === 0) return;
  }

  for (let from = 0; from < EXPORT_MAX_ROWS; from += PAGE_SIZE) {
    let query = admin
      .from("grm_reviews")
      .select(
        `review_create_time, reviewer_display_name, reviewer_is_anonymous, star_rating,
         comment, reply_status, google_reply_comment, google_reply_update_time,
         grm_google_locations!inner(location_title, grm_clients(name))`
      )
      .eq("workspace_id", workspaceId)
      .order("review_create_time", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (locationIds) query = query.in("location_id", locationIds);
    if (filters.since) query = query.gte("review_create_time", filters.since);
    if (filters.rating !== null) query = query.eq("star_rating", filters.rating);
    else if (filters.ratingBucket === "negative") query = query.lte("star_rating", 2);
    else if (filters.ratingBucket === "positive") query = query.gte("star_rating", 4);

    switch (filters.replyFilter) {
      case "unanswered":
        query = query.eq("reply_status", "none");
        break;
      case "answered":
        query = query.neq("reply_status", "none");
        break;
      case "draft":
      case "failed":
      case "published":
        query = query.eq("reply_status", filters.replyFilter);
        break;
      case "approved":
        query = query.in("reply_status", ["approved", "pending_publish"]);
        break;
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to export reviews: ${error.message}`);
    const rows = (data ?? []) as unknown as ExportRow[];

    for (const r of rows) {
      const location = one(r.grm_google_locations);
      const client = one(location?.grm_clients);
      yield csvRow([
        r.review_create_time,
        client?.name ?? "",
        location?.location_title ?? "",
        r.reviewer_is_anonymous ? "Anonymous" : r.reviewer_display_name,
        r.star_rating,
        r.comment ?? "",
        r.reply_status,
        r.google_reply_comment ?? "",
        r.google_reply_update_time ?? "",
      ]);
    }

    if (rows.length < PAGE_SIZE) return;
  }
}
