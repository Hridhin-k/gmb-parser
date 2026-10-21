import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentFingerprint } from "@/lib/intelligence/fingerprint";
import { EXTRACT_ANALYSIS_VERSION } from "@/lib/intelligence/extraction";
import { buildRulesExtraction, requiresAiReview } from "@/lib/intelligence/rules-extraction";
import { BATCH_SIZE } from "@/lib/intelligence/batch-extract";
import { extractReviewsBatch } from "@/lib/services/intelligence-batch";
import { detectReviewLanguage } from "@/lib/review-inbox";
import { commitValidatedExtraction, invalidateLocationSummaries } from "@/lib/services/intelligence-ingest";
import { embeddingContentHash, embeddingInput, requestEmbedding, EMBEDDING_MODEL } from "@/lib/intelligence/embed";
import { recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { planBackfill } from "@/lib/intelligence/backfill-plan";

function loadLocalEnv(): void {
  if (process.env.GEMINI_API_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const clientId = process.env.BACKFILL_CLIENT_ID ?? "";
const limit = Number(process.env.BACKFILL_LIMIT ?? "0") || 0;
const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY ?? "4") || 4);
const doEmbed = process.env.BACKFILL_EMBED !== "0";

type Admin = ReturnType<typeof createAdminClient>;

interface ReviewRow {
  id: string;
  location_id: string;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  content_fingerprint: string | null;
  missing_on_google_at: string | null;
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

async function pool<T>(items: readonly T[], workers: number, run: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await run(items[index]!, index);
      }
    })
  );
}

/**
 * Operator backfill for one client. Skipped unless BACKFILL_CLIENT_ID is set.
 * Resumable: a review whose stored extract-v1 row already matches its content
 * fingerprint is skipped, and an embedding whose hash matches is skipped, so a
 * restart continues from database state rather than a local checkpoint file.
 * Run: BACKFILL_CLIENT_ID=<uuid> npx vitest run __tests__/intelligence-backfill-live.test.ts
 */
