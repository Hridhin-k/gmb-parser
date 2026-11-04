import { createHash } from "node:crypto";
import { ANALYSIS_VERSION, aggregateObservations, type ObservationAggregates, type ObservationRow } from "@/lib/review-intelligence";
import type { SampleObservation } from "@/lib/insight-report";

export const DAILY_SUMMARY_VERSION = 1;

export interface DailyCoverage {
  discovered: number;
  eligible: number;
  analysed: number;
  ratingOnly: number;
  failed: number;
  pending: number;
  ratingSum: number;
  starCounts: number[];
}

export interface DailySummary {
  coverage: DailyCoverage;
  aggregates: ObservationAggregates;
  samples: SampleObservation[];
}

export interface DailySource {
  locationId: string;
  day: string;
  timezone: string;
  revision: number;
  start: string;
  end: string;
  fragmentFingerprint?: string;
}

export function emptyCoverage(): DailyCoverage {
  return { discovered: 0, eligible: 0, analysed: 0, ratingOnly: 0, failed: 0, pending: 0, ratingSum: 0, starCounts: [0, 0, 0, 0, 0] };
}

/** Keep examples per theme AND per named staff member, rather than a global
 * severity-only sample that could hide ordinary praise behind one incident. */
export function representativeSamples(rows: SampleObservation[], perGroup = 3): SampleObservation[] {
  const groups = new Map<string, SampleObservation[]>();
  for (const row of [...rows].sort((a, b) => Number((a.severity ?? 0) >= 4) - Number((b.severity ?? 0) >= 4)
    || (b.severity ?? 0) - (a.severity ?? 0) || a.reviewId.localeCompare(b.reviewId))) {
    const keys = [`topic:${row.sentiment}:${row.topic}`];
    if (row.entityType === "staff" && row.entityName) keys.push(`staff:${row.sentiment}:${row.entityName.trim().toLowerCase()}`);
    for (const key of keys) {
      const group = groups.get(key) ?? [];
      if (group.length < perGroup && !group.some((s) => s.reviewId === row.reviewId)) group.push(row);
      groups.set(key, group);
    }
  }
  return [...new Map([...groups.values()].flat().map((s) => [JSON.stringify(s), s])).values()];
}

export function buildDailySummary(rows: ObservationRow[], coverage: DailyCoverage): DailySummary {
  const aggregates = aggregateObservations(rows, { retainRelationships: true });
  // Written reviews with no extracted observations still belong in denominators.
  aggregates.reviewsAnalysed = coverage.analysed;
  return {
    coverage,
    aggregates,
    samples: representativeSamples(rows),
  };
}

/** Daily/location partitions are disjoint. Sum counts, never average averages,
 * and keep one-review relationships until the entire reporting range is merged. */
export function combineDailySummaries(summaries: DailySummary[]): DailySummary {
  const coverage = emptyCoverage();
  const aggregates = aggregateObservations([]);
  const topics = { positive: new Map<string, { topic: string; count: number; reviews: number }>(), negative: new Map<string, { topic: string; count: number; reviews: number }>() };
  const staff = { staffPraise: new Map<string, { name: string; count: number }>(), staffComplaints: new Map<string, { name: string; count: number }>() };
  const outlets = new Map<string, ObservationAggregates["byOutlet"][number]>();
  const months = new Map<string, ObservationAggregates["byMonth"][number]>();
  const pairs = new Map<string, ObservationAggregates["topicRelationships"][number]>();
  for (const summary of summaries) {
    const a = summary.aggregates;
    for (const key of ["discovered", "eligible", "analysed", "ratingOnly", "failed", "pending", "ratingSum"] as const) coverage[key] += summary.coverage[key];
    coverage.starCounts = coverage.starCounts.map((n, index) => n + summary.coverage.starCounts[index]);
    aggregates.reviewsAnalysed += a.reviewsAnalysed;
    aggregates.observations += a.observations;
    for (const sentiment of ["positive", "negative"] as const) for (const row of a[sentiment]) {
      const entry = topics[sentiment].get(row.topic) ?? { topic: row.topic, count: 0, reviews: 0 };
      entry.count += row.count; entry.reviews += row.reviews;
      topics[sentiment].set(row.topic, entry);
    }
    for (const kind of ["staffPraise", "staffComplaints"] as const) for (const row of a[kind]) {
      const key = row.name.trim().replace(/\s+/g, " ").toLowerCase();
      const entry = staff[kind].get(key) ?? { name: row.name, count: 0 };
      if (entry.name === entry.name.toLowerCase() && row.name !== row.name.toLowerCase()) entry.name = row.name;
      entry.count += row.count; staff[kind].set(key, entry);
    }
    for (const row of a.byOutlet) {
      const entry = outlets.get(row.locationId) ?? { locationId: row.locationId, positive: 0, negative: 0, severe: 0 };
      entry.positive += row.positive; entry.negative += row.negative; entry.severe += row.severe;
      outlets.set(row.locationId, entry);
    }
    for (const [id, count] of Object.entries(a.outletReviews)) aggregates.outletReviews[id] = (aggregates.outletReviews[id] ?? 0) + count;
    for (const row of a.byMonth) {
      const entry = months.get(row.month) ?? { month: row.month, positive: 0, negative: 0 };
      entry.positive += row.positive; entry.negative += row.negative; months.set(row.month, entry);
    }
    for (const row of a.topicRelationships) {
      const key = JSON.stringify(row.pair);
      const entry = pairs.get(key) ?? { pair: row.pair, reviews: 0 };
      entry.reviews += row.reviews; pairs.set(key, entry);
    }
    for (const [topic, date] of Object.entries(a.firstSeenByTopic)) {
      if (!aggregates.firstSeenByTopic[topic] || date < aggregates.firstSeenByTopic[topic]) aggregates.firstSeenByTopic[topic] = date;
    }
    aggregates.severeIncidents.push(...a.severeIncidents);
  }
  for (const sentiment of ["positive", "negative"] as const) aggregates[sentiment] = [...topics[sentiment].values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  for (const kind of ["staffPraise", "staffComplaints"] as const) aggregates[kind] = [...staff[kind].values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  aggregates.byOutlet = [...outlets.values()].sort((a, b) => b.negative - a.negative || b.positive - a.positive);
  aggregates.byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  aggregates.topicRelationships = [...pairs.values()].filter((p) => p.reviews >= 2).sort((a, b) => b.reviews - a.reviews).slice(0, 20);
  aggregates.severeIncidents.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.reviewCreateTime.localeCompare(b.reviewCreateTime));
  return { coverage, aggregates, samples: representativeSamples(summaries.flatMap((s) => s.samples), 5) };
}

export function dailySourceFingerprint(sources: DailySource[]): string {
  const identities = sources.map((source) => source.fragmentFingerprint
    ? { locationId: source.locationId, day: source.day, timezone: source.timezone, fragmentFingerprint: source.fragmentFingerprint }
    : source);
  return createHash("sha256").update(JSON.stringify({ version: DAILY_SUMMARY_VERSION, analysisVersion: ANALYSIS_VERSION,
    sources: identities.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })).digest("hex");
}
