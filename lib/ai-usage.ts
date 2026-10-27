import { AppError } from "@/lib/errors";

/**
 * Standard paid estimates per 1M tokens. OpenAI Luna checked 27 October 2026.
 * Gemini 3.8's scheduled 1 January 2027 price change is applied below.
 * Batch API calls cost half of these rates.
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "google:gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "google:gemini-3.8-flash": { input: 0.75, output: 3.75 },
};

export type AiOperation = "reply_draft" | "extract_review" | "insight_prose" | "preview";

export interface AiPrice { input: number; output: number }

/** Standard estimates. Cached input is conservatively charged at uncached rates. */
export function resolveAiPrice(identity: string): AiPrice {
  let overrides: Record<string, AiPrice> = {};
  if (process.env.AI_PRICES_JSON?.trim()) {
    try { overrides = JSON.parse(process.env.AI_PRICES_JSON); } catch { throw new AppError("AI_PRICES_JSON must be valid JSON.", "CONFIG_ERROR"); }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new AppError("AI_PRICES_JSON must be an object keyed by provider:model.", "CONFIG_ERROR");
  }
  const known = identity === "openai:gpt-6-luna" ? { input: 0.1, output: 0.5 } : PRICE_PER_MILLION[identity];
  const price = overrides[identity] ?? known;
  if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output < 0) {
    throw new AppError("Configure AI_PRICES_JSON with input/output USD per million tokens for the selected provider:model.", "CONFIG_ERROR");
  }
  if (!overrides[identity] && identity === "google:gemini-3.8-flash" && Date.now() >= Date.UTC(2027, 0, 1)) return { input: 1.5, output: 7.5 };
  return price;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, batch = false): number {
  const price = resolveAiPrice(model);
  const factor = batch ? 0.5 : 1;
  return factor * ((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

/** Monthly budget for AI spend per workspace, in USD. */
export function monthlyBudgetUsd(): number {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_USD ?? "6");
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

export function monthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
