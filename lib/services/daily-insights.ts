import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { ANALYSIS_VERSION, type ObservationRow } from "@/lib/review-intelligence";
import { buildDailySummary, combineDailySummaries, DAILY_SUMMARY_VERSION, dailySourceFingerprint, type DailyCoverage, type DailySource, type DailySummary } from "@/lib/daily-insights";

export interface SummaryScope { locationIds: string[]; start: string | null; end: string | null }
interface DayRow {
  workspace_id: string; location_id: string; day: string; timezone: string; revision: number;
  start: string; end: string; summary: DailySummary | null; source_revision: number | null;
}

async function readDay(db: PoolClient, workspaceId: string, locationId: string, start: string, end: string): Promise<DailySummary> {
  const { rows: [counts] } = await db.query<DailyCoverage>(`
    WITH reviews AS (
      SELECT r.*, a.status analysis_status FROM grm_reviews r
      LEFT JOIN grm_review_analyses a ON a.workspace_id=r.workspace_id AND a.review_id=r.id
        AND a.analysis_version=$5 AND (r.content_fingerprint IS NULL OR a.content_fingerprint=r.content_fingerprint)
      WHERE r.workspace_id=$1 AND r.location_id=$2 AND r.missing_on_google_at IS NULL
        AND r.review_create_time >= $3 AND r.review_create_time < $4
    ) SELECT count(*)::integer discovered,
      count(*) FILTER(WHERE btrim(coalesce(comment,''))<>'')::integer eligible,
      count(*) FILTER(WHERE btrim(coalesce(comment,''))<>'' AND analysis_status='ready')::integer analysed,
      count(*) FILTER(WHERE btrim(coalesce(comment,''))='')::integer "ratingOnly",
      count(*) FILTER(WHERE btrim(coalesce(comment,''))<>'' AND analysis_status='failed')::integer failed,
      count(*) FILTER(WHERE btrim(coalesce(comment,''))<>'' AND analysis_status IS DISTINCT FROM 'ready')::integer pending,
      coalesce(sum(star_rating),0)::integer "ratingSum",
      ARRAY[${[1, 2, 3, 4, 5].map((star) => `count(*) FILTER(WHERE star_rating=${star})::integer`).join(",")}] "starCounts"
    FROM reviews`, [workspaceId, locationId, start, end, ANALYSIS_VERSION]);
  const { rows } = await db.query<ObservationRow>(`
    SELECT o.review_id "reviewId",o.location_id "locationId",o.client_id "clientId",o.group_id "groupId",
      r.review_create_time "reviewCreateTime",r.star_rating "starRating",o.topic,o.subtopic,o.sentiment,o.detail,
      o.entity_type "entityType",o.entity_name "entityName",o.severity,o.severity_rationale "severityRationale",
      o.evidence_excerpt "evidenceExcerpt",o.evidence_start "evidenceStart",o.evidence_end "evidenceEnd",
      o.basis,o.confidence,o.is_ambiguous "isAmbiguous",o.dedupe_key "dedupeKey"
    FROM grm_review_observations o
    JOIN grm_review_analyses a ON a.workspace_id=o.workspace_id AND a.id=o.analysis_id
    JOIN grm_reviews r ON r.workspace_id=o.workspace_id AND r.id=o.review_id
    WHERE r.workspace_id=$1 AND r.location_id=$2 AND r.missing_on_google_at IS NULL
      AND r.review_create_time >= $3 AND r.review_create_time < $4
      AND a.status='ready' AND a.analysis_version=$5
      AND (r.content_fingerprint IS NULL OR a.content_fingerprint=r.content_fingerprint)
    ORDER BY r.review_create_time,o.id`, [workspaceId, locationId, start, end, ANALYSIS_VERSION]);
  const summary = buildDailySummary(rows, counts);
  summary.aggregates.outletReviews[locationId] = counts.analysed;
  return summary;
}

/** A repeatable-read snapshot and its revision are saved together. Concurrent
 * edits advance the revision and will be picked up by the next refresh. */
async function rebuildDay(day: DayRow): Promise<DailySummary> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const { rows: [source] } = await db.query<{ revision: number }>(`SELECT revision FROM grm_insight_days
      WHERE workspace_id=$1 AND location_id=$2 AND day=$3 AND timezone=$4`, [day.workspace_id, day.location_id, day.day, day.timezone]);
    const summary = await readDay(db, day.workspace_id, day.location_id, day.start, day.end);
    summary.aggregates.byMonth = [{ month: day.day.slice(0, 7), positive: summary.aggregates.positive.reduce((n, t) => n + t.count, 0), negative: summary.aggregates.negative.reduce((n, t) => n + t.count, 0) }];
    await db.query(`INSERT INTO grm_daily_insights(workspace_id,location_id,day,timezone,analysis_version,summary_version,source_revision,summary)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT(workspace_id,location_id,day,timezone,analysis_version) DO UPDATE SET
        summary_version=excluded.summary_version,source_revision=excluded.source_revision,summary=excluded.summary,built_at=now()
      WHERE grm_daily_insights.source_revision<=excluded.source_revision`,
    [day.workspace_id, day.location_id, day.day, day.timezone, ANALYSIS_VERSION, DAILY_SUMMARY_VERSION, source.revision, JSON.stringify(summary)]);
    await db.query("COMMIT");
    day.revision = source.revision;
    return summary;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

