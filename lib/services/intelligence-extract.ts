import {
  extractGeminiText,
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  classifyGeminiError,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { extractionPrompt } from "@/lib/intelligence/extract-prompt";
import {
  EXTRACT_ANALYSIS_VERSION,
  buildRatingOnlyExtraction,
  shouldReuseExtraction,
  validateModelExtraction,
  type ReviewExtraction,
} from "@/lib/intelligence/extraction";
import { detectReviewLanguage } from "@/lib/review-inbox";
import type { ClassifyReview } from "@/lib/intelligence/classify-job";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRulesExtraction, requiresAiReview } from "@/lib/intelligence/rules-extraction";
import { recordAiUsage } from "@/lib/services/ai-usage-ledger";

const REQUEST_TIMEOUT_MS = 45_000;

type Admin = ReturnType<typeof createAdminClient>;

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
}

export function usageFromResponse(data: unknown): GeminiUsage {
  const usage = (data as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  })?.usageMetadata;
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}

/**
 * Single-review model call, used only for residue the rules cannot resolve and
 * only on the live classify path where reviews trickle in one at a time.
 * Bulk residue goes through the batched pass in intelligence-batch.ts.
 * Provider failures throw and the job retries that review only.
 */
export async function requestReviewExtractionDetailed(
  comment: string,
  starRating: number
): Promise<{ text: string; usage: GeminiUsage }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("config: GEMINI_API_KEY is missing");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(geminiGenerateUrl(apiKey, GEMINI_MODEL_ID), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: extractionPrompt({
                  comment,
                  starRating,
                  language: detectReviewLanguage(comment),
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: GEMINI_THINKING_LOW,
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      logGeminiFailure("intelligence.extract_failed", response.status, body);
      const classified = classifyGeminiError(response.status, body);
      throw new Error(`${classified.type}: ${classified.message}`);
    }
    const data = await response.json();
    const { text, finishReason } = extractGeminiText(data);
    if (!text || finishReason === "MAX_TOKENS") {
      throw new Error("invalid_response: model output was empty or truncated");
    }
    return { text, usage: usageFromResponse(data) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("timeout: review extraction timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestReviewExtraction(comment: string, starRating: number): Promise<string> {
  const { text } = await requestReviewExtractionDetailed(comment, starRating);
  return text;
}

export async function extractReviewForJob(
  admin: Admin,
  review: ClassifyReview
): Promise<{ extraction: ReviewExtraction; model: string }> {
  const { data, error } = await admin
    .from("grm_review_intelligence")
    .select("content_hash, analysis_version, taxonomy_version, prompt_version, status, is_current, extraction")
    .eq("workspace_id", review.workspaceId)
    .eq("review_id", review.id)
    .eq("content_hash", review.contentFingerprint)
    .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const stored = data?.extraction as ReviewExtraction | null;
  if (
    data &&
    shouldReuseExtraction(
      {
        contentHash: data.content_hash,
        analysisVersion: data.analysis_version,
        taxonomyVersion: data.taxonomy_version,
        promptVersion: data.prompt_version,
        status: data.status,
        isCurrent: data.is_current,
      },
      review.contentFingerprint
    ) &&
    stored?.analysisVersion === EXTRACT_ANALYSIS_VERSION
  ) {
    return { extraction: { ...stored, reused: true }, model: "none" };
  }
  if (!review.comment?.trim()) {
    return { extraction: buildRatingOnlyExtraction(review.starRating), model: "none" };
  }
  // Rules keep rating-only reviews and short praise with no topic word.
  // Negative text, long positive or neutral reviews, and keyword reviews go to Gemini.
  const rules = buildRulesExtraction(review.comment, review.starRating);
  if (rules.covered && !requiresAiReview(review.comment, review.starRating, rules)) {
    return { extraction: rules.extraction, model: "rules" };
  }
  const { text: modelText, usage } = await requestReviewExtractionDetailed(review.comment, review.starRating);
  await recordAiUsage(admin, {
    workspaceId: review.workspaceId,
    operation: "extract_review",
    model: GEMINI_MODEL_ID,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  return {
    extraction: validateModelExtraction({
      comment: review.comment,
      starRating: review.starRating,
      modelText,
    }),
    model: GEMINI_MODEL_ID,
  };
}
