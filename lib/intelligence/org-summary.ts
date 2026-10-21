import { createHash } from "crypto";
import { labelFor, type SummaryDocument, type SummaryReview } from "./summary-aggregate";
import type { SummaryWindow } from "./summary-window";

/**
 * The organisation summary is the source of truth for insight counts.
 *
 * It is maintained incrementally: merging only adds, replaces, or removes
 * the contributions of reviews that are new, changed, or deleted since the
 * last merge — the whole review set is never recounted. Counters are kept
 * per location per UTC day so any scope (organisation, group, location)
 * and any date window can be answered by slicing this one store.
 */
export interface OrgDayCounters {
  reviewCount: number;
  ratingSum: number;
  negativeCount: number;
  extractedCount: number;
  sentimentDenominator: number;
  sentiment: { positive: number; negative: number; mixed: number; neutral: number; unknown: number };
  topics: Record<string, number>;
  issues: Record<string, number>;
  praise: Record<string, number>;
}

export interface OrgReviewContribution {
  locationId: string;
  /** UTC day (YYYY-MM-DD) of the review, or null when undated. */
  day: string | null;
  fingerprint: string;
  counters: OrgDayCounters;
}

/** Bump when a reading change must discard the stored counters and rebuild them. */
export const ORG_SUMMARY_LOGIC_VERSION = 2;

export interface OrgSummaryState {
  version: 1;
  /** Absent or lower than ORG_SUMMARY_LOGIC_VERSION means the next merge rebuilds from the current readings. */
  logicVersion?: number;
  /** When set, this summary is exactly that many trailing months. A different window rebuilds from empty. */
  windowMonths?: number;
  clientId: string;
  contributions: Record<string, OrgReviewContribution>;
  days: Record<string, OrgDayCounters>;
}

export interface OrgMergeResult {
  state: OrgSummaryState;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  affectedLocationIds: string[];
}

function emptyCounters(): OrgDayCounters {
  return {
    reviewCount: 0,
    ratingSum: 0,
    negativeCount: 0,
    extractedCount: 0,
    sentimentDenominator: 0,
    sentiment: { positive: 0, negative: 0, mixed: 0, neutral: 0, unknown: 0 },
    topics: {},
    issues: {},
    praise: {},
  };
}

export function emptyOrgSummary(clientId: string): OrgSummaryState {
  return { version: 1, clientId, contributions: {}, days: {} };
}

function dayKey(locationId: string, day: string | null): string {
  return `${locationId}|${day ?? "undated"}`;
}

