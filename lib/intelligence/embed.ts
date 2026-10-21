import { createHash } from "node:crypto";
import { readableReviewText } from "@/lib/review-text";
import {
  EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_MODEL_ID,
  classifyGeminiError,
  geminiEmbedUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { fitEmbedding } from "@/lib/intelligence/vectors";

export const EMBEDDING_MODEL = GEMINI_EMBEDDING_MODEL_ID;

/** Published standard price for gemini-embedding-001 text, per 1M input tokens. */
export const EMBEDDING_USD_PER_MILLION_TOKENS = 0.15;

export function embeddingInput(comment: string | null): string | null {
  const text = readableReviewText(comment)?.trim();
  if (!text || text.length < 12) return null;
  return text.slice(0, 4000);
}

export function embeddingContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Rough token count used only for a cost estimate, not a provider invoice. */
export function estimateEmbeddingCostUsd(characters: number): number {
  const tokens = Math.ceil(characters / 4);
  return (tokens / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS;
}

export interface EmbeddingPlanItem {
  reviewId: string;
  contentHash: string;
  text: string;
}

export function planEmbeddingWork(
  reviews: Array<{ reviewId: string; comment: string | null }>,
  existing: Array<{ reviewId: string; model: string; contentHash: string }>
): { embed: EmbeddingPlanItem[]; reuse: string[] } {
  const embed: EmbeddingPlanItem[] = [];
  const reuse: string[] = [];
  for (const review of reviews) {
    const text = embeddingInput(review.comment);
    if (!text) continue;
    const contentHash = embeddingContentHash(text);
    const found = existing.some(
      (row) => row.reviewId === review.reviewId && row.model === EMBEDDING_MODEL && row.contentHash === contentHash
    );
    if (found) reuse.push(review.reviewId);
    else embed.push({ reviewId: review.reviewId, contentHash, text });
  }
  return { embed, reuse };
}

export interface EmbeddingResult {
  model: string;
  dimensions: number;
  values: number[];
  latencyMs: number;
  estimatedCostUsd: number;
}

export async function requestEmbedding(
  text: string,
  deps: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<EmbeddingResult> {
  const apiKey = deps.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("config: GEMINI_API_KEY is not set");
  const source = embeddingInput(text) ?? (text.trim().length >= 12 ? text.trim().slice(0, 4000) : null);
  if (!source) throw new Error("config: review text is too short to embed");
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20_000);
  try {
    const response = await (deps.fetch ?? fetch)(geminiEmbedUrl(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        content: { parts: [{ text: source }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      logGeminiFailure("intelligence.embed_failed", response.status, body);
      const classified = classifyGeminiError(response.status, body);
      throw new Error(`${classified.type}: ${classified.message}`);
    }
    const payload = JSON.parse(body) as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    if (!values || values.length < EMBEDDING_DIMENSIONS) {
      throw new Error("invalid_response: embedding payload");
    }
    return {
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      values: fitEmbedding(values, EMBEDDING_DIMENSIONS),
      latencyMs: Date.now() - started,
      estimatedCostUsd: estimateEmbeddingCostUsd(source.length),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("timeout: embedding request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
