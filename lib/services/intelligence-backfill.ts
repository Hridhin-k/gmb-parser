import type { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { contentFingerprint } from "@/lib/intelligence/fingerprint";
import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import { pendingExtractions, storedModelNeedsReread } from "@/lib/intelligence/backfill-plan";
import { GEMINI_MODEL_ID } from "@/lib/gemini";
import { buildRulesExtraction, requiresAiReview } from "@/lib/intelligence/rules-extraction";
import { BATCH_SIZE } from "@/lib/intelligence/batch-extract";
import { extractReviewsBatch } from "@/lib/services/intelligence-batch";
import { commitValidatedExtraction, invalidateLocationSummaries } from "@/lib/services/intelligence-ingest";
import { detectReviewLanguage } from "@/lib/review-inbox";

type Admin = ReturnType<typeof createAdminClient>;

/** Reviews processed per button click. The rest stay pending for the next click. */
export const BACKFILL_RUN_LIMIT = 2000;
const COMMIT_CONCURRENCY = 6;

export interface ScopeBackfillResult {
  scanned: number;
  pendingBefore: number;
  processed: number;
  rulesStored: number;
  batchStored: number;
  failed: number;
  remaining: number;
  budgetStopped: boolean;
  quotaStopped: boolean;
}

interface ReviewRow {
  id: string;
  location_id: string;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  content_fingerprint: string | null;
}

async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function pool<T>(items: readonly T[], workers: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await run(items[index]!);
      }
    })
  );
}

/** Reviews on or after `since`, newest first, stable when timestamps tie. */
export async function loadReviewIdsSince(
  admin: Admin,
  workspaceId: string,
  locationIds: readonly string[],
  since: Date
): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const ids: string[] = [];
  const sinceIso = since.toISOString();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("grm_reviews")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("location_id", [...locationIds])
      .is("missing_on_google_at", null)
      .gte("review_create_time", sinceIso)
      .order("review_create_time", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    ids.push(...page.map((row) => row.id));
    if (page.length < 1000) break;
  }
  return ids;
}

/**
 * In-app backfill for one scope (organisation, group, or location) on the
 * Insights page. Newest reviews first, bounded per run: rules extraction
 * stores most reviews locally, only residue reaches the batched model call.
 * Embeddings are intentionally not part of this run. Summaries for the
 * scope's locations are invalidated when anything was stored, so the
 * caller can regenerate the report against fresh counts.
 */