function reviewDay(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function contributionFor(review: SummaryReview): OrgReviewContribution {
  const counters = emptyCounters();
  counters.reviewCount = 1;
  counters.ratingSum = review.stars;
  if (review.stars <= 3) counters.negativeCount = 1;
  if (review.overall !== null) counters.extractedCount = 1;
  if (review.overall === "positive" || review.overall === "negative" || review.overall === "mixed" || review.overall === "neutral") {
    counters.sentiment[review.overall] = 1;
    counters.sentimentDenominator = 1;
  } else if (review.overall === "unknown") {
    counters.sentiment.unknown = 1;
  }
  for (const code of new Set(review.topics)) counters.topics[code] = 1;
  for (const code of new Set(review.issues)) counters.issues[code] = 1;
  for (const code of new Set(review.praise)) counters.praise[code] = 1;
  return {
    locationId: review.locationId,
    day: reviewDay(review.createdAt),
    fingerprint: review.contentHash,
    counters,
  };
}

function addInto(target: OrgDayCounters, source: OrgDayCounters, sign: 1 | -1): void {
  target.reviewCount += sign * source.reviewCount;
  target.ratingSum += sign * source.ratingSum;
  target.negativeCount += sign * source.negativeCount;
  target.extractedCount += sign * source.extractedCount;
  target.sentimentDenominator += sign * source.sentimentDenominator;
  for (const key of ["positive", "negative", "mixed", "neutral", "unknown"] as const) {
    target.sentiment[key] += sign * source.sentiment[key];
  }
  for (const field of ["topics", "issues", "praise"] as const) {
    for (const [code, count] of Object.entries(source[field])) {
      const next = (target[field][code] ?? 0) + sign * count;
      if (next <= 0) delete target[field][code];
      else target[field][code] = next;
    }
  }
}

/** True until one complete reading pass has replaced the summary built by the previous rules. */
export function orgSummaryNeedsRewrite(state: OrgSummaryState | null): boolean {
  return (state?.logicVersion ?? 0) < ORG_SUMMARY_LOGIC_VERSION;
}

/**
 * While the stored summary is from the previous reading, every pass recounts
 * from the reviews in hand and the old counters are discarded. The recount
 * is marked current only when extraction of the backlog has finished. After
 * that, merges add, replace, and remove individual reviews.
 */
export function applyOrgSummaryUpdate(
  existing: OrgSummaryState | null,
  clientId: string,
  reviews: readonly SummaryReview[],
  extractionComplete: boolean,
  windowMonths?: number
): OrgMergeResult & { rewritten: boolean; settled: boolean } {
  const windowChanged = windowMonths != null && existing?.windowMonths !== windowMonths;
  const rewrite = orgSummaryNeedsRewrite(existing) || windowChanged;
  const result = mergeOrgSummary(rewrite || !existing ? emptyOrgSummary(clientId) : existing, reviews);
  const settled = !rewrite || extractionComplete;
  if (settled) {
    result.state.logicVersion = ORG_SUMMARY_LOGIC_VERSION;
    if (windowMonths != null) result.state.windowMonths = windowMonths;
  }
  return { ...result, rewritten: rewrite, settled };
}

/**
 * Merges the current extracted facts into the stored state. A review whose
 * fingerprint already matches is skipped untouched; a changed review has
 * its old contribution subtracted before the new one is added; a review
 * missing from the input (deleted or removed at source) is subtracted.
 */
export function mergeOrgSummary(state: OrgSummaryState, reviews: readonly SummaryReview[]): OrgMergeResult {
  const next: OrgSummaryState = structuredClone(state);
  const seen = new Set<string>();
  const affected = new Set<string>();
  let added = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;

  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    const existing = next.contributions[review.id];
    if (existing && existing.fingerprint === review.contentHash) {
      skipped += 1;
      continue;
    }
    if (existing) {
      const key = dayKey(existing.locationId, existing.day);
      const bucket = next.days[key] ?? emptyCounters();
      addInto(bucket, existing.counters, -1);
      if (bucket.reviewCount <= 0) delete next.days[key];
      else next.days[key] = bucket;
      affected.add(existing.locationId);
      updated += 1;
    } else {
      added += 1;
    }
    const contribution = contributionFor(review);
    const key = dayKey(contribution.locationId, contribution.day);
    const bucket = next.days[key] ?? emptyCounters();
    addInto(bucket, contribution.counters, 1);
    next.days[key] = bucket;
    next.contributions[review.id] = contribution;
    affected.add(contribution.locationId);
  }

  for (const [reviewId, existing] of Object.entries(next.contributions)) {
    if (seen.has(reviewId)) continue;
    const key = dayKey(existing.locationId, existing.day);
    const bucket = next.days[key] ?? emptyCounters();
    addInto(bucket, existing.counters, -1);
    if (bucket.reviewCount <= 0) delete next.days[key];
    else next.days[key] = bucket;
    delete next.contributions[reviewId];
    affected.add(existing.locationId);
    removed += 1;
  }

  return { state: next, added, updated, removed, skipped, affectedLocationIds: [...affected] };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function sliceCounters(
  state: OrgSummaryState,
  locationIds: ReadonlySet<string>,
  startDay: string | null,
  endDay: string | null
): { total: OrgDayCounters; perLocation: Map<string, OrgDayCounters>; months: Map<string, number>; entries: Array<[string, OrgDayCounters]> } {
  const total = emptyCounters();
  const perLocation = new Map<string, OrgDayCounters>();
  const months = new Map<string, number>();
  const entries: Array<[string, OrgDayCounters]> = [];
  for (const [key, counters] of Object.entries(state.days)) {
    const [locationId, day] = key.split("|") as [string, string];
    if (!locationIds.has(locationId) || day === "undated") continue;
    if (startDay && day < startDay) continue;
    if (endDay && day >= endDay) continue;
    entries.push([key, counters]);
    addInto(total, counters, 1);
    const locationCounters = perLocation.get(locationId) ?? emptyCounters();
    addInto(locationCounters, counters, 1);
    perLocation.set(locationId, locationCounters);
    months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + counters.reviewCount);
  }
  return { total, perLocation, months, entries };
}

