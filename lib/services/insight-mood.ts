import { getPool } from "@/lib/db/pool";
import { remember } from "@/lib/ttl-cache";
import {
  shiftMonth,
  type LocationTopicCounts,
  type MoodMonthCounts,
  type ReviewMonthCounts,
  type TopicMonthCounts,
} from "@/lib/insight-mood";

export interface MonthQuote {
  month: string;
  sentiment: "positive" | "negative";
  topic: string;
  excerpt: string;
}

export interface InsightMoodData {
  /** Praise and complaint mentions per month, from a year before the first chart month. */
  mood: MoodMonthCounts[];
  /** Reviews and average rating per chart month (every review, analysed or not). */
  reviews: ReviewMonthCounts[];
  /** Praise and complaint mentions per topic and chart month. */
  topics: TopicMonthCounts[];
  /** Per location and topic over the selected period, for the heatmap. */
  locationTopics: LocationTopicCounts[];
  /** Average rating per location over the selected period. */
  locationRatings: Record<string, { rating: number | null; reviews: number }>;
  /** One short quote per chart month and sentiment. */
  quotes: MonthQuote[];
}

const EMPTY: InsightMoodData = { mood: [], reviews: [], topics: [], locationTopics: [], locationRatings: {}, quotes: [] };

const OBS_FROM = `
  FROM public.grm_review_observations o
  JOIN public.grm_review_analyses a ON a.id = o.analysis_id AND a.status = 'ready'
 WHERE o.workspace_id = $1
   AND o.location_id = ANY($2::uuid[])
   AND o.sentiment IN ('positive','negative')`;

const MONTH_OF = `to_char(o.review_create_time AT TIME ZONE 'UTC', 'YYYY-MM')`;

function monthStart(month: string): string {
  return `${month}-01T00:00:00.000Z`;
}

/**
 * Monthly mood, topic and location counts for the insights page. Every query
 * groups in the database; the page never pages through observations.
 */
export async function loadInsightMood(
  workspaceId: string,
  input: {
    locationIds: string[];
    /** Calendar months the chart shows (YYYY-MM, ascending). */
    months: string[];
    /** The selected period, for the location heatmap. */
    start: string | null;
    end: string | null;
  }
): Promise<InsightMoodData> {
  if (input.locationIds.length === 0 || input.months.length === 0) return EMPTY;
  const places = [...input.locationIds].sort().join(",");
  const key = `insight-mood:${workspaceId}:${input.months[0]}:${input.months.at(-1)}:${input.start ?? ""}:${input.end ?? ""}:${places}`;
  return remember(key, 45_000, () => fetchInsightMood(workspaceId, input));
}

