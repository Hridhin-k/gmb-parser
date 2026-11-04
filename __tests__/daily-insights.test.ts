import { describe, expect, it } from "vitest";
import { buildDailySummary, combineDailySummaries, dailySourceFingerprint, emptyCoverage, representativeSamples, type DailySource } from "@/lib/daily-insights";
import { aggregateObservations, type ObservationRow } from "@/lib/review-intelligence";

function observation(reviewId: string, topic: string, day = "2026-11-01", overrides: Partial<ObservationRow> = {}): ObservationRow {
  return { reviewId, locationId: "location-a", clientId: null, groupId: null, reviewCreateTime: `${day}T10:00:00Z`,
    starRating: 2, topic, subtopic: null, sentiment: "negative", detail: "Waited a long time", entityType: null,
    entityName: null, severity: 2, severityRationale: null, evidenceExcerpt: "Waited a long time", evidenceStart: null,
    evidenceEnd: null, basis: "fact", confidence: 0.9, isAmbiguous: false, dedupeKey: `${reviewId}:${topic}`, ...overrides };
}

describe("daily summary rollups", () => {
  it("matches aggregation of all observations across disjoint days and locations", () => {
    const rows = [observation("r1", "queue"), observation("r1", "staff"), observation("r2", "queue", "2026-11-02"),
      observation("r2", "staff", "2026-11-02"), observation("r3", "quality", "2026-11-02", { locationId: "location-b", sentiment: "positive" })];
    const partitions = [rows.slice(0, 2), rows.slice(2, 4), rows.slice(4)];
    const summaries = partitions.map((part) => buildDailySummary(part, { ...emptyCoverage(), discovered: 1, eligible: 1, analysed: 1 }));
    const combined = combineDailySummaries(summaries);
    expect(combined.aggregates).toEqual(aggregateObservations(rows));
    expect(combined.coverage.analysed).toBe(3);
  });

  it("preserves singleton topic pairs until they recur across different days", () => {
    const a = buildDailySummary([observation("r1", "queue"), observation("r1", "staff")], { ...emptyCoverage(), analysed: 1 });
    const b = buildDailySummary([observation("r2", "queue", "2026-11-02"), observation("r2", "staff", "2026-11-02")], { ...emptyCoverage(), analysed: 1 });
    expect(a.aggregates.topicRelationships[0]?.reviews).toBe(1);
    expect(combineDailySummaries([a, b]).aggregates.topicRelationships).toEqual([{ pair: ["queue", "staff"], reviews: 2 }]);
  });

  it("includes analysed written reviews with no observations in the denominator", () => {
    const summary = buildDailySummary([observation("r1", "queue")], { ...emptyCoverage(), discovered: 4, eligible: 3, analysed: 2, pending: 1, ratingOnly: 1 });
    expect(summary.aggregates.reviewsAnalysed).toBe(2);
    expect(summary.aggregates.negative[0]?.reviews).toBe(1);
    expect(combineDailySummaries([summary]).coverage).toEqual(summary.coverage);
  });

  it("keeps severe incidents independent of how often their topic occurs", () => {
    const incident = observation("critical", "safety", "2026-11-02", { severity: 5, evidenceExcerpt: "Threatened me", basis: "fact" });
    const summary = buildDailySummary([incident], { ...emptyCoverage(), analysed: 1 });
    expect(combineDailySummaries([summary]).aggregates.severeIncidents.map((r) => r.reviewId)).toContain("critical");
  });

  it("merges names case-insensitively and sums ratings rather than averages", () => {
    const a = buildDailySummary([observation("r1", "staff", "2026-11-01", { entityType: "staff", entityName: "anjali", sentiment: "positive" })],
      { ...emptyCoverage(), discovered: 1, ratingSum: 5, starCounts: [0, 0, 0, 0, 1] });
    const b = buildDailySummary([observation("r2", "staff", "2026-11-02", { entityType: "staff", entityName: "Anjali", sentiment: "positive" })],
      { ...emptyCoverage(), discovered: 3, ratingSum: 3, starCounts: [3, 0, 0, 0, 0] });
    const combined = combineDailySummaries([a, b]);
    expect(combined.aggregates.staffPraise).toEqual([{ name: "Anjali", count: 2 }]);
    expect(combined.coverage.ratingSum / combined.coverage.discovered).toBe(2);
    expect(combined.coverage.starCounts).toEqual([3, 0, 0, 0, 1]);
  });

  it("keeps examples of ordinary feedback alongside severe incidents", () => {
    const rows = [1, 2, 3, 4].map((i) => observation(`severe-${i}`, "queue", undefined, { severity: 5 }));
    rows.push(observation("ordinary", "queue"));
    expect(representativeSamples(rows).map((r) => r.reviewId)).toContain("ordinary");
  });

  it("versions fingerprints by exact day, revision, location and boundary fragments", () => {
    const source: DailySource = { locationId: "a", day: "2026-11-01", timezone: "Asia/Kolkata", revision: 1, start: "2026-10-31T18:30:00Z", end: "2026-11-01T18:30:00Z" };
    const next = { ...source, day: "2026-11-02" };
    expect(dailySourceFingerprint([source, next])).toBe(dailySourceFingerprint([next, source]));
    for (const changed of [{ revision: 2 }, { locationId: "b" }, { timezone: "UTC" }, { start: "2026-11-01T10:00:00Z" }]) {
      expect(dailySourceFingerprint([{ ...source, ...changed }])).not.toBe(dailySourceFingerprint([source]));
    }
    expect(dailySourceFingerprint([{ ...source, fragmentFingerprint: "same-reviews" }])).toBe(
      dailySourceFingerprint([{ ...source, start: "2026-11-01T10:00:00Z", fragmentFingerprint: "same-reviews" }])
    );
  });
});
