import { createHash } from "node:crypto";
import {
  INTELLIGENCE_SCHEMA_VERSION,
  membershipHash,
  summaryIdentityKey,
  type IntelligenceScopeType,
  type SummaryIdentity,
  type SummaryTimezone,
} from "@/lib/intelligence/identity";
import { TAXONOMY_VERSION, TAXONOMY_V2 } from "@/lib/intelligence/taxonomy";
import { summaryMonth, windowContains, type SummaryWindow } from "@/lib/intelligence/summary-window";

export const SUMMARY_ANALYSIS_VERSION = "summary-v1";
export const SUMMARY_PROMPT_VERSION = "summary-v1";

/**
 * Counting rules.
 *
 * A review is one row, deduplicated by id. It counts once in reviewCount even
 * when it has several topics. Topic and issue shares use reviewCount as the
 * denominator, so those shares can add up to more than one.
 *
 * Sentiment shares use a different denominator: reviews whose overall sentiment
 * is positive, negative, mixed, or neutral. Unknown sentiment and reviews with
 * no extraction are counted beside that denominator, not inside it.
 *
 * Average rating is the sum of stars divided by reviewCount. It is not the
 * average of location averages. A location with no reviews has a null average,
 * which is not the same as zero.
 *
 * Cluster member counts are stored separately and are not added to reviewCount.
 * Reviews with no parseable review_create_time are undated: they are outside
 * every bounded window and outside all-time reviewCount.
 * Reviews confirmed missing at the source are omitted before this function.
 */
export interface SummaryReview {
  id: string;
  locationId: string;
  stars: number;
  createdAt: string | null;
  contentHash: string;
  overall: "positive" | "negative" | "mixed" | "neutral" | "unknown" | null;
  topics: string[];
  issues: string[];
  praise: string[];
  excerpts: Array<{ topicCode: string; polarity: "praise" | "complaint"; text: string }>;
  /** Aspects in the customer's own wording (extraction v2). Absent on pre-v2 rows. */
  aspects?: Array<{ phrase: string; topicCode: string; polarity: "praise" | "complaint" | "neutral" }>;
  staffMentions?: string[];
  requests?: string[];
  clusterIds?: string[];
  /** High extraction severity. Not part of the summary source hash. */
  severe?: boolean;
}

export interface SummaryDocument {
  analysisVersion: typeof SUMMARY_ANALYSIS_VERSION;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  promptVersion: typeof SUMMARY_PROMPT_VERSION;
  model: "none";
  scopeType: IntelligenceScopeType;
  scopeId: string;
  range: SummaryWindow;
  coverage: {
    reviewCount: number;
    undatedCount: number;
    extractedCount: number;
    unextractedCount: number;
    locationCount: number;
  };
  metrics: {
    averageRating: number | null;
    negativeShare: number | null;
    ratingDenominator: number;
  };
  sentiment: {
    denominator: number;
    positive: number;
    negative: number;
    mixed: number;
    neutral: number;
    unknown: number;
  };
  topics: Array<{ code: string; label: string; reviews: number; share: number | null }>;
  issues: Array<{ code: string; label: string; reviews: number; share: number | null }>;
  praise: Array<{ code: string; label: string; reviews: number }>;
  months: Array<{ month: string; count: number }>;
  changes: {
    previousStart: string;
    previousEnd: string;
    previousReviewCount: number;
    reviewCountDelta: number;
    averageRatingDelta: number | null;
  } | null;
  locations: Array<{ locationId: string; reviewCount: number; averageRating: number | null }>;
  clusters: { clusterCount: number; memberReviewCount: number };
  evidence: Array<{ reviewId: string; excerpt: string; topicCode: string; polarity: "praise" | "complaint" }>;
  metricKeys: ["review_count", "average_rating", "negative_share"];
  sourceHash: string;
}

export interface SummaryBuildInput {
  scopeType: IntelligenceScopeType;
  scopeId: string;
  locationIds: readonly string[];
  window: SummaryWindow;
  reviews: readonly SummaryReview[];
  previousReviews?: readonly SummaryReview[];
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function labelFor(code: string): string {
  return TAXONOMY_V2.find((node) => node.code === code)?.label ?? code;
}

function dedupe(reviews: readonly SummaryReview[]): SummaryReview[] {
  const seen = new Set<string>();
  const out: SummaryReview[] = [];
  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    out.push(review);
  }
  return out;
}

