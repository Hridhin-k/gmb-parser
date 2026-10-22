import { describe, expect, it } from "vitest";
import {
  aggregateObservations,
  dedupeObservations,
  isSevereIncident,
  parseExtractionResponse,
  validateObservations,
  type ObservationRow,
} from "@/lib/review-intelligence";

const COMMENT =
  "Staff member Arun was very helpful and the shirt quality is excellent. But billing took 30 minutes and they charged me twice for one shirt.";

function rawExtraction() {
  return [
    {
      topic: "staff",
      subtopic: "helpful staff",
      sentiment: "positive",
      detail: "Arun was helpful.",
      entityType: "staff",
      entityName: "Arun",
      evidenceExcerpt: "Staff member Arun was very helpful",
      confidence: 0.95,
    },
    {
      topic: "product_quality",
      subtopic: "shirt quality",
      sentiment: "positive",
      detail: "The shirt quality is excellent.",
      entityType: "clothing_category",
      entityName: "shirt",
      evidenceExcerpt: "the shirt quality is excellent",
      confidence: 0.9,
    },
    {
      topic: "billing",
      subtopic: "double charge",
      sentiment: "negative",
      detail: "Charged twice for one shirt after a long billing wait.",
      entityType: "billing",
      entityName: null,
      severity: 4,
      severityRationale: "double charge",
      evidenceExcerpt: "they charged me twice for one shirt",
      confidence: 0.85,
    },
  ];
}

function row(partial: Partial<ObservationRow>): ObservationRow {
  return {
    reviewId: "r1",
    locationId: "loc1",
    clientId: "c1",
    groupId: null,
    reviewCreateTime: "2026-09-10T10:00:00Z",
    starRating: 3,
    topic: "staff",
    subtopic: null,
    sentiment: "positive",
    detail: "point",
    entityType: null,
    entityName: null,
    severity: null,
    severityRationale: null,
    evidenceExcerpt: "quote",
    evidenceStart: 0,
    evidenceEnd: 5,
    basis: "fact",
    confidence: 0.9,
    isAmbiguous: false,
    dedupeKey: Math.random().toString(36).slice(2),
    ...partial,
  };
}

describe("validateObservations", () => {
  it("keeps praise and complaints from one review as separate observations", () => {
    const observations = validateObservations(rawExtraction(), COMMENT);
    expect(observations).toHaveLength(3);
    expect(observations.filter((o) => o.sentiment === "positive")).toHaveLength(2);
    expect(observations.filter((o) => o.sentiment === "negative")).toHaveLength(1);
    const billing = observations.find((o) => o.topic === "billing");
    expect(billing?.severity).toBe(4);
    expect(billing?.evidenceExcerpt).toBe("they charged me twice for one shirt");
    expect(COMMENT).toContain(billing!.evidenceExcerpt);
  });

  it("drops observations whose evidence is not in the original review", () => {
    const observations = validateObservations(
      [
        {
          topic: "staff",
          sentiment: "negative",
          detail: "Staff were rude.",
          evidenceExcerpt: "the manager shouted at us",
          confidence: 0.9,
        },
      ],
      COMMENT
    );
    expect(observations).toHaveLength(0);
  });

  it("clears severity on positive observations", () => {
    const observations = validateObservations(
      [
        {
          topic: "staff",
          sentiment: "positive",
          detail: "Helpful.",
          severity: 5,
          evidenceExcerpt: "Staff member Arun was very helpful",
        },
      ],
      COMMENT
    );
    expect(observations[0]?.severity).toBeNull();
  });
});

describe("idempotent reprocessing", () => {
  it("dedupes identical observations so a retry stores no copies", () => {
    const once = validateObservations(rawExtraction(), COMMENT);
    const twice = validateObservations([...rawExtraction(), ...rawExtraction()], COMMENT);
    expect(twice).toHaveLength(once.length);
    expect(dedupeObservations([...once, ...once])).toHaveLength(once.length);
    expect(new Set(twice.map((o) => o.dedupeKey)).size).toBe(twice.length);
  });
});

describe("severe one-off incidents", () => {
  it("flags a single severe complaint instead of filtering it by frequency", () => {
    expect(
      isSevereIncident({ sentiment: "negative", severity: 5, evidenceExcerpt: "found a cockroach in the trial room", starRating: 1 })
    ).toBe(true);
    expect(
      isSevereIncident({ sentiment: "negative", severity: null, evidenceExcerpt: "I got sick after the visit and went to hospital", starRating: 1 })
    ).toBe(true);
    expect(
      isSevereIncident({ sentiment: "negative", severity: 2, evidenceExcerpt: "billing took long", starRating: 2 })
    ).toBe(false);

    const aggregates = aggregateObservations([
      row({ sentiment: "negative", severity: 5, topic: "cleanliness", evidenceExcerpt: "cockroach in trial room", starRating: 1 }),
    ]);
    expect(aggregates.severeIncidents).toHaveLength(1);
    expect(aggregates.negative).toEqual([{ topic: "cleanliness", count: 1, reviews: 1 }]);
  });
});

describe("aggregateObservations", () => {
  it("keeps positive and negative counts, staff, outlets and months separate", () => {
    const aggregates = aggregateObservations([
      row({ sentiment: "positive", entityType: "staff", entityName: "Arun", topic: "staff" }),
      row({ sentiment: "negative", entityType: "staff", entityName: "Arun", topic: "staff", reviewId: "r2", locationId: "loc2", reviewCreateTime: "2026-10-01T10:00:00Z" }),
      row({ sentiment: "negative", topic: "assortment", subtopic: "missing sizes", reviewId: "r2", locationId: "loc2", reviewCreateTime: "2026-10-01T10:00:00Z" }),
    ]);
    expect(aggregates.reviewsAnalysed).toBe(2);
    expect(aggregates.positive).toEqual([{ topic: "staff", count: 1, reviews: 1 }]);
    expect(aggregates.negative.map((t) => t.topic).sort()).toEqual(["assortment", "staff"]);
    expect(aggregates.staffPraise).toEqual([{ name: "Arun", count: 1 }]);
    expect(aggregates.staffComplaints).toEqual([{ name: "Arun", count: 1 }]);
    expect(aggregates.byOutlet.find((o) => o.locationId === "loc2")?.negative).toBe(2);
    expect(aggregates.byMonth.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(aggregates.firstSeenByTopic.assortment).toBe("2026-10-01T10:00:00Z");
  });

  it("counts a staff name once when the spelling differs only by case", () => {
    const aggregates = aggregateObservations([
      row({ sentiment: "positive", entityType: "staff", entityName: "sanjana", topic: "staff" }),
      row({ sentiment: "positive", entityType: "staff", entityName: "Sanjana", topic: "staff", reviewId: "r2" }),
    ]);
    expect(aggregates.staffPraise).toEqual([{ name: "Sanjana", count: 2 }]);
  });
});

describe("parseExtractionResponse", () => {
  it("reads fenced JSON and rejects non-JSON", () => {
    const parsed = parseExtractionResponse('```json\n{"observations":[{"topic":"staff"}]}\n```');
    expect(Array.isArray(parsed)).toBe(true);
    expect(parseExtractionResponse("no json here")).toBeNull();
  });
});
