/**
 * Cost and batch plan for a historical backfill. This function does not read
 * the database and does not call a provider. Prices are the published standard
 * paid rates recorded in the architecture doc on 20 October 2026, using the
 * assumed token counts in that same section. They are not a live quote.
 */

export const BACKFILL_PRICE_DATE = "2026-10-20";
export const EMBED_USD_PER_MILLION = 0.15;
export const EXTRACT_INPUT_USD_PER_MILLION = 0.3;
export const EXTRACT_OUTPUT_USD_PER_MILLION = 2.5;
export const ASSUMED_EXTRACT_INPUT_TOKENS = 200;
export const ASSUMED_EXTRACT_OUTPUT_TOKENS = 80;
export const ASSUMED_EMBED_INPUT_TOKENS = 200;
export const DEFAULT_BACKFILL_BATCH = 50;

export interface BackfillReview {
  id: string;
  workspaceId: string;
  hasText: boolean;
  contentHash: string;
}

export interface BackfillBatch {
  workspaceId: string;
  reviewIds: string[];
  checkpoint: string;
}

export interface BackfillPlan {
  eligibleTextReviews: number;
  ratingOnlyReviews: number;
  skippedCurrent: number;
  embedCalls: number;
  extractCalls: number;
  embedUsd: number;
  extractUsd: number;
  batches: BackfillBatch[];
  /** A plan is not permission to run. */
  start: false;
}

function money(calls: number, tokens: number, perMillion: number): number {
  return (calls * tokens * perMillion) / 1_000_000;
}

export interface PendingExtractionReview {
  id: string;
  fingerprint: string;
  createdAt: string | null;
}

/** Months of reviews Fazyo’s Update summary keeps. Older reviews are removed. */
export const FAZYO_SUMMARY_MONTHS = 6;

/**
 * Fazyo’s Update summary stores the last six months and replaces whatever
 * summary was saved before. Other clients, including the numbered Fazyo
 * placeholders, keep the full organisation.
 */
export function summaryWindowMonths(clientName: string | null | undefined): number | null {
  if (clientName?.trim().toLowerCase() !== "fazyo") return null;
  return FAZYO_SUMMARY_MONTHS;
}

/** Start of a rolling month window, using the same UTC month step as the page filter. */
export function summaryWindowStart(months: number, now: Date): Date {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}

/**
 * A reading stored by an older Gemini model is sent again. Rules rows and
 * rating-only rows stay, and a row already written by the current model stays.
 */
export function storedModelNeedsReread(model: string | null | undefined, targetModel: string): boolean {
  if (!model || model === targetModel || model === "rules" || model === "none") return false;
  return true;
}

/**
 * Reviews whose stored extraction does not match their current content
 * fingerprint, newest first so a bounded run catches up the freshest
 * reviews before older backlog. Ready keys are `${id}|${fingerprint}`.
 */
export function pendingExtractions<T extends PendingExtractionReview>(
  reviews: readonly T[],
  readyKeys: ReadonlySet<string>,
  limit: number
): T[] {
  const pending = reviews.filter((review) => !readyKeys.has(`${review.id}|${review.fingerprint}`));
  pending.sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
    const aValue = Number.isNaN(aTime) ? Number.NEGATIVE_INFINITY : aTime;
    const bValue = Number.isNaN(bTime) ? Number.NEGATIVE_INFINITY : bTime;
    if (bValue !== aValue) return bValue - aValue;
    return a.id.localeCompare(b.id);
  });
  return limit > 0 ? pending.slice(0, limit) : pending;
}

/**
 * One row per review id. A review whose current intelligence and, when it has
 * text, embedding already match the content hash is skipped. Batches never mix
 * workspaces. The checkpoint is the last review id in the batch.
 */
export function planBackfill(
  reviews: readonly BackfillReview[],
  current: {
    intelligence: readonly { reviewId: string; workspaceId: string; contentHash: string }[];
    embeddings: readonly { reviewId: string; workspaceId: string; contentHash: string }[];
  },
  batchSize = DEFAULT_BACKFILL_BATCH
): BackfillPlan {
  const size = Math.max(1, batchSize);
  const seen = new Set<string>();
  const intelligence = new Set(current.intelligence.map((row) => `${row.workspaceId}|${row.reviewId}|${row.contentHash}`));
  const embeddings = new Set(current.embeddings.map((row) => `${row.workspaceId}|${row.reviewId}|${row.contentHash}`));
  const pending: BackfillReview[] = [];
  let skippedCurrent = 0;
  let ratingOnly = 0;
  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    const key = `${review.workspaceId}|${review.id}|${review.contentHash}`;
    const intelligenceReady = intelligence.has(key);
    const embeddingReady = !review.hasText || embeddings.has(key);
    if (intelligenceReady && embeddingReady) {
      skippedCurrent += 1;
      continue;
    }
    if (!review.hasText) ratingOnly += 1;
    pending.push(review);
  }
  const byWorkspace = new Map<string, BackfillReview[]>();
  for (const review of pending) {
    const list = byWorkspace.get(review.workspaceId) ?? [];
    list.push(review);
    byWorkspace.set(review.workspaceId, list);
  }
  const batches: BackfillBatch[] = [];
  for (const [workspaceId, rows] of [...byWorkspace.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (let index = 0; index < rows.length; index += size) {
      const slice = rows.slice(index, index + size);
      batches.push({
        workspaceId,
        reviewIds: slice.map((review) => review.id),
        checkpoint: slice[slice.length - 1]!.id,
      });
    }
  }
  const textPending = pending.filter((review) => review.hasText).length;
  return {
    eligibleTextReviews: textPending,
    ratingOnlyReviews: ratingOnly,
    skippedCurrent,
    embedCalls: textPending,
    extractCalls: textPending,
    embedUsd: money(textPending, ASSUMED_EMBED_INPUT_TOKENS, EMBED_USD_PER_MILLION),
    extractUsd:
      money(textPending, ASSUMED_EXTRACT_INPUT_TOKENS, EXTRACT_INPUT_USD_PER_MILLION) +
      money(textPending, ASSUMED_EXTRACT_OUTPUT_TOKENS, EXTRACT_OUTPUT_USD_PER_MILLION),
    batches,
    start: false,
  };
}
