import { describe, expect, it } from "vitest";
import { contentBlock } from "@/lib/ai/content-block";

describe("provider block diagnosis", () => {
  it("distinguishes Google's recitation block from a safety restriction", () => {
    const block = contentBlock({ provider: "google", finishReason: "content-filter", rawFinishReason: "RECITATION" });
    expect(block).toMatchObject({ code: "AI_RECITATION_BLOCKED", diagnostics: { rawFinishReason: "RECITATION", blockStage: "output" } });
    expect(block!.message).toContain("copied wording");
  });
  it("extracts only safe prompt-block categories and probabilities", () => {
    const block = contentBlock({ provider: "google", finishReason: "content-filter", providerMetadata: { google: {
      promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "private prompt", safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "LOW", blocked: true, detail: "private input" }] },
      finishMessage: "private response",
    } } });
    expect(block).toMatchObject({ code: "AI_SAFETY_BLOCKED", diagnostics: { providerBlockReason: "SAFETY", blockStage: "prompt",
      safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "LOW", blocked: true }] } });
    expect(JSON.stringify(block)).not.toContain("private");
  });
  it("recovers the raw reason from a structured-output error response", () => {
    expect(contentBlock({ provider: "google", finishReason: "content-filter", responseBody: JSON.stringify({ candidates: [{ finishReason: "RECITATION" }] }) }))
      .toMatchObject({ code: "AI_RECITATION_BLOCKED" });
    expect(contentBlock({ provider: "openai", finishReason: "content-filter", rawFinishReason: "RECITATION" })).toMatchObject({ code: "AI_SAFETY_BLOCKED" });
  });
  it("does not mistake truncation or a normal response for a content block", () => {
    expect(contentBlock({ provider: "google", finishReason: "length", rawFinishReason: "MAX_TOKENS" })).toBeNull();
    expect(contentBlock({ provider: "google", finishReason: "stop" })).toBeNull();
  });
});
