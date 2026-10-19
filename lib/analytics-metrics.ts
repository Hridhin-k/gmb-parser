import { languageLabel } from "@/lib/review-inbox";
import { average, share } from "@/lib/metrics";

/**
 * Analytics definitions for the selected scope.
 *
 * Population: one row per review on a location in the scope. A location belongs to one group,
 * so a group total is the sum of its locations and a review is counted once.
 * Window: review_create_time >= start and < end. An open bound is unbounded. Month labels use
 * the workspace timezone; reply hours are elapsed time and do not depend on that timezone.
 * Missing reply timestamps stay out of the reply-time distribution and the median. They are not
 * treated as zero. An empty population is an em dash, not 0%.
 */

export type ReplySpeedBucket = "under1h" | "h1to6" | "h6to24" | "over24h";

export const REPLY_SPEED_LABELS: Record<ReplySpeedBucket, string> = {
  under1h: "Under 1h",
  h1to6: "1–6h",
  h6to24: "6–24h",
  over24h: "Over 24h",
};

export type RankBy = "rating" | "reviews" | "reply" | "time";
export type RankShow = "locations" | "groups";
export type AnalyticsCompare = "previous" | "onboarding";

export function replySpeedBucket(hours: number): ReplySpeedBucket | null {
  if (!Number.isFinite(hours) || hours < 0) return null;
  if (hours < 1) return "under1h";
  if (hours < 6) return "h1to6";
  if (hours < 24) return "h6to24";
  return "over24h";
}

/** Hours from the review to Google’s reply timestamp. Missing or earlier replies are excluded. */
export function responseHours(createdAt: string, replyAt: string | null): number | null {
  if (!replyAt) return null;
  const created = Date.parse(createdAt);
  const reply = Date.parse(replyAt);
  if (!Number.isFinite(created) || !Number.isFinite(reply) || reply < created) return null;
  return (reply - created) / 3_600_000;
}

export function inReviewWindow(createdAt: string, start: string | null, end: string | null): boolean {
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return false;
  if (start && time < Date.parse(start)) return false;
  if (end && time >= Date.parse(end)) return false;
  return true;
}

/** Odd counts use the middle value. Even counts use the mean of the two middle values. */
export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ReviewSample {
  createdAt: string;
  stars: number;
  hasReply: boolean;
  replyAt: string | null;
  language: string | null;
  /** True when a published reply in GRM came from the model. Null when GRM has no published reply. */
  autoReply: boolean | null;
}

export interface LanguageShare {
  id: string;
  label: string;
  count: number;
  share: number | null;
}

export interface SampleSummary {
  reviews: number;
  avgRating: number | null;
  replyRate: number | null;
  medianHours: number | null;
  buckets: Record<ReplySpeedBucket, number>;
  untimedReplies: number;
  languages: LanguageShare[];
  /** Share of GRM-published replies whose source is the model. Null when none were published here. */
  autoShare: number | null;
}

export function summarizeSamples(rows: ReviewSample[]): SampleSummary {
  const buckets: Record<ReplySpeedBucket, number> = { under1h: 0, h1to6: 0, h6to24: 0, over24h: 0 };
  const hours: number[] = [];
  let untimedReplies = 0;
  let ratingSum = 0;
  let replied = 0;
  const languageCounts = new Map<string, number>();
  let publishedHere = 0;
  let auto = 0;
  for (const row of rows) {
    ratingSum += row.stars;
    if (row.hasReply) replied += 1;
    const elapsed = responseHours(row.createdAt, row.replyAt);
    if (elapsed === null) {
      if (row.hasReply) untimedReplies += 1;
    } else {
      hours.push(elapsed);
      const bucket = replySpeedBucket(elapsed);
      if (bucket) buckets[bucket] += 1;
    }
    const language = row.language && languageLabel(row.language) ? row.language : "unset";
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    if (row.autoReply !== null) {
      publishedHere += 1;
      if (row.autoReply) auto += 1;
    }
  }
  const languages = [...languageCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: id === "unset" ? "Not set" : languageLabel(id) ?? id,
      count,
      share: share(count, rows.length),
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return {
    reviews: rows.length,
    avgRating: average(ratingSum, rows.length),
    replyRate: share(replied, rows.length),
    medianHours: median(hours),
    buckets,
    untimedReplies,
    languages,
    autoShare: share(auto, publishedHere),
  };
}

export interface OnboardingComparison {
  completedAt: string | null;
  before: SampleSummary;
  after: SampleSummary;
}

export function splitOnboarding(rows: ReviewSample[], completedAt: string | null): OnboardingComparison {
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
    const empty = summarizeSamples([]);
    return { completedAt: null, before: empty, after: empty };
  }
  const mark = Date.parse(completedAt);
  const before: ReviewSample[] = [];
  const after: ReviewSample[] = [];
  for (const row of rows) {
    const time = Date.parse(row.createdAt);
    if (!Number.isFinite(time)) continue;
    if (time < mark) before.push(row);
    else after.push(row);
  }
  return { completedAt, before: summarizeSamples(before), after: summarizeSamples(after) };
}

export interface RankRow {
  id: string;
  reviews: number;
  ratingSum: number;
  replied: number;
  responseHoursSum: number;
  responseCount: number;
}

/** Parent region when the location sits in a city. Each location is added once. */
export function rollupByGroup(
  rows: Array<RankRow & { groupId: string | null }>,
  parentOf: (groupId: string) => string | null
): RankRow[] {
  const totals = new Map<string, RankRow>();
  for (const row of rows) {
    const parent = row.groupId ? parentOf(row.groupId) : null;
    const id = parent ?? row.groupId ?? "";
    const current = totals.get(id) ?? {
      id,
      reviews: 0,
      ratingSum: 0,
      replied: 0,
      responseHoursSum: 0,
      responseCount: 0,
    };
    current.reviews += row.reviews;
    current.ratingSum += row.ratingSum;
    current.replied += row.replied;
    current.responseHoursSum += row.responseHoursSum;
    current.responseCount += row.responseCount;
    totals.set(id, current);
  }
  return [...totals.values()];
}

export function rankRows(rows: RankRow[], by: RankBy): RankRow[] {
  const metric = (row: RankRow): number | null => {
    if (by === "reviews") return row.reviews;
    if (by === "reply") return share(row.replied, row.reviews);
    if (by === "time") return average(row.responseHoursSum, row.responseCount);
    return row.reviews > 0 ? row.ratingSum / row.reviews : null;
  };
  return [...rows].sort((left, right) => {
    const a = metric(left);
    const b = metric(right);
    if (a === null && b === null) return left.id.localeCompare(right.id);
    if (a === null) return 1;
    if (b === null) return -1;
    const diff = by === "time" ? a - b : b - a;
    if (diff !== 0) return diff;
    return right.reviews - left.reviews || left.id.localeCompare(right.id);
  });
}

export function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 1) return "< 1h";
  if (value < 48) return `${Math.round(value)}h`;
  const days = value / 24;
  return `${days >= 10 ? Math.round(days) : days.toFixed(1)}d`;
}
