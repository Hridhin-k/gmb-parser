import { parseDateRange, type DateRangeKey } from "@/lib/date-range";
import { getPool } from "@/lib/db/pool";

/** Calendar-day filters use the business clock, including review drill-downs. */
export async function workspaceDateRange(
  workspaceId: string,
  params: { range?: unknown; from?: unknown; to?: unknown },
  fallback: DateRangeKey,
  now = new Date(),
  locationId: string | null = null
) {
  const range = parseDateRange(params, fallback, now);
  if (range.key !== "today") return range;
  const { rows: [row] } = await getPool().query<{ timezone: string }>(`SELECT COALESCE(
    (SELECT grm_review_timezone($1,id) FROM grm_google_locations WHERE workspace_id=$1 AND id=$2),
    (SELECT n.name FROM grm_escalation_policies p JOIN pg_timezone_names n ON n.name=p.timezone WHERE p.workspace_id=$1),
    'Asia/Kolkata') timezone`, [workspaceId, locationId]);
  return parseDateRange(params, fallback, now, row.timezone);
}