async function fetchInsightMood(
  workspaceId: string,
  input: { locationIds: string[]; months: string[]; start: string | null; end: string | null }
): Promise<InsightMoodData> {
  const pool = getPool();
  const first = input.months[0];
  const last = input.months[input.months.length - 1];
  const chartStart = monthStart(first);
  const chartEnd = monthStart(shiftMonth(last, 1));
  const yearBefore = monthStart(shiftMonth(first, -12));
  const base = [workspaceId, input.locationIds];

  const [mood, reviews, topics, locationTopics, locationRatings, quotes] = await Promise.all([
    pool.query<{ month: string; positive: number; negative: number }>(
      `SELECT ${MONTH_OF} AS month,
              count(*) FILTER (WHERE o.sentiment = 'positive')::int AS positive,
              count(*) FILTER (WHERE o.sentiment = 'negative')::int AS negative
       ${OBS_FROM}
         AND o.review_create_time >= $3 AND o.review_create_time < $4
       GROUP BY 1 ORDER BY 1`,
      [...base, yearBefore, chartEnd]
    ),
    pool.query<{ month: string; reviews: number; rating: number | null }>(
      `SELECT to_char(r.review_create_time AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
              count(*)::int AS reviews,
              round(avg(r.star_rating)::numeric, 2) AS rating
         FROM public.grm_reviews r
        WHERE r.workspace_id = $1
          AND r.location_id = ANY($2::uuid[])
          AND r.missing_on_google_at IS NULL
          AND r.review_create_time >= $3 AND r.review_create_time < $4
        GROUP BY 1 ORDER BY 1`,
      [...base, chartStart, chartEnd]
    ),
    pool.query<{ topic: string; month: string; positive: number; negative: number }>(
      `SELECT o.topic, ${MONTH_OF} AS month,
              count(*) FILTER (WHERE o.sentiment = 'positive')::int AS positive,
              count(*) FILTER (WHERE o.sentiment = 'negative')::int AS negative
       ${OBS_FROM}
         AND o.topic <> 'other'
         AND o.review_create_time >= $3 AND o.review_create_time < $4
       GROUP BY 1, 2`,
      [...base, chartStart, chartEnd]
    ),
    pool.query<{ location_id: string; topic: string; positive: number; negative: number }>(
      `SELECT o.location_id, o.topic,
              count(*) FILTER (WHERE o.sentiment = 'positive')::int AS positive,
              count(*) FILTER (WHERE o.sentiment = 'negative')::int AS negative
       ${OBS_FROM}
         AND o.topic <> 'other'
         AND ($3::timestamptz IS NULL OR o.review_create_time >= $3)
         AND ($4::timestamptz IS NULL OR o.review_create_time < $4)
       GROUP BY 1, 2`,
      [...base, input.start, input.end]
    ),
    pool.query<{ location_id: string; reviews: number; rating: number | null }>(
      `SELECT r.location_id, count(*)::int AS reviews, round(avg(r.star_rating)::numeric, 1) AS rating
         FROM public.grm_reviews r
        WHERE r.workspace_id = $1
          AND r.location_id = ANY($2::uuid[])
          AND r.missing_on_google_at IS NULL
          AND ($3::timestamptz IS NULL OR r.review_create_time >= $3)
          AND ($4::timestamptz IS NULL OR r.review_create_time < $4)
        GROUP BY 1`,
      [...base, input.start, input.end]
    ),
    pool.query<{ month: string; sentiment: "positive" | "negative"; topic: string; excerpt: string }>(
      `SELECT DISTINCT ON (1, 2) ${MONTH_OF} AS month, o.sentiment, o.topic, o.evidence_excerpt AS excerpt
       ${OBS_FROM}
         AND length(o.evidence_excerpt) BETWEEN 24 AND 200
         AND o.review_create_time >= $3 AND o.review_create_time < $4
       ORDER BY 1, 2, o.confidence DESC NULLS LAST, o.review_create_time DESC`,
      [...base, chartStart, chartEnd]
    ),
  ]);

  const ratings: InsightMoodData["locationRatings"] = {};
  for (const row of locationRatings.rows) {
    ratings[row.location_id] = { rating: row.rating === null ? null : Number(row.rating), reviews: Number(row.reviews) };
  }
  return {
    mood: mood.rows.map((row) => ({ month: row.month, positive: Number(row.positive), negative: Number(row.negative) })),
    reviews: reviews.rows.map((row) => ({
      month: row.month,
      reviews: Number(row.reviews),
      rating: row.rating === null ? null : Number(row.rating),
    })),
    topics: topics.rows.map((row) => ({
      topic: row.topic,
      month: row.month,
      positive: Number(row.positive),
      negative: Number(row.negative),
    })),
    locationTopics: locationTopics.rows.map((row) => ({
      locationId: row.location_id,
      topic: row.topic,
      positive: Number(row.positive),
      negative: Number(row.negative),
    })),
    locationRatings: ratings,
    quotes: quotes.rows.map((row) => ({ month: row.month, sentiment: row.sentiment, topic: row.topic, excerpt: row.excerpt })),
  };
}
