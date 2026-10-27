import type { ObservationAggregates, TopicCount } from "@/lib/review-intelligence";

/**
 * Months for the Insights sentiment trend in the selected range.
 * All-time must keep every bucket — never silently take latest-N.
 */
export function insightTrendMonths(
  byMonth: ObservationAggregates["byMonth"]
): ObservationAggregates["byMonth"] {
  return [...byMonth].sort((a, b) => a.month.localeCompare(b.month));
}

export interface InsightScopeCounts {
  discovered: number;
  eligible: number;
  alreadyAnalysed: number;
  ratingOnly: number;
  pending: number;
  failed: number;
}

export interface InsightSevereIncident {
  reviewId: string;
  severity: number | null;
  starRating: number;
  reviewCreateTime: string;
  evidenceExcerpt: string;
  severityRationale: string | null;
}

export interface InsightDashboardData {
  counts: InsightScopeCounts;
  aggregates: ObservationAggregates & { storedObservations: number };
  severeCount: number;
  severeIncidents: InsightSevereIncident[];
}

const EMPTY_COUNTS: InsightScopeCounts = {
  discovered: 0,
  eligible: 0,
  alreadyAnalysed: 0,
  ratingOnly: 0,
  pending: 0,
  failed: 0,
};

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

/** Display label for an insight topic id such as `wait_time`. */
export function insightTopicLabel(topic: string): string {
  const text = topic.replace(/_/g, " ").trim();
  if (!text) return topic;
  return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function topics(value: unknown): TopicCount[] {
  return rows(value).flatMap((row) => {
    if (typeof row.topic !== "string" || row.topic.length === 0) return [];
    return [{ topic: row.topic, count: num(row.count), reviews: num(row.reviews) }];
  });
}

function staff(value: unknown): Array<{ name: string; count: number }> {
  return rows(value).flatMap((row) => {
    if (typeof row.name !== "string" || row.name.trim().length === 0) return [];
    return [{ name: row.name, count: num(row.count) }];
  });
}

/** Turns the `grm_insight_dashboard` JSON into the shape the insights page renders. */
export function parseInsightDashboard(raw: unknown): InsightDashboardData {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const countsRaw =
    body.counts && typeof body.counts === "object" ? (body.counts as Record<string, unknown>) : {};
  const counts: InsightScopeCounts = {
    discovered: num(countsRaw.discovered),
    eligible: num(countsRaw.eligible),
    alreadyAnalysed: num(countsRaw.alreadyAnalysed),
    ratingOnly: num(countsRaw.ratingOnly),
    pending: num(countsRaw.pending),
    failed: num(countsRaw.failed),
  };
  const byMonth = rows(body.byMonth).flatMap((row) => {
    if (typeof row.month !== "string" || !/^\d{4}-\d{2}$/.test(row.month)) return [];
    return [{ month: row.month, positive: num(row.positive), negative: num(row.negative) }];
  });
  const byOutlet = rows(body.byOutlet).flatMap((row) => {
    const locationId = row.locationId;
    if (typeof locationId !== "string" || locationId.length === 0) return [];
    return [
      {
        locationId,
        positive: num(row.positive),
        negative: num(row.negative),
        severe: num(row.severe),
      },
    ];
  });
  const outletReviews: Record<string, number> = {};
  if (body.outletReviews && typeof body.outletReviews === "object" && !Array.isArray(body.outletReviews)) {
    for (const [locationId, value] of Object.entries(body.outletReviews as Record<string, unknown>)) {
      outletReviews[locationId] = num(value);
    }
  }
  const severeIncidents = rows(body.severeIncidents).flatMap((row) => {
    if (typeof row.reviewId !== "string" || typeof row.evidenceExcerpt !== "string") return [];
    return [
      {
        reviewId: row.reviewId,
        severity: row.severity == null ? null : num(row.severity),
        starRating: num(row.starRating),
        reviewCreateTime: typeof row.reviewCreateTime === "string" ? row.reviewCreateTime : "",
        evidenceExcerpt: row.evidenceExcerpt,
        severityRationale: typeof row.severityRationale === "string" ? row.severityRationale : null,
      },
    ];
  });
  const storedObservations = num(body.storedObservations);
  const aggregates: ObservationAggregates & { storedObservations: number } = {
    reviewsAnalysed: num(body.reviewsAnalysed),
    observations: storedObservations,
    storedObservations,
    positive: topics(body.positive),
    negative: topics(body.negative),
    severeIncidents: [],
    staffPraise: staff(body.staffPraise),
    staffComplaints: staff(body.staffComplaints),
    byOutlet,
    outletReviews,
    byMonth,
    topicRelationships: [],
    firstSeenByTopic: {},
  };
  return {
    counts: { ...EMPTY_COUNTS, ...counts },
    aggregates,
    severeCount: num(body.severeCount),
    severeIncidents,
  };
}

export function emptyInsightDashboard(): InsightDashboardData {
  return parseInsightDashboard({
    counts: EMPTY_COUNTS,
    reviewsAnalysed: 0,
    storedObservations: 0,
    severeCount: 0,
    positive: [],
    negative: [],
    byMonth: [],
    byOutlet: [],
    outletReviews: {},
    staffPraise: [],
    staffComplaints: [],
    severeIncidents: [],
  });
}
