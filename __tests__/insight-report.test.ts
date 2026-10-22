import { describe, expect, it } from "vitest";
import {
  assembleInsights,
  buildEvidenceItems,
  computeReportCacheKey,
  computeScopeDataFingerprint,
  decideReportAction,
  normaliseLocationIds,
  parseSynthesisResponse,
  reportRangeMatches,
  type SampleObservation,
} from "@/lib/insight-report";
import type { ObservationAggregates, ObservationRow } from "@/lib/review-intelligence";

const baseKeyInput = {
  workspaceId: "ws1",
  clientId: "client1",
  groupId: null,
  locationId: null,
  locationIds: ["loc-b", "loc-a"],
  rangeStart: "2026-07-01T00:00:00Z",
  rangeEnd: "2026-10-01T00:00:00Z",
  model: "gemini-test",
};

describe("report cache identity", () => {
  it("is stable for identical filters and normalised scope order", () => {
    const a = computeReportCacheKey(baseKeyInput);
    const b = computeReportCacheKey({ ...baseKeyInput, locationIds: ["loc-a", "loc-b", "loc-a"] });
    expect(a).toBe(b);
    expect(normaliseLocationIds(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("changes when the date range, scope, or model changes", () => {
    const a = computeReportCacheKey(baseKeyInput);
    expect(computeReportCacheKey({ ...baseKeyInput, rangeEnd: "2027-01-01T00:00:00Z" })).not.toBe(a);
    expect(computeReportCacheKey({ ...baseKeyInput, clientId: "other" })).not.toBe(a);
    expect(computeReportCacheKey({ ...baseKeyInput, model: "other-model" })).not.toBe(a);
    expect(computeReportCacheKey({ ...baseKeyInput, locationIds: ["loc-a"] })).not.toBe(a);
  });

  it("is stable within a day even when preset windows resolve to different instants", () => {
    const morning = computeReportCacheKey({
      ...baseKeyInput,
      rangeStart: "2026-09-22T08:15:00Z",
    });
    const evening = computeReportCacheKey({
      ...baseKeyInput,
      rangeStart: "2026-09-22T19:45:00Z",
    });
    expect(morning).toBe(evening);
    const nextDay = computeReportCacheKey({
      ...baseKeyInput,
      rangeStart: "2026-09-23T00:05:00Z",
    });
    expect(nextDay).not.toBe(morning);
  });

  it("gives an expanded six-month range a different identity from the three-month one", () => {
    const threeMonth = computeReportCacheKey(baseKeyInput);
    const sixMonth = computeReportCacheKey({
      ...baseKeyInput,
      rangeStart: "2026-04-01T00:00:00Z",
    });
    expect(sixMonth).not.toBe(threeMonth);
  });
});

describe("reportRangeMatches (preset drift fallback)", () => {
  it("matches a rolling preset window that drifted by days or weeks", () => {
    const stored = { rangeStart: "2026-04-22T09:22:42Z", rangeEnd: null };
    expect(reportRangeMatches(stored, { rangeStart: "2026-04-22T21:05:00Z", rangeEnd: null })).toBe(true);
    expect(reportRangeMatches(stored, { rangeStart: "2026-05-10T00:00:00Z", rangeEnd: null })).toBe(true);
  });

  it("never confuses adjacent presets", () => {
    const sixMonth = { rangeStart: "2026-04-22T00:00:00Z", rangeEnd: null };
    // 3 months later is the 3m window, not a drifted 6m one.
    expect(reportRangeMatches(sixMonth, { rangeStart: "2026-07-22T00:00:00Z", rangeEnd: null })).toBe(false);
  });

  it("keeps all-time and custom windows strict", () => {
    expect(reportRangeMatches({ rangeStart: null, rangeEnd: null }, { rangeStart: null, rangeEnd: null })).toBe(true);
    expect(reportRangeMatches({ rangeStart: null, rangeEnd: null }, { rangeStart: "2026-04-22T00:00:00Z", rangeEnd: null })).toBe(false);
    expect(
      reportRangeMatches(
        { rangeStart: "2026-01-01T00:00:00Z", rangeEnd: "2026-04-01T00:00:00Z" },
        { rangeStart: "2026-01-05T00:00:00Z", rangeEnd: "2026-04-02T00:00:00Z" }
      )
    ).toBe(false);
  });
});

describe("scope data fingerprint", () => {
  const threeMonths = [
    { reviewId: "r1", fingerprint: "f1" },
    { reviewId: "r2", fingerprint: "f2" },
  ];

  it("is stable regardless of entry order", () => {
    expect(computeScopeDataFingerprint(threeMonths, 0)).toBe(
      computeScopeDataFingerprint([...threeMonths].reverse(), 0)
    );
  });

  it("changes when a review is added, edited, or newly failed", () => {
    const base = computeScopeDataFingerprint(threeMonths, 0);
    expect(
      computeScopeDataFingerprint([...threeMonths, { reviewId: "r3", fingerprint: "f3" }], 0)
    ).not.toBe(base);
    expect(
      computeScopeDataFingerprint(
        threeMonths.map((e) => (e.reviewId === "r1" ? { ...e, fingerprint: "changed" } : e)),
        0
      )
    ).not.toBe(base);
    expect(computeScopeDataFingerprint(threeMonths, 1)).not.toBe(base);
  });

  it("covers the union for overlapping ranges without double-counting a review", () => {
    const sixMonths = [
      ...threeMonths,
      { reviewId: "r0", fingerprint: "f0" },
    ];
    const fp6 = computeScopeDataFingerprint(sixMonths, 0);
    const fp3 = computeScopeDataFingerprint(threeMonths, 0);
    expect(fp6).not.toBe(fp3);
    // The same review appearing in both windows is one set entry, not two.
    const withDuplicate = computeScopeDataFingerprint(
      [...sixMonths, { reviewId: "r1", fingerprint: "f1" }],
      0
    );
    expect(withDuplicate).not.toBe(fp6); // duplicates are visible, never silently merged by the hash
    expect(new Set(sixMonths.map((e) => e.reviewId)).size).toBe(3);
  });
});

describe("decideReportAction (cache + concurrency)", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("generates when no report exists", () => {
    expect(decideReportAction(null, "fp1", now)).toBe("generate");
  });

  it("reuses a completed report only when the data fingerprint still matches", () => {
    const existing = { status: "completed", dataFingerprint: "fp1", updatedAt: "2026-10-20T10:00:00Z" };
    expect(decideReportAction(existing, "fp1", now)).toBe("reuse");
    expect(decideReportAction(existing, "fp2-changed-data", now)).toBe("generate");
  });

  it("never presents a partial report as current when data changed", () => {
    const existing = { status: "partial", dataFingerprint: "old", updatedAt: "2026-10-20T10:00:00Z" };
    expect(decideReportAction(existing, "new", now)).toBe("generate");
  });

  it("waits for a fresh in-progress job instead of starting a duplicate", () => {
    const running = { status: "processing", dataFingerprint: null, updatedAt: "2026-10-22T09:58:00Z" };
    expect(decideReportAction(running, "fp1", now)).toBe("wait");
  });

  it("takes over a stale in-progress job (crashed generator)", () => {
    const stale = { status: "processing", dataFingerprint: null, updatedAt: "2026-10-22T08:00:00Z" };
    expect(decideReportAction(stale, "fp1", now)).toBe("generate");
  });

  it("regenerates after failure", () => {
    const failed = { status: "failed", dataFingerprint: null, updatedAt: "2026-10-22T09:59:00Z" };
    expect(decideReportAction(failed, "fp1", now)).toBe("generate");
  });
});

function row(partial: Partial<ObservationRow>): ObservationRow {
  return {
    reviewId: "r1",
    locationId: "loc1",
    clientId: null,
    groupId: null,
    reviewCreateTime: "2026-09-10T10:00:00Z",
    starRating: 5,
    topic: "cleanliness",
    subtopic: null,
    sentiment: "negative",
    detail: "Cockroach near the trial room.",
    entityType: "facility",
    entityName: null,
    severity: 5,
    severityRationale: "pest alleged",
    evidenceExcerpt: "found a cockroach near the trial room",
    evidenceStart: 0,
    evidenceEnd: 10,
    basis: "fact",
    confidence: 0.9,
    isAmbiguous: false,
    dedupeKey: "k",
    ...partial,
  } as ObservationRow;
}

function aggregates(partial: Partial<ObservationAggregates>): ObservationAggregates {
  return {
    reviewsAnalysed: 100,
    observations: 150,
    positive: [{ topic: "staff", count: 30, reviews: 25 }],
    negative: [{ topic: "billing", count: 20, reviews: 18 }],
    severeIncidents: [],
    staffPraise: [{ name: "Arun", count: 6 }],
    staffComplaints: [],
    byOutlet: [{ locationId: "loc1", positive: 40, negative: 10, severe: 1 }],
    outletReviews: { loc1: 60 },
    byMonth: [{ month: "2026-09", positive: 10, negative: 4 }],
    topicRelationships: [{ pair: ["billing", "staff"], reviews: 7 }],
    firstSeenByTopic: {},
    ...partial,
  };
}

const samples: SampleObservation[] = [
  {
    reviewId: "r9",
    locationId: "loc1",
    topic: "billing",
    sentiment: "negative",
    entityType: null,
    entityName: null,
    severity: 4,
    evidenceExcerpt: "they charged me twice",
  },
];

describe("buildEvidenceItems", () => {
  it("keeps positive and negative evidence in separate items", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({}),
      previous: null,
      previousEligible: 0,
      samples,
      outletNames: { loc1: "Fazyo Sultanpet" },
    });
    const positive = items.filter((i) => i.sentiment === "positive");
    const negative = items.filter((i) => i.sentiment === "negative");
    expect(positive.length).toBeGreaterThan(0);
    expect(negative.length).toBeGreaterThan(0);
    expect(positive.every((i) => !i.key.includes("negative"))).toBe(true);
    const billing = items.find((i) => i.key === "topic:negative:billing");
    expect(billing?.supportingReviews).toBe(18);
    expect(billing?.denominator).toBe(100);
    expect(billing?.evidenceReviewIds).toEqual(["r9"]);
  });

  it("includes a one-off serious incident despite frequency of one", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({ severeIncidents: [row({})] }),
      previous: null,
      previousEligible: 0,
      samples: [],
      outletNames: {},
    });
    const severe = items.find((i) => i.category === "serious_incident");
    expect(severe?.supportingReviews).toBe(1);
    expect(severe?.statLine).toContain("Single reported incident");
    expect(severe?.limitations.join(" ")).toContain("verification");
  });

  it("requires enough previous-period coverage before claiming trends", () => {
    const noTrend = buildEvidenceItems({
      aggregates: aggregates({}),
      previous: aggregates({ reviewsAnalysed: 4 }),
      previousEligible: 4,
      samples: [],
      outletNames: {},
    });
    expect(noTrend.some((i) => i.category === "trend")).toBe(false);

    const withTrend = buildEvidenceItems({
      aggregates: aggregates({ negative: [{ topic: "billing", count: 40, reviews: 35 }] }),
      previous: aggregates({ reviewsAnalysed: 100, negative: [{ topic: "billing", count: 10, reviews: 9 }] }),
      previousEligible: 100,
      samples: [],
      outletNames: {},
    });
    const trend = withTrend.find((i) => i.category === "trend");
    expect(trend?.statLine).toContain("vs 9 in the previous equivalent period");
    expect(trend?.statLine).toContain("not causation");
  });

  it("skips tiny outlets and caveats small ones", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({
        byOutlet: [
          { locationId: "tiny", positive: 2, negative: 0, severe: 0 },
          { locationId: "small", positive: 3, negative: 6, severe: 0 },
        ],
        outletReviews: { tiny: 3, small: 8 },
      }),
      previous: null,
      previousEligible: 0,
      samples: [],
      outletNames: {},
    });
    const outlets = items.filter((i) => i.category === "outlet_comparison");
    expect(outlets.map((o) => o.key)).toEqual(["outlet:small"]);
    expect(outlets[0]?.limitations.join(" ")).toContain("Small sample");
  });

  it("only builds relationships within one sentiment, never mixed", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({
        topicRelationships: [
          { pair: ["billing", "staff"], reviews: 7 }, // billing negative, staff positive here
        ],
      }),
      previous: null,
      previousEligible: 0,
      samples: [],
      outletNames: {},
    });
    expect(items.some((i) => i.category === "relationship")).toBe(false);
  });
});

