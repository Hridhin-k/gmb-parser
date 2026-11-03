import { createAdminClient } from "@/lib/db/client";
import type { DateRange } from "@/lib/date-range";
import type { TodayReviewRow } from "@/lib/today";
import { remember } from "@/lib/ttl-cache";

const CHUNK = 150;
const PAGE = 1000;

function scopeKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Star, reply and reply time for each review in the window, for the per-day
 * bars and sparklines. Today windows are at most 90 days, so this stays small.
 * "Replied" matches `grm_review_trends`: a Google reply or a published reply.
 */
export async function loadTodayReviews(
  workspaceId: string,
  locationIds: string[],
  range: DateRange
): Promise<TodayReviewRow[]> {
  if (locationIds.length === 0 || !range.start) return [];
  const start = range.start.toISOString();
  const end = range.end?.toISOString() ?? null;
  const key = `today:reviews:${workspaceId}:${start.slice(0, 13)}:${end ?? ""}:${scopeKey(locationIds)}`;
  return remember(key, 45_000, async () => {
    const admin = createAdminClient();
    const rows: TodayReviewRow[] = [];
    for (let index = 0; index < locationIds.length; index += CHUNK) {
      const chunk = locationIds.slice(index, index + CHUNK);
      for (let from = 0; ; from += PAGE) {
        let query = admin
          .from("grm_reviews")
          .select("id, review_create_time, star_rating, reply_status, google_reply_comment, google_reply_update_time")
          .eq("workspace_id", workspaceId)
          .in("location_id", chunk)
          .is("missing_on_google_at", null)
          .gte("review_create_time", start)
          .order("review_create_time", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (end) query = query.lt("review_create_time", end);
        const { data, error } = await query;
        if (error) throw new Error(`Failed to load Today reviews: ${error.message}`);
        const page = data ?? [];
        for (const row of page) {
          const created = Date.parse(row.review_create_time);
          const replyAt = row.google_reply_update_time ? Date.parse(row.google_reply_update_time) : Number.NaN;
          rows.push({
            createdAt: row.review_create_time,
            stars: Number(row.star_rating),
            replied: row.google_reply_comment !== null || row.reply_status === "published",
            responseHours:
              Number.isFinite(replyAt) && Number.isFinite(created) && replyAt >= created
                ? (replyAt - created) / 3_600_000
                : null,
          });
        }
        if (page.length < PAGE) break;
      }
    }
    return rows;
  });
}

export interface NeedsYouExtras {
  /** 1–2 star reviews with no reply, any date. */
  unhappyUnreplied: number;
  oldestUnhappyAt: string | null;
  overdueFollowUps: number;
  nextFollowUpDue: string | null;
}

const EMPTY_EXTRAS: NeedsYouExtras = {
  unhappyUnreplied: 0,
  oldestUnhappyAt: null,
  overdueFollowUps: 0,
  nextFollowUpDue: null,
};

/**
 * The parts of the "Needs you" strip the shell summary does not count:
 * unhappy reviews without a reply, and when open follow-ups fall due.
 * Follow-ups use the same "not resolved" rule as the shell summary.
 */
export async function loadNeedsYouExtras(
  workspaceId: string,
  locationIds: string[],
  now: Date = new Date()
): Promise<NeedsYouExtras> {
  if (locationIds.length === 0) return EMPTY_EXTRAS;
  const key = `today:needs:${workspaceId}:${scopeKey(locationIds)}`;
  return remember(key, 30_000, async () => {
    const admin = createAdminClient();
    const nowIso = now.toISOString();
    const parts = await Promise.all(
      Array.from({ length: Math.ceil(locationIds.length / CHUNK) }, (_, index) => {
        const chunk = locationIds.slice(index * CHUNK, index * CHUNK + CHUNK);
        const unhappy = () =>
          admin
            .from("grm_reviews")
            .select("review_create_time", { count: "exact" })
            .eq("workspace_id", workspaceId)
            .in("location_id", chunk)
            .is("missing_on_google_at", null)
            .eq("reply_status", "none")
            .lte("star_rating", 2);
        const open = () =>
          admin
            .from("grm_escalations")
            .select("due_at", { count: "exact" })
            .eq("workspace_id", workspaceId)
            .in("location_id", chunk)
            .neq("status", "resolved");
        return Promise.all([
          unhappy().order("review_create_time", { ascending: true }).limit(1),
          open().lt("due_at", nowIso).limit(1),
          open().gte("due_at", nowIso).order("due_at", { ascending: true }).limit(1),
        ]);
      })
    );
    let result = { ...EMPTY_EXTRAS };
    for (const [unhappy, overdue, next] of parts) {
      for (const response of [unhappy, overdue, next]) {
        if (response.error) throw new Error(`Failed to load Today counts: ${response.error.message}`);
      }
      const oldest = unhappy.data?.[0]?.review_create_time ?? null;
      const due = next.data?.[0]?.due_at ?? null;
      result = {
        unhappyUnreplied: result.unhappyUnreplied + (unhappy.count ?? 0),
        oldestUnhappyAt:
          oldest && (!result.oldestUnhappyAt || oldest < result.oldestUnhappyAt) ? oldest : result.oldestUnhappyAt,
        overdueFollowUps: result.overdueFollowUps + (overdue.count ?? 0),
        nextFollowUpDue: due && (!result.nextFollowUpDue || due < result.nextFollowUpDue) ? due : result.nextFollowUpDue,
      };
    }
    return result;
  });
}
