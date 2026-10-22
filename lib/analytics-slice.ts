import {
  type OnboardingComparison,
  type ReplySpeedBucket,
  type SampleSummary,
} from "@/lib/analytics-metrics";
import { average, share, EMPTY_STARS, type StarCounts } from "@/lib/metrics";
import { languageLabel } from "@/lib/review-inbox";

const BUCKETS: ReplySpeedBucket[] = ["under1h", "h1to6", "h6to24", "over24h"];

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stars(value: unknown): StarCounts {
  if (!Array.isArray(value)) return [...EMPTY_STARS];
  return [num(value[0]), num(value[1]), num(value[2]), num(value[3]), num(value[4])];
}

/** Turns one `grm_analytics_summary` JSON object into a SampleSummary. */
export function summaryFromRpc(raw: unknown): SampleSummary {
  const body = obj(raw);
  const reviews = num(body.reviews);
  const bucketsRaw = obj(body.buckets);
  const bucketStarsRaw = obj(body.bucketStars);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, num(bucketsRaw[b])])) as Record<
    ReplySpeedBucket,
    number
  >;
  const bucketStars = Object.fromEntries(BUCKETS.map((b) => [b, stars(bucketStarsRaw[b])])) as Record<
    ReplySpeedBucket,
    StarCounts
  >;

  const languageCounts = new Map<string, number>();
  if (Array.isArray(body.languages)) {
    for (const item of body.languages) {
      const row = obj(item);
      const rawId = typeof row.id === "string" && row.id ? row.id : "unset";
      const id = rawId !== "unset" && languageLabel(rawId) ? rawId : "unset";
      languageCounts.set(id, (languageCounts.get(id) ?? 0) + num(row.count));
    }
  }
  const languages = [...languageCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: id === "unset" ? "Not set" : languageLabel(id) ?? id,
      count,
      share: share(count, reviews),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const publishedHere = num(body.publishedHere);
  return {
    reviews,
    avgRating: average(num(body.ratingSum), reviews),
    replyRate: share(num(body.replied), reviews),
    medianHours: nullableNum(body.medianHours),
    buckets,
    bucketStars,
    untimedReplies: num(body.untimedReplies),
    languages,
    autoShare: publishedHere > 0 ? share(num(body.autoAi), publishedHere) : null,
  };
}

export interface AnalyticsSliceData {
  window: SampleSummary;
  onboarding: OnboardingComparison;
  truncated: boolean;
}

/** Turns the `grm_analytics_slice` JSON into the analytics page slice. */
export function sliceFromRpc(raw: unknown, completedAt: string | null): AnalyticsSliceData {
  const body = obj(raw);
  const empty = summaryFromRpc(null);
  const validCompleted =
    completedAt && Number.isFinite(Date.parse(completedAt)) ? completedAt : null;
  return {
    window: summaryFromRpc(body.window),
    onboarding: validCompleted
      ? {
          completedAt: validCompleted,
          before: summaryFromRpc(body.before),
          after: summaryFromRpc(body.after),
        }
      : { completedAt: null, before: empty, after: empty },
    // Full-window aggregates are never truncated.
    truncated: false,
  };
}