describe("assembleInsights", () => {
  const items = buildEvidenceItems({
    aggregates: aggregates({}),
    previous: null,
    previousEligible: 0,
    samples,
    outletNames: { loc1: "Fazyo Sultanpet" },
  });

  it("drops prose for evidence keys that do not exist and keeps database counts", () => {
    const parsed = parseSynthesisResponse(
      JSON.stringify({
        insights: [
          { key: "topic:negative:billing", title: "Billing problems", detail: "Customers report double charges.", importance: 4, suggestedAction: "Audit billing.", confidence: 0.8 },
          { key: "invented:key", title: "Fake", detail: "Made up.", importance: 5 },
        ],
      })
    );
    const insights = assembleInsights(items, parsed, "cachekey");
    expect(insights.some((i) => i.title === "Fake")).toBe(false);
    const billing = insights.find((i) => i.category === "recurring_issue");
    expect(billing?.supportingReviews).toBe(18);
    expect(billing?.denominator).toBe(100);
    expect(billing?.calculation).toContain("÷ analysed written reviews");
    expect(billing?.id).toBeTruthy();
  });

  it("falls back to the factual stat line when the model omits an item, losing no evidence", () => {
    const insights = assembleInsights(items, parseSynthesisResponse("garbage"), "cachekey");
    expect(insights.length).toBe(items.length);
    expect(insights.every((i) => i.detail.length > 0)).toBe(true);
  });
});

