import { createAdminClient } from "@/lib/supabase/admin";
import { locationDisplayName } from "@/lib/ui/location-place";
import { statusOrFilter } from "@/lib/review-filter-params";

const PAGE_SIZE = 1000;
export const EXPORT_MAX_ROWS = 50_000;

export interface ReviewExportFilters {
  clientId: string | null;
  groupId?: string | null;
  locationId: string | null;
  since: string | null;
  until: string | null;
  replyFilter: string;
  /** Multiple selected statuses; wins over replyFilter when it has 2+. */
  replyFilters?: string[];
  ratingBucket: "negative" | "positive" | null;
  rating: number | null;
  /** Multiple selected star ratings; wins over rating/ratingBucket. */
  ratings?: number[];
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
  id: string;
  review_create_time: string;
  reviewer_display_name: string;
  reviewer_is_anonymous: boolean;
  star_rating: number;
  comment: string | null;
  reply_status: string;
  google_reply_comment: string | null;
  google_reply_update_time: string | null;
  grm_google_locations: ExportLocation | ExportLocation[] | null;
};

type ExportLocation = {
  location_title: string;
  address_formatted: string | null;
  grm_clients: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function exportLocationIds(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  filters: { clientId: string | null; groupId?: string | null; locationId?: string | null }
): Promise<string[] | null> {
  if (filters.locationId) return [filters.locationId];
  if (!filters.clientId && !filters.groupId) return null;
  let query = admin.from("grm_google_locations").select("id").eq("workspace_id", workspaceId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.groupId) {
    const { scopedGroupIds } = await import("@/lib/services/hierarchy");
    const ids = await scopedGroupIds(workspaceId, filters.groupId);
    query = query.in("group_id", ids);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load locations: ${error.message}`);
  return (data ?? []).map((location) => location.id);
}

/** How many reviews the CSV export would include for this client and period. */
export async function countExportableReviews(
  workspaceId: string,
  filters: Pick<ReviewExportFilters, "clientId" | "groupId" | "locationId" | "since" | "until">
): Promise<number> {
  const admin = createAdminClient();
  const locationIds = await exportLocationIds(admin, workspaceId, filters);
  if (locationIds && locationIds.length === 0) return 0;

  let query = admin
    .from("grm_reviews")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("missing_on_google_at", null);
  if (locationIds) query = query.in("location_id", locationIds);
  if (filters.since) query = query.gte("review_create_time", filters.since);
  if (filters.until) query = query.lt("review_create_time", filters.until);

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count reviews: ${error.message}`);
  return count ?? 0;
}

/** Yields CSV lines (header first) for every review matching the filters. */
export async function* reviewCsvLines(
  workspaceId: string,
  filters: ReviewExportFilters
): AsyncGenerator<string> {
  const admin = createAdminClient();
  yield csvRow(HEADER);

  const locationIds = await exportLocationIds(admin, workspaceId, filters);
  if (locationIds && locationIds.length === 0) return;

  // Keyset paging on (review_create_time desc, id asc): stable if reviews
  // are synced mid-export, and no offset cost on large scopes.
  let lastTime: string | null = null;
  let lastId: string | null = null;
  let exported = 0;
  for (;;) {
    if (exported >= EXPORT_MAX_ROWS) return;
    let query = admin
      .from("grm_reviews")
      .select(
        `id, review_create_time, reviewer_display_name, reviewer_is_anonymous, star_rating,
         comment, reply_status, google_reply_comment, google_reply_update_time,
         grm_google_locations!inner(location_title, address_formatted, grm_clients(name))`
      )
      .eq("workspace_id", workspaceId)
      .is("missing_on_google_at", null)
      .order("review_create_time", { ascending: false })
      .order("id", { ascending: true })
      .limit(Math.min(PAGE_SIZE, EXPORT_MAX_ROWS - exported));
    if (lastTime && lastId) {
      query = query.or(
        `review_create_time.lt."${lastTime}",and(review_create_time.eq."${lastTime}",id.gt."${lastId}")`
      );
    }

    if (locationIds) query = query.in("location_id", locationIds);
    if (filters.since) query = query.gte("review_create_time", filters.since);
    if (filters.until) query = query.lt("review_create_time", filters.until);
    if (filters.ratings?.length) query = query.in("star_rating", filters.ratings);
    else if (filters.rating !== null) query = query.eq("star_rating", filters.rating);
    else if (filters.ratingBucket === "negative") query = query.lte("star_rating", 2);
    else if (filters.ratingBucket === "positive") query = query.gte("star_rating", 4);

    const multiStatusOr =
      filters.replyFilters && filters.replyFilters.length > 1
        ? statusOrFilter(filters.replyFilters)
        : null;
    const singleStatus = filters.replyFilters?.[0] ?? filters.replyFilter;
    if (multiStatusOr) {
      query = query.or(multiStatusOr);
    } else
    switch (singleStatus) {
      case "unanswered":
        query = query.eq("reply_status", "none");
        break;
      case "answered":
        query = query.neq("reply_status", "none");
        break;
      case "draft":
      case "failed":
      case "published":
        query = query.eq("reply_status", singleStatus);
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
        location
          ? locationDisplayName({
              title: location.location_title,
              brand: client?.name,
              address: location.address_formatted,
            })
          : "",
        r.reviewer_is_anonymous ? "Anonymous" : r.reviewer_display_name,
        r.star_rating,
        r.comment ?? "",
        r.reply_status,
        r.google_reply_comment ?? "",
        r.google_reply_update_time ?? "",
      ]);
    }

    exported += rows.length;
    if (rows.length === 0) return;
    lastTime = rows[rows.length - 1].review_create_time;
    lastId = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) return;
  }
}
