import { describe, expect, it } from "vitest";
import { batchExtractionPrompt, parseBatchResults } from "@/lib/intelligence/batch-extract";
import { estimateCostUsd, monthKey } from "@/lib/intelligence/ai-usage";
import { GEMINI_FAST_MODEL_ID, GEMINI_MODEL_ID } from "@/lib/gemini";
import { usageFromResponse } from "@/lib/services/intelligence-extract";

describe("batched extraction", () => {
  it("states the taxonomy once for the whole batch", () => {
    const prompt = batchExtractionPrompt([
      { id: "a", comment: "Good collection", starRating: 5, language: "en" },
      { id: "b", comment: "High price", starRating: 3, language: "en" },
    ]);
    expect(prompt.split("Allowed topic codes:").length - 1).toBe(1);
    expect(prompt).toContain("Review 0:");
    expect(prompt).toContain("Review 1:");
  });

  it("maps results back by index and drops malformed entries", () => {
    const parsed = parseBatchResults(
      JSON.stringify({
        results: [
          { index: 1, aspects: [] },
          { aspects: [{ topicCode: "price" }] },
          { index: 9, aspects: [] },
          "junk",
        ],
      }),
      2
    );
    expect([...parsed.keys()].sort()).toEqual([1]);
    expect(JSON.parse(parsed.get(1)!)).toMatchObject({ aspects: [] });
  });

  it("prices flash-lite, flash, and the monthly key", () => {
    expect(estimateCostUsd(GEMINI_FAST_MODEL_ID, 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(estimateCostUsd(GEMINI_FAST_MODEL_ID, 1_000_000, 1_000_000, true)).toBeCloseTo(1.4, 6);
    expect(estimateCostUsd(GEMINI_MODEL_ID, 1_000_000, 1_000_000)).toBeCloseTo(4.5, 6);
    expect(monthKey(new Date("2026-10-20T00:00:00Z"))).toBe("2026-10");
  });

  it("bills thinking tokens with the answer", () => {
    expect(
      usageFromResponse({
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80, thoughtsTokenCount: 120 },
      })
    ).toEqual({ inputTokens: 200, outputTokens: 200 });
  });
});