async function listDays(workspaceId: string, scope: SummaryScope): Promise<DayRow[]> {
  if (scope.locationIds.length === 0) return [];
  const { rows } = await getPool().query<DayRow>(`
    SELECT d.*, (d.day::timestamp AT TIME ZONE d.timezone) start,
      ((d.day+1)::timestamp AT TIME ZONE d.timezone) "end",s.summary,s.source_revision
    FROM grm_insight_days d LEFT JOIN grm_daily_insights s
      ON s.workspace_id=d.workspace_id AND s.location_id=d.location_id AND s.day=d.day AND s.timezone=d.timezone
      AND s.analysis_version=$5 AND s.summary_version=$6
    WHERE d.workspace_id=$1 AND d.location_id=ANY($2::uuid[])
      AND d.timezone=grm_review_timezone(d.workspace_id,d.location_id)
      AND ($3::timestamptz IS NULL OR ((d.day+1)::timestamp AT TIME ZONE d.timezone)>$3)
      AND ($4::timestamptz IS NULL OR (d.day::timestamp AT TIME ZONE d.timezone)<$4)
    ORDER BY d.location_id,d.day`, [workspaceId, scope.locationIds, scope.start, scope.end, ANALYSIS_VERSION, DAILY_SUMMARY_VERSION]);
  return rows;
}

/** Only dirty days are read from the observation store. Quiet history is reused. */
export async function refreshDailySummaries(workspaceId: string, locationIds: string[], options?: { deadlineAt?: number; start?: string | null; end?: string | null }): Promise<boolean> {
  const days = await listDays(workspaceId, { locationIds, start: options?.start ?? null, end: options?.end ?? null });
  for (const day of days) {
    if (day.summary && day.source_revision === day.revision) continue;
    if (options?.deadlineAt && Date.now() >= options.deadlineAt) return false;
    await rebuildDay(day);
  }
  return true;
}

export async function loadDailySummaryRange(workspaceId: string, scope: SummaryScope): Promise<DailySummary & { sources: DailySource[]; fingerprint: string }> {
  const days = await listDays(workspaceId, scope);
  const summaries: DailySummary[] = [];
  const sources: DailySource[] = [];
  for (const day of days) {
    let summary = day.summary && day.source_revision === day.revision ? day.summary : await rebuildDay(day);
    const start = scope.start && scope.start > day.start ? scope.start : day.start;
    const end = scope.end && scope.end < day.end ? scope.end : day.end;
    let fragmentFingerprint: string | undefined;
    // Rolling presets and UTC custom dates may cut across a local day. Read
    // just those boundary fragments; never count the entire boundary day.
    if (Date.parse(start) !== Date.parse(day.start) || Date.parse(end) !== Date.parse(day.end)) {
      const db = await getPool().connect();
      try {
        await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        summary = await readDay(db, workspaceId, day.location_id, start, end);
        const { rows: [fragment] } = await db.query<{ fingerprint: string }>(`SELECT md5(coalesce(string_agg(
          jsonb_build_array(r.id,r.content_fingerprint,r.star_rating,r.comment,r.review_create_time,
            a.status,a.content_fingerprint,a.processed_at)::text,'' ORDER BY r.id),'')) fingerprint
          FROM grm_reviews r LEFT JOIN grm_review_analyses a ON a.workspace_id=r.workspace_id AND a.review_id=r.id AND a.analysis_version=$5
          WHERE r.workspace_id=$1 AND r.location_id=$2 AND r.missing_on_google_at IS NULL
            AND r.review_create_time>=$3 AND r.review_create_time<$4`, [workspaceId, day.location_id, start, end, ANALYSIS_VERSION]);
        fragmentFingerprint = fragment.fingerprint;
        await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      finally { db.release(); }
      summary.aggregates.byMonth = [{ month: day.day.slice(0, 7), positive: summary.aggregates.positive.reduce((n, t) => n + t.count, 0), negative: summary.aggregates.negative.reduce((n, t) => n + t.count, 0) }];
    }
    summaries.push(summary);
    sources.push({ locationId: day.location_id, day: day.day, timezone: day.timezone, revision: day.revision, start, end,
      ...(fragmentFingerprint ? { fragmentFingerprint } : {}) });
  }
  return { ...combineDailySummaries(summaries), sources, fingerprint: dailySourceFingerprint(sources) };
}