export function summarySourceHash(reviews: readonly SummaryReview[]): string {
  const lines = dedupe(reviews)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((review) =>
      [
        review.id,
        review.contentHash,
        review.stars,
        review.createdAt ?? "",
        review.locationId,
        review.overall ?? "",
        [...review.topics].sort().join("."),
      ].join(":")
    );
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

function average(stars: number, count: number): number | null {
  if (count === 0) return null;
  return round(stars / count);
}

function share(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return round(part / whole);
}

function countCodes(reviews: readonly SummaryReview[], field: "topics" | "issues" | "praise") {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    for (const code of new Set(review[field])) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function inWindow(window: SummaryWindow, review: SummaryReview): boolean {
  return windowContains(window, review.createdAt);
}

export function buildSummaryDocument(input: SummaryBuildInput): SummaryDocument {
  const unique = dedupe(input.reviews);
  const undated = unique.filter((review) => !review.createdAt || Number.isNaN(Date.parse(review.createdAt)));
  const included = unique.filter((review) => inWindow(input.window, review));
  const extracted = included.filter((review) => review.overall !== null);
  const sentimentKnown = included.filter((review) =>
    review.overall === "positive" || review.overall === "negative" || review.overall === "mixed" || review.overall === "neutral"
  );
  const stars = included.reduce((sum, review) => sum + review.stars, 0);
  const negative = included.filter((review) => review.stars <= 3).length;
  const reviewCount = included.length;
  const topicRows = countCodes(included, "topics").map(([code, reviews]) => ({
    code,
    label: labelFor(code),
    reviews,
    share: share(reviews, reviewCount),
  }));
  const issueRows = countCodes(included, "issues").map(([code, reviews]) => ({
    code,
    label: labelFor(code),
    reviews,
    share: share(reviews, reviewCount),
  }));
  const praiseRows = countCodes(included, "praise").map(([code, reviews]) => ({
    code,
    label: labelFor(code),
    reviews,
  }));
  const months = new Map<string, number>();
  for (const review of included) {
    if (!review.createdAt) continue;
    const month = summaryMonth(review.createdAt, input.window.timezone);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  const byLocation = new Map<string, { count: number; stars: number }>();
  for (const locationId of input.locationIds) byLocation.set(locationId, { count: 0, stars: 0 });
  for (const review of included) {
    const row = byLocation.get(review.locationId) ?? { count: 0, stars: 0 };
    row.count += 1;
    row.stars += review.stars;
    byLocation.set(review.locationId, row);
  }
  const clusterIds = new Set<string>();
  let memberReviewCount = 0;
  for (const review of included) {
    const ids = review.clusterIds ?? [];
    if (ids.length > 0) memberReviewCount += 1;
    for (const id of ids) clusterIds.add(id);
  }
  const complaintEvidence: SummaryDocument["evidence"] = [];
  const praiseEvidence: SummaryDocument["evidence"] = [];
  for (const review of included) {
    for (const excerpt of review.excerpts) {
      if (!excerpt.text.trim()) continue;
      const bucket = excerpt.polarity === "complaint" ? complaintEvidence : praiseEvidence;
      if (bucket.length >= 12) continue;
      if (bucket.some((item) => item.reviewId === review.id && item.topicCode === excerpt.topicCode)) continue;
      bucket.push({
        reviewId: review.id,
        excerpt: excerpt.text.slice(0, 240),
        topicCode: excerpt.topicCode,
        polarity: excerpt.polarity,
      });
    }
    for (const aspect of review.aspects ?? []) {
      if (aspect.polarity === "neutral" || !aspect.phrase.trim()) continue;
      const bucket = aspect.polarity === "complaint" ? complaintEvidence : praiseEvidence;
      if (bucket.length >= 12) continue;
      if (bucket.some((item) => item.reviewId === review.id && item.topicCode === aspect.topicCode)) continue;
      bucket.push({
        reviewId: review.id,
        excerpt: aspect.phrase.slice(0, 240),
        topicCode: aspect.topicCode,
        polarity: aspect.polarity,
      });
    }
  }
  const evidence = [...complaintEvidence, ...praiseEvidence];
  const previousIncluded = dedupe(input.previousReviews ?? []).filter((review) => {
    if (!input.window.comparison || !review.createdAt) return false;
    const time = Date.parse(review.createdAt);
    return time >= Date.parse(input.window.comparison.start) && time < Date.parse(input.window.comparison.end);
  });
  const previousStars = previousIncluded.reduce((sum, review) => sum + review.stars, 0);
  const previousAverage = average(previousStars, previousIncluded.length);
  const currentAverage = average(stars, reviewCount);
  const changes =
    input.window.comparison === null
      ? null
      : {
          previousStart: input.window.comparison.start,
          previousEnd: input.window.comparison.end,
          previousReviewCount: previousIncluded.length,
          reviewCountDelta: reviewCount - previousIncluded.length,
          averageRatingDelta:
            currentAverage === null || previousAverage === null ? null : round(currentAverage - previousAverage),
        };
  const sentiment = {
    denominator: sentimentKnown.length,
    positive: included.filter((review) => review.overall === "positive").length,
    negative: included.filter((review) => review.overall === "negative").length,
    mixed: included.filter((review) => review.overall === "mixed").length,
    neutral: included.filter((review) => review.overall === "neutral").length,
    unknown: included.filter((review) => review.overall === "unknown").length,
  };
  return {
    analysisVersion: SUMMARY_ANALYSIS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    promptVersion: SUMMARY_PROMPT_VERSION,
    model: "none",
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    range: input.window,
    coverage: {
      reviewCount,
      undatedCount: undated.length,
      extractedCount: extracted.length,
      unextractedCount: included.length - extracted.length,
      locationCount: input.locationIds.length,
    },
    metrics: {
      averageRating: currentAverage,
      negativeShare: share(negative, reviewCount),
      ratingDenominator: reviewCount,
    },
    sentiment,
    topics: topicRows,
    issues: issueRows,
    praise: praiseRows,
    months: [...months.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    changes,
    locations: [...byLocation.entries()]
      .map(([locationId, row]) => ({
        locationId,
        reviewCount: row.count,
        averageRating: average(row.stars, row.count),
      }))
      .sort((a, b) => b.reviewCount - a.reviewCount || a.locationId.localeCompare(b.locationId)),
    clusters: { clusterCount: clusterIds.size, memberReviewCount },
    evidence,
    metricKeys: ["review_count", "average_rating", "negative_share"],
    sourceHash: summarySourceHash(included),
  };
}

export function summaryNarrative(document: SummaryDocument): string {
  if (document.coverage.reviewCount === 0) {
    const undated = document.coverage.undatedCount;
    return undated > 0
      ? `No dated reviews in this window. ${undated} reviews have no review date and are not in the count.`
      : "No reviews in this window.";
  }
  const average = document.metrics.averageRating === null ? "no average" : document.metrics.averageRating.toFixed(2);
  const topIssue = document.issues[0];
  const issueText = topIssue
    ? ` The most frequent complaint topic is ${topIssue.label}, in ${topIssue.reviews} of ${document.coverage.reviewCount} reviews.`
    : "";
  const changeText =
    document.changes === null
      ? ""
      : ` Compared with the previous window of the same length, the review count changed by ${document.changes.reviewCountDelta}.`;
  return `${document.coverage.reviewCount} reviews. Average rating ${average}, from the sum of stars divided by that count.${issueText}${changeText}`;
}

export function summaryIdentityFor(
  scope: {
    workspaceId: string;
    scopeType: IntelligenceScopeType;
    scopeId: string;
    membershipHash: string;
  },
  window: SummaryWindow
): SummaryIdentity {
  return {
    workspaceId: scope.workspaceId,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    rangeKind: window.kind,
    rangeStart: window.start,
    rangeEnd: window.end,
    timezone: window.timezone,
    analysisVersion: SUMMARY_ANALYSIS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    promptVersion: SUMMARY_PROMPT_VERSION,
    membershipHash: scope.membershipHash,
  };
}

export function summaryReuse(
  existing: { status: string; sourceHash: string; scopeRetiredAt?: string | null } | null,
  sourceHash: string
): "reuse" | "refresh" {
  if (!existing || existing.scopeRetiredAt) return "refresh";
  if (existing.status === "ready" && existing.sourceHash === sourceHash) return "reuse";
  return "refresh";
}

export function beginSummaryJob(
  open: readonly { sourceHash: string; status: string }[],
  sourceHash: string
): "start" | "reuse" {
  const match = open.find((job) => job.sourceHash === sourceHash && (job.status === "queued" || job.status === "running"));
  return match ? "reuse" : "start";
}

export interface StoredSummaryRef {
  id: string;
  locationId: string | null;
  memberLocationIds: readonly string[];
  rangeKind: "all" | "bounded";
  rangeStart: string | null;
  rangeEnd: string | null;
  membershipHash: string;
  status: string;
}

export function reviewTouchesSummary(
  summary: StoredSummaryRef,
  review: { locationId: string; createdAt: string | null; previousCreatedAt?: string | null }
): boolean {
  const inScope = summary.locationId === review.locationId || summary.memberLocationIds.includes(review.locationId);
  if (!inScope || summary.status === "stale") return false;
  const times = [review.createdAt, review.previousCreatedAt ?? null];
  if (times.every((time) => !time)) return summary.rangeKind === "all";
  return times.some((time) =>
    windowContains({ kind: summary.rangeKind, start: summary.rangeStart, end: summary.rangeEnd }, time)
  );
}

export function staleForMembership(
  summaries: readonly StoredSummaryRef[],
  currentLocationIds: readonly string[]
): string[] {
  const next = membershipHash(currentLocationIds);
  return summaries.filter((summary) => summary.membershipHash !== next && summary.status === "ready").map((summary) => summary.id);
}

export function summaryIdentityHash(identity: SummaryIdentity): string {
  return createHash("sha256").update(summaryIdentityKey(identity)).digest("hex").slice(0, 32);
}

export type { SummaryTimezone };
