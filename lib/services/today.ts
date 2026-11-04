import { createAdminClient } from "@/lib/db/client";
import type { DateRange } from "@/lib/date-range";
import { remember } from "@/lib/ttl-cache";
import { getPool } from "@/lib/db/pool";
import { buildDays, rangeDays, type TodayDay } from "@/lib/today";

const CHUNK = 150;

/** Group in Postgres so All time does not download every historical review. */
export async function loadTodayDays(workspaceId: string, locationIds: string[], range: DateRange, now: Date, timeZone: string): Promise<TodayDay[]> {
  if (locationIds.length === 0) return [];
  const { rows } = await getPool().query<TodayDay>(`SELECT to_char(review_create_time AT TIME ZONE $5,'YYYY-MM-DD') AS "day",
    count(*)::integer reviews,sum(star_rating)::integer "ratingSum",count(*) FILTER(WHERE star_rating<=2)::integer low,
    count(*) FILTER(WHERE google_reply_comment IS NOT NULL OR reply_status='published')::integer replied,
    coalesce(sum(extract(epoch FROM google_reply_update_time-review_create_time)/3600)
      FILTER(WHERE google_reply_update_time>=review_create_time),0)::float8 "responseHoursSum",
    count(*) FILTER(WHERE google_reply_update_time>=review_create_time)::integer "responseCount"
    FROM grm_reviews WHERE workspace_id=$1 AND location_id=ANY($2::uuid[]) AND missing_on_google_at IS NULL
      AND ($3::timestamptz IS NULL OR review_create_time>=$3) AND review_create_time<$4
    GROUP BY 1 ORDER BY 1`, [workspaceId, locationIds, range.start?.toISOString() ?? null, range.end?.toISOString() ?? now.toISOString(), timeZone]);
  const days = buildDays([], { days: rangeDays(range, now, rows[0]?.day, timeZone), now: range.end ? new Date(Math.min(now.getTime(), range.end.getTime() - 1)) : now, timeZone });
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return days.map((day) => byDay.get(day.day) ?? day);
}

function scopeKey(ids: string[]): string {
  return [...ids].sort().join(",");
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