describe.skipIf(!clientId)("live intelligence backfill", () => {
  it("extracts and embeds one client's reviews", async () => {
    loadLocalEnv();
    const admin: Admin = createAdminClient();
    const started = Date.now();
    const log = (payload: Record<string, unknown>) => console.log(JSON.stringify({ t: Date.now() - started, ...payload }));

    const { data: locations, error: locationError } = await admin
      .from("grm_google_locations")
      .select("id, workspace_id")
      .eq("client_id", clientId);
    if (locationError) throw new Error(locationError.message);
    expect(locations?.length).toBeGreaterThan(0);
    const workspaceId = locations![0]!.workspace_id;
    expect(locations!.every((row) => row.workspace_id === workspaceId)).toBe(true);
    const locationIds = locations!.map((row) => row.id);

    const reviews = await pageAll<ReviewRow>((from, to) =>
      admin
        .from("grm_reviews")
        .select("id, location_id, star_rating, comment, review_create_time, content_fingerprint, missing_on_google_at")
        .eq("workspace_id", workspaceId)
        .in("location_id", locationIds)
        .is("missing_on_google_at", null)
        .order("id", { ascending: true })
        .range(from, to)
    );
    const current = await pageAll<{ review_id: string; content_hash: string }>((from, to) =>
      admin
        .from("grm_review_intelligence")
        .select("review_id, content_hash")
        .eq("workspace_id", workspaceId)
        .eq("is_current", true)
        .eq("status", "ready")
        .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
        .order("id", { ascending: true })
        .range(from, to)
    );
    const embeddings = await pageAll<{ review_id: string; content_hash: string }>((from, to) =>
      admin
        .from("grm_review_embeddings")
        .select("review_id, content_hash")
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .range(from, to)
    );

    const work = reviews.map((review) => ({
      ...review,
      fingerprint:
        review.content_fingerprint ??
        contentFingerprint({ starRating: review.star_rating, comment: review.comment, createTime: review.review_create_time }),
    }));
    const plan = planBackfill(
      work.map((review) => ({
        id: review.id,
        workspaceId,
        hasText: Boolean(review.comment?.trim()),
        contentHash: review.fingerprint,
      })),
      {
        intelligence: current.map((row) => ({ reviewId: row.review_id, workspaceId, contentHash: row.content_hash })),
        embeddings: embeddings.map((row) => ({ reviewId: row.review_id, workspaceId, contentHash: row.content_hash })),
      }
    );
    log({
      phase: "plan",
      reviews: work.length,
      textReviews: work.filter((review) => review.comment?.trim()).length,
      eligibleTextReviews: plan.eligibleTextReviews,
      ratingOnlyReviews: plan.ratingOnlyReviews,
      skippedCurrent: plan.skippedCurrent,
      extractUsdEstimate: Number(plan.extractUsd.toFixed(4)),
      embedUsdEstimate: Number(plan.embedUsd.toFixed(4)),
      limit: limit || null,
      concurrency,
      embed: doEmbed,
    });

    const readyKeys = new Set(current.map((row) => `${row.review_id}|${row.content_hash}`));
    const pendingExtract = work.filter((review) => !readyKeys.has(`${review.id}|${review.fingerprint}`));
    const extractList = limit > 0 ? pendingExtract.slice(0, limit) : pendingExtract;
    const toItem = (review: (typeof extractList)[number]) => ({
      id: review.id,
      workspaceId,
      locationId: review.location_id,
      contentFingerprint: review.fingerprint,
      starRating: review.star_rating,
      comment: review.comment,
      missingOnGoogleAt: null as string | null,
    });

    // Phase A: rules. Local phrase matching commits most reviews at no
    // provider cost. Only residue goes to the model.
    let stored = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const residue: typeof extractList = [];
    await pool(extractList, concurrency, async (review, index) => {
      const item = toItem(review);
      try {
        const rules = buildRulesExtraction(review.comment, review.star_rating);
        if (!rules.covered || requiresAiReview(review.comment, review.star_rating, rules)) {
          residue.push(review);
          return;
        }
        await commitValidatedExtraction(admin, item, rules.extraction, review.comment?.trim() ? "rules" : "none");
        stored += 1;
      } catch (error) {
        failed += 1;
        if (failedIds.length < 20) failedIds.push(review.id);
        log({ phase: "rules_failed", reviewId: review.id, message: error instanceof Error ? error.message.slice(0, 200) : "failed" });
      }
      if ((index + 1) % 250 === 0 || index + 1 === extractList.length) {
        log({ phase: "rules", done: index + 1, total: extractList.length, stored, residue: residue.length, checkpoint: review.id });
      }
    });
    log({ phase: "rules_done", stored, residue: residue.length, failed });

    // Phase B: batched residue. One model call per BATCH_SIZE reviews.
    let quotaStopped = false;
    if (failed === 0 && residue.length > 0) {
      for (let offset = 0; offset < residue.length && !quotaStopped; offset += BATCH_SIZE) {
        const chunk = residue.slice(offset, offset + BATCH_SIZE);
        let pending = chunk;
        for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
          try {
            const outcome = await extractReviewsBatch(
              admin,
              workspaceId,
              pending.map((review) => ({
                id: review.id,
                comment: review.comment ?? "",
                starRating: review.star_rating,
                language: detectReviewLanguage(review.comment ?? ""),
              }))
            );
            if (outcome.budgetExceeded) {
              quotaStopped = true;
              log({ phase: "budget_stop", message: "monthly AI budget reached; residue stays pending" });
              break;
            }
            for (const review of pending) {
              const got = outcome.extracted.get(review.id);
              if (!got) continue;
              await commitValidatedExtraction(admin, toItem(review), got.extraction, got.model);
              stored += 1;
            }
            pending = pending.filter((review) => outcome.failedIds.includes(review.id));
          } catch (error) {
            const message = error instanceof Error ? error.message : "batch failed";
            if (/quota/i.test(message)) {
              quotaStopped = true;
              log({ phase: "quota_stop", message: message.slice(0, 200) });
              break;
            }
            log({ phase: "batch_failed", attempt, message: message.slice(0, 200) });
          }
        }
        failed += pending.length;
        for (const review of pending.slice(0, 20)) if (failedIds.length < 20) failedIds.push(review.id);
        log({ phase: "batch", done: Math.min(offset + BATCH_SIZE, residue.length), total: residue.length, stored, failed });
      }
    }
    log({ phase: "extract_done", stored, failed, failedIds, residueTotal: residue.length });

    if (doEmbed && failed === 0 && !quotaStopped) {
      const embeddedKeys = new Set(embeddings.map((row) => `${row.review_id}|${row.content_hash}`));
      const embedList = work.flatMap((review) => {
        const text = embeddingInput(review.comment);
        if (!text) return [];
        const hash = embeddingContentHash(text);
        if (embeddedKeys.has(`${review.id}|${hash}`)) return [];
        return [{ review, text, hash }];
      });
      const scopedEmbed = limit > 0 ? embedList.slice(0, limit) : embedList;
      let embedded = 0;
      let embedFailed = 0;
      let embedQuotaStopped = false;
      let cost = 0;
      let embedChars = 0;
      await pool(scopedEmbed, concurrency, async (item, index) => {
        if (embedQuotaStopped) return;
        try {
          let result: Awaited<ReturnType<typeof requestEmbedding>> | null = null;
          let lastError: unknown = null;
          for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
            try {
              result = await requestEmbedding(item.text);
            } catch (error) {
              lastError = error;
            }
          }
          if (!result) throw lastError instanceof Error ? lastError : new Error("embedding failed");
          const { error } = await admin.from("grm_review_embeddings").upsert(
            {
              workspace_id: workspaceId,
              review_id: item.review.id,
              content_hash: item.hash,
              model: result.model,
              dimensions: result.dimensions,
              embedding: `[${result.values.map((value) => Number(value.toFixed(6))).join(",")}]`,
            },
            { onConflict: "review_id,model,content_hash" }
          );
          if (error) throw new Error(error.message);
          embedded += 1;
          cost += result.estimatedCostUsd;
          embedChars += item.text.length;
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed";
          if (/quota/i.test(message)) {
            embedQuotaStopped = true;
            log({ phase: "quota_stop", message: message.slice(0, 200) });
            return;
          }
          embedFailed += 1;
          log({ phase: "embed_failed", reviewId: item.review.id, message: message.slice(0, 200) });
        }
        if ((index + 1) % 50 === 0 || index + 1 === scopedEmbed.length) {
          log({ phase: "embed", done: index + 1, total: scopedEmbed.length, embedded, failed: embedFailed, checkpoint: item.review.id });
        }
      });
      await recordAiUsage(admin, {
        workspaceId,
        operation: "embed_review",
        model: EMBEDDING_MODEL,
        inputTokens: Math.ceil(embedChars / 4),
        outputTokens: 0,
        calls: embedded,
      });
      log({ phase: "embed_done", embedded, failed: embedFailed, estimatedCostUsd: Number(cost.toFixed(4)) });
      expect(embedQuotaStopped).toBe(false);
      expect(embedFailed).toBe(0);
    }

    for (const locationId of locationIds) {
      await invalidateLocationSummaries(admin, workspaceId, locationId);
    }
    log({ phase: "summaries_invalidated", locations: locationIds.length });
    expect(quotaStopped).toBe(false);
    expect(failed).toBe(0);
  }, 2 * 60 * 60 * 1000);
});
