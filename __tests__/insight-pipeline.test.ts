import { describe, expect, it } from "vitest";
import {
  BATCH_MAX_INPUT_TOKENS,
  BATCH_MAX_REVIEWS,
  aggregateObservations,
  batchExtractionPrompt,
  buildBatches,
  estimateTokens,
  isSevereIncident,
  parseBatchExtractionResponse,
  splitBatchResults,
  validateObservations,
  withRetry,
  type BatchableReview,
  type ObservationRow,
} from "@/lib/review-intelligence";

function review(id: string, comment: string, starRating = 4): BatchableReview {
  return { id, comment, starRating };
}

describe("buildBatches", () => {
  it("bounds batches by review count", () => {
    const reviews = Array.from({ length: 60 }, (_, i) => review(`r${i}`, "Good collection and helpful staff"));
    const batches = buildBatches(reviews);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length <= BATCH_MAX_REVIEWS)).toBe(true);
  });

  it("bounds batches by estimated input tokens", () => {
    const longComment = "x".repeat(8000); // ~2000 tokens each
    const reviews = Array.from({ length: 20 }, (_, i) => review(`r${i}`, longComment));
    const batches = buildBatches(reviews);
    for (const batch of batches) {
      const tokens = batch.reduce((sum, r) => sum + estimateTokens(r.comment) + 60, 0);
      // A single oversized review may stand alone; otherwise the cap holds.
      expect(batch.length === 1 || tokens <= BATCH_MAX_INPUT_TOKENS).toBe(true);
    }
  });

  it("keeps a single oversized review in its own batch instead of dropping it", () => {
    const huge = review("big", "y".repeat(200_000));
    const batches = buildBatches([review("a", "nice"), huge, review("b", "ok")]);
    const flat = batches.flat().map((r) => r.id);
    expect(flat).toEqual(["a", "big", "b"]);
    expect(batches.find((b) => b.some((r) => r.id === "big"))).toHaveLength(1);
  });

  it("covers a multi-page dataset exactly once — pagination never loses a review", () => {
    // Simulates 2,600 reviews arriving over several database pages.
    const reviews = Array.from({ length: 2600 }, (_, i) =>
      review(`rev-${i}`, `Review number ${i} about staff and collection`)
    );
    const batches = buildBatches(reviews);
    const ids = batches.flat().map((r) => r.id);
    expect(ids).toHaveLength(2600);
    expect(new Set(ids).size).toBe(2600);
    expect(batches.length).toBeGreaterThan(1);
  });

  it("returns no batches for empty input", () => {
    expect(buildBatches([])).toEqual([]);
  });
});

describe("batchExtractionPrompt", () => {
  it("keeps every review identifiable and demands one result per review", () => {
    const prompt = batchExtractionPrompt([review("abc-123", "Great staff", 5), review("def-456", "Torn stitching", 2)]);
    expect(prompt).toContain("REVIEW abc-123");
    expect(prompt).toContain("REVIEW def-456");
    expect(prompt).toContain("one result for every REVIEW");
    expect(prompt).toContain("never invent an id");
  });
});

describe("splitBatchResults", () => {
  const batch = [review("r1", "good"), review("r2", "bad"), review("r3", "mixed")];

  it("drops results for review ids that were never sent, and counts them", () => {
    const split = splitBatchResults(batch, {
      results: [
        { reviewId: "r1", observations: [{ topic: "staff" }] },
        { reviewId: "invented-id", observations: [{ topic: "staff" }] },
        { reviewId: "r2", observations: [] },
      ],
    });
    expect([...split.byReview.keys()].sort()).toEqual(["r1", "r2"]);
    expect(split.unknownReviewIds).toEqual(["invented-id"]);
  });

  it("reports reviews the model omitted so they are marked failed, never skipped", () => {
    const split = splitBatchResults(batch, {
      results: [{ reviewId: "r1", observations: [] }],
    });
    expect(split.missingReviewIds.sort()).toEqual(["r2", "r3"]);
  });

  it("treats malformed output as every review missing — nothing is invented", () => {
    const split = splitBatchResults(batch, parseBatchExtractionResponse("not json at all"));
    expect(split.byReview.size).toBe(0);
    expect(split.missingReviewIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(split.unknownReviewIds).toEqual([]);
  });

  it("parses fenced JSON batch responses", () => {
    const parsed = parseBatchExtractionResponse(
      '```json\n{"results":[{"reviewId":"r1","observations":[]}]}\n```'
    );
    expect(parsed).not.toBeNull();
  });
});

describe("five-star reviews with serious allegations", () => {
  const comment = "Loved the collection and the staff were kind. But I found a cockroach near the trial room.";

  it("keeps the defect separate from the praise and preserves its severity", () => {
    const observations = validateObservations(
      [
        {
          topic: "assortment",
          sentiment: "positive",
          detail: "Good collection.",
          evidenceExcerpt: "Loved the collection",
          confidence: 0.9,
        },
        {
          topic: "cleanliness",
          sentiment: "negative",
          detail: "Cockroach near the trial room.",
          severity: 5,
          severityRationale: "pest contamination alleged",
          evidenceExcerpt: "I found a cockroach near the trial room",
          confidence: 0.9,
        },
      ],
      comment
    );
    expect(observations).toHaveLength(2);
    const negative = observations.find((o) => o.sentiment === "negative");
    expect(negative?.severity).toBe(5);
    expect(observations.find((o) => o.sentiment === "positive")?.severity).toBeNull();
  });

  it("flags severity regardless of the five-star rating", () => {
    expect(
      isSevereIncident({
        sentiment: "negative",
        severity: 4,
        evidenceExcerpt: "staff member abused my mother",
        starRating: 5,
      })
    ).toBe(true);
    expect(
      isSevereIncident({
        sentiment: "negative",
        severity: null,
        evidenceExcerpt: "found a cockroach near the trial room",
        starRating: 5,
      })
    ).toBe(true);
  });

  it("surfaces a rare severe issue that occurs exactly once in aggregates", () => {
    const row: ObservationRow = {
      reviewId: "only-once",
      locationId: "loc1",
      clientId: null,
      groupId: null,
      reviewCreateTime: "2026-09-14T10:00:00Z",
      starRating: 5,
      topic: "cleanliness",
      subtopic: "cockroach",
      sentiment: "negative",
      detail: "Cockroach near the trial room.",
      entityType: "facility",
      entityName: null,
      severity: 5,
      severityRationale: "pest contamination alleged",
      evidenceExcerpt: "found a cockroach near the trial room",
      evidenceStart: 0,
      evidenceEnd: 10,
      basis: "fact",
      confidence: 0.9,
      isAmbiguous: false,
      dedupeKey: "k1",
      language: "en",
    } as ObservationRow;
    const aggregates = aggregateObservations([row]);
    expect(aggregates.severeIncidents).toHaveLength(1);
    expect(aggregates.severeIncidents[0]?.reviewId).toBe("only-once");
  });
});

describe("withRetry", () => {
  it("succeeds after transient failures without manual intervention", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("503 unavailable");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms) }
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]); // exponential backoff
  });

  it("gives up after the bounded attempt count and rethrows", async () => {
    let calls = 0;
    let retries = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("still down");
        },
        {
          attempts: 3,
          baseDelayMs: 1,
          sleep: async () => undefined,
          onRetry: () => {
            retries += 1;
          },
        }
      )
    ).rejects.toThrow("still down");
    expect(calls).toBe(3);
    expect(retries).toBe(2);
  });
});