export interface OrgProjection {
  coverage: SummaryDocument["coverage"];
  metrics: SummaryDocument["metrics"];
  sentiment: SummaryDocument["sentiment"];
  topics: SummaryDocument["topics"];
  issues: SummaryDocument["issues"];
  praise: SummaryDocument["praise"];
  months: SummaryDocument["months"];
  locations: SummaryDocument["locations"];
  changes: SummaryDocument["changes"];
  sourceHash: string;
}

/**
 * Answers one scope + window from the organisation store by slicing the
 * per-location, per-day counters. Returns null when the store holds no
 * reviews for these locations, so callers can fall back to a direct build.
 */
export function projectOrgSummary(
  state: OrgSummaryState,
  input: { locationIds: readonly string[]; window: SummaryWindow }
): OrgProjection | null {
  const locationIds = new Set(input.locationIds);
  const hasAny = Object.values(state.contributions).some((contribution) => locationIds.has(contribution.locationId));
  if (!hasAny) return null;

  const startDay = input.window.start?.slice(0, 10) ?? null;
  const endDay = input.window.end?.slice(0, 10) ?? null;
  const slice = sliceCounters(state, locationIds, startDay, endDay);
  const { total } = slice;

  let undatedCount = 0;
  for (const [key, counters] of Object.entries(state.days)) {
    const [locationId, day] = key.split("|") as [string, string];
    if (locationIds.has(locationId) && day === "undated") undatedCount += counters.reviewCount;
  }

  const averageRating = total.reviewCount === 0 ? null : round(total.ratingSum / total.reviewCount);
  const codeRows = (record: Record<string, number>, withShare: boolean) =>
    Object.entries(record)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, reviews]) => ({
        code,
        label: labelFor(code),
        reviews,
        ...(withShare ? { share: total.reviewCount === 0 ? null : round(reviews / total.reviewCount) } : {}),
      }));

  let changes: SummaryDocument["changes"] = null;
  if (input.window.comparison) {
    const previous = sliceCounters(
      state,
      locationIds,
      input.window.comparison.start.slice(0, 10),
      input.window.comparison.end.slice(0, 10)
    ).total;
    const previousAverage = previous.reviewCount === 0 ? null : round(previous.ratingSum / previous.reviewCount);
    changes = {
      previousStart: input.window.comparison.start,
      previousEnd: input.window.comparison.end,
      previousReviewCount: previous.reviewCount,
      reviewCountDelta: total.reviewCount - previous.reviewCount,
      averageRatingDelta:
        averageRating === null || previousAverage === null ? null : round(averageRating - previousAverage),
    };
  }

  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify({
        locations: [...locationIds].sort(),
        startDay,
        endDay,
        entries: slice.entries.sort((a, b) => a[0].localeCompare(b[0])),
      })
    )
    .digest("hex")
    .slice(0, 32);

  return {
    coverage: {
      reviewCount: total.reviewCount,
      undatedCount,
      extractedCount: total.extractedCount,
      unextractedCount: total.reviewCount - total.extractedCount,
      locationCount: input.locationIds.length,
    },
    metrics: {
      averageRating,
      negativeShare: total.reviewCount === 0 ? null : round(total.negativeCount / total.reviewCount),
      ratingDenominator: total.reviewCount,
    },
    sentiment: {
      denominator: total.sentimentDenominator,
      positive: total.sentiment.positive,
      negative: total.sentiment.negative,
      mixed: total.sentiment.mixed,
      neutral: total.sentiment.neutral,
      unknown: total.sentiment.unknown,
    },
    topics: codeRows(total.topics, true) as OrgProjection["topics"],
    issues: codeRows(total.issues, true) as OrgProjection["issues"],
    praise: codeRows(total.praise, false) as OrgProjection["praise"],
    months: [...slice.months.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    locations: input.locationIds
      .map((locationId) => {
        const counters = slice.perLocation.get(locationId);
        return {
          locationId,
          reviewCount: counters?.reviewCount ?? 0,
          averageRating:
            !counters || counters.reviewCount === 0 ? null : round(counters.ratingSum / counters.reviewCount),
        };
      })
      .sort((a, b) => b.reviewCount - a.reviewCount || a.locationId.localeCompare(b.locationId)),
    changes,
    sourceHash,
  };
}
