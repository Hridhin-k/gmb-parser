import {
  extractGeminiText,
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  classifyGeminiError,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { batchExtractionPrompt, parseBatchResults, type BatchReviewInput } from "@/lib/intelligence/batch-extract";
import { validateModelExtraction, type ReviewExtraction } from "@/lib/intelligence/extraction";
import { usageFromResponse, type GeminiUsage } from "@/lib/services/intelligence-extract";
import { recordAiUsage, getAiBudget } from "@/lib/services/ai-usage-ledger";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const REQUEST_TIMEOUT_MS = 90_000;

export interface BatchExtractionOutcome {
  extracted: Map<string, { extraction: ReviewExtraction; model: string }>;
  failedIds: string[];
  usage: GeminiUsage;
  budgetExceeded: boolean;
}

/**
 * One Gemini call for a chunk of residue reviews (rules already declined
 * these). Each returned entry is validated against its own review text, so a
 * malformed entry fails that review only and is retried on a later run.
 */
export async function extractReviewsBatch(
  admin: Admin,
  workspaceId: string,
  reviews: readonly BatchReviewInput[]
): Promise<BatchExtractionOutcome> {
  const empty: BatchExtractionOutcome = {
    extracted: new Map(),
    failedIds: reviews.map((review) => review.id),
    usage: { inputTokens: 0, outputTokens: 0 },
    budgetExceeded: false,
  };
  if (reviews.length === 0) return { ...empty, failedIds: [] };
  const budget = await getAiBudget(admin, workspaceId);
  if (budget.exceeded) return { ...empty, budgetExceeded: true };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("config: GEMINI_API_KEY is missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let usage: GeminiUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    const response = await fetch(geminiGenerateUrl(apiKey, GEMINI_MODEL_ID), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: batchExtractionPrompt(reviews) }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          thinkingConfig: GEMINI_THINKING_LOW,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      logGeminiFailure("intelligence.batch_extract_failed", response.status, body);
      const classified = classifyGeminiError(response.status, body);
      throw new Error(`${classified.type}: ${classified.message}`);
    }
    const data = await response.json();
    usage = usageFromResponse(data);
    await recordAiUsage(admin, {
      workspaceId,
      operation: "extract_batch",
      model: GEMINI_MODEL_ID,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const { text, finishReason } = extractGeminiText(data);
    if (!text || finishReason === "MAX_TOKENS") {
      throw new Error("invalid_response: batch output was empty or truncated");
    }
    const payloads = parseBatchResults(text, reviews.length);
    const extracted = new Map<string, { extraction: ReviewExtraction; model: string }>();
    const failedIds: string[] = [];
    for (let index = 0; index < reviews.length; index += 1) {
      const review = reviews[index]!;
      const payload = payloads.get(index);
      if (!payload) {
        failedIds.push(review.id);
        continue;
      }
      try {
        extracted.set(review.id, {
          extraction: validateModelExtraction({ comment: review.comment, starRating: review.starRating, modelText: payload }),
          model: GEMINI_MODEL_ID,
        });
      } catch {
        failedIds.push(review.id);
      }
    }
    return { extracted, failedIds, usage, budgetExceeded: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("timeout: batch extraction timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