describe("buildEvidenceItems: one incident is not retold", () => {
  const severeStaffSample: SampleObservation = {
    reviewId: "r1", locationId: "loc1", topic: "staff", sentiment: "negative",
    entityType: "staff", entityName: "Shop Owner", severity: 4,
    evidenceExcerpt: "pressured us to buy the dress",
  };

  it("drops a staff complaint whose every sample is already a severe incident", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({ staffComplaints: [{ name: "Shop Owner", count: 1 }], severeIncidents: [row({ reviewId: "r1" })] }),
      previous: null, previousEligible: 0,
      samples: [severeStaffSample],
      outletNames: { loc1: "Fazyo Sultanpet" },
    });
    expect(items.some((i) => i.key === "staff:negative:shop owner")).toBe(false);
  });

  it("keeps a staff complaint that also has non-severe evidence", () => {
    const items = buildEvidenceItems({
      aggregates: aggregates({ staffComplaints: [{ name: "Asha", count: 2 }] }),
      previous: null, previousEligible: 0,
      samples: [
        { ...severeStaffSample, entityName: "Asha", evidenceExcerpt: "Asha forced billing." },
        { ...severeStaffSample, reviewId: "r5", entityName: "Asha", severity: null, evidenceExcerpt: "Asha was abrupt at billing." },
      ],
      outletNames: { loc1: "Fazyo Sultanpet" },
    });
    expect(items.some((i) => i.key === "staff:negative:asha")).toBe(true);
  });
});
