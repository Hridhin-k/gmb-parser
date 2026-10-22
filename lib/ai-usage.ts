import { GEMINI_FAST_MODEL_ID, GEMINI_MODEL_ID } from "@/lib/gemini";

/**
 * Published standard paid prices, per 1M tokens, recorded 20 October 2026.
 * gemini-3.8-flash rises to $1.50 / $7.50 on 1 January 2027; update then.
 * Batch API calls cost half of these rates.
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  [GEMINI_FAST_MODEL_ID]: { input: 0.3, output: 2.5 },
  [GEMINI_MODEL_ID]: { input: 0.75, output: 3.75 },
};

export type AiOperation = "reply_draft" | "extract_review";

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, batch = false): number {
  const price = PRICE_PER_MILLION[model];
  if (!price) return 0;
  const factor = batch ? 0.5 : 1;
  return factor * ((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

/** Monthly budget for Gemini spend per workspace, in USD. */
export function monthlyBudgetUsd(): number {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_USD ?? "6");
  return Number.isFinite(raw) && raw > 0 ? raw : 6;
}

export function monthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