export async function runScopeBackfill(
  admin: Admin,
  input: {
    workspaceId: string;
    locationIds: readonly string[];
    /** When set, only these reviews are extracted. The caller uses this for Fazyo’s six-month window. */
    reviewIds?: readonly string[];
    limit?: number;
    onProgress?: (progress: { rulesStored: number; batchStored: number; failed: number }) => void;
  }
): Promise<ScopeBackfillResult> {
  const empty: ScopeBackfillResult = {
    scanned: 0,
    pendingBefore: 0,
    processed: 0,
    rulesStored: 0,
    batchStored: 0,
    failed: 0,
    remaining: 0,
    budgetStopped: false,
    quotaStopped: false,
  };
  if (input.locationIds.length === 0) return empty;

  const reviews = await pageAll<ReviewRow>((from, to) =>
    admin
      .from("grm_reviews")
      .select("id, location_id, star_rating, comment, review_create_time, content_fingerprint")
      .eq("workspace_id", input.workspaceId)
      .in("location_id", [...input.locationIds])
      .is("missing_on_google_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
  const current = await pageAll<{ review_id: string; content_hash: string; model: string }>((from, to) =>
    admin
      .from("grm_review_intelligence")
      .select("review_id, content_hash, model")
      .eq("workspace_id", input.workspaceId)
      .eq("is_current", true)
      .eq("status", "ready")
      .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const allowedIds = input.reviewIds ? new Set(input.reviewIds) : null;
  const scoped = allowedIds ? reviews.filter((review) => allowedIds.has(review.id)) : reviews;
  const readyKeys = new Set(current.map((row) => `${row.review_id}|${row.content_hash}`));
  const modelByReview = new Map(current.map((row) => [row.review_id, row.model]));
  const work = scoped.map((review) => ({
    ...review,
    fingerprint:
      review.content_fingerprint ??
      contentFingerprint({ starRating: review.star_rating, comment: review.comment, createTime: review.review_create_time }),
    createdAt: review.review_create_time,
  }));
  for (const review of work) {
    const model = modelByReview.get(review.id);
    if (storedModelNeedsReread(model, GEMINI_MODEL_ID)) {
      readyKeys.delete(`${review.id}|${review.fingerprint}`);
      continue;
    }
    if (model !== "rules" && model !== "none") continue;
    const rules = buildRulesExtraction(review.comment, review.star_rating);
    if (requiresAiReview(review.comment, review.star_rating, rules)) readyKeys.delete(`${review.id}|${review.fingerprint}`);
  }
  const pendingBefore = work.filter((review) => !readyKeys.has(`${review.id}|${review.fingerprint}`)).length;
  const extractList = pendingExtractions(work, readyKeys, input.limit ?? BACKFILL_RUN_LIMIT);

  const toItem = (review: (typeof extractList)[number]) => ({
    id: review.id,
    workspaceId: input.workspaceId,
    locationId: review.location_id,
    contentFingerprint: review.fingerprint,
    starRating: review.star_rating,
    comment: review.comment,
    missingOnGoogleAt: null as string | null,
  });

  let rulesStored = 0;
  let batchStored = 0;
  let failed = 0;
  const residue: typeof extractList = [];
  await pool(extractList, COMMIT_CONCURRENCY, async (review) => {
    try {
      const rules = buildRulesExtraction(review.comment, review.star_rating);
      if (!rules.covered || requiresAiReview(review.comment, review.star_rating, rules)) {
        residue.push(review);
        return;
      }
      await commitValidatedExtraction(admin, toItem(review), rules.extraction, review.comment?.trim() ? "rules" : "none");
      rulesStored += 1;
    } catch (error) {
      failed += 1;
      logger.warn("intelligence.backfill_rules_failed", {
        workspaceId: input.workspaceId,
        reviewId: review.id,
        message: error instanceof Error ? error.message.slice(0, 200) : "rules failed",
      });
    }
  });

  input.onProgress?.({ rulesStored, batchStored: 0, failed });

  let budgetStopped = false;
  let quotaStopped = false;
  if (residue.length > 0) {
    for (let offset = 0; offset < residue.length && !quotaStopped; offset += BATCH_SIZE) {
      const chunk = residue.slice(offset, offset + BATCH_SIZE);
      let pending = chunk;
      for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
        try {
          const outcome = await extractReviewsBatch(
            admin,
            input.workspaceId,
            pending.map((review) => ({
              id: review.id,
              comment: review.comment ?? "",
              starRating: review.star_rating,
              language: detectReviewLanguage(review.comment ?? ""),
            }))
          );
          if (outcome.budgetExceeded) {
            budgetStopped = true;
            quotaStopped = true;
            break;
          }
          for (const review of pending) {
            const got = outcome.extracted.get(review.id);
            if (!got) continue;
            await commitValidatedExtraction(admin, toItem(review), got.extraction, got.model);
            batchStored += 1;
          }
          pending = pending.filter((review) => outcome.failedIds.includes(review.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : "batch failed";
          if (/quota/i.test(message)) {
            quotaStopped = true;
            break;
          }
          logger.warn("intelligence.backfill_batch_failed", {
            workspaceId: input.workspaceId,
            attempt,
            message: message.slice(0, 200),
          });
        }
      }
      failed += pending.length;
      input.onProgress?.({ rulesStored, batchStored, failed });
    }
  }

  const processed = rulesStored + batchStored;
  if (processed > 0) {
    for (const locationId of input.locationIds) {
      await invalidateLocationSummaries(admin, input.workspaceId, locationId);
    }
  }
  if (batchStored > 0) {
    const { rebuildWorkspaceClusters } = await import("@/lib/services/intelligence-embed");
    await rebuildWorkspaceClusters(admin, input.workspaceId);
  }

  return {
    scanned: work.length,
    pendingBefore,
    processed,
    rulesStored,
    batchStored,
    failed,
    remaining: Math.max(0, pendingBefore - processed),
    budgetStopped,
    quotaStopped,
  };
}
