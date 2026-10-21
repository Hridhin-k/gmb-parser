import type { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, WORKSPACE_EMBED_LIMIT } from "@/lib/rate-limit";
import { processingErrorClass } from "@/lib/intelligence/job-machine";
import {
  EMBEDDING_MODEL,
  embeddingContentHash,
  embeddingInput,
  planEmbeddingWork,
  requestEmbedding,
} from "@/lib/intelligence/embed";
import { commitIsCurrent } from "@/lib/intelligence/freshness";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { logger } from "@/lib/logger";
import {
  persistClusterBuild,
  pointsFromReviews,
  rebuildFromPoints,
  loadPreviousClusters,
  type StoredClusterReview,
} from "@/lib/services/intelligence-cluster";

type Admin = ReturnType<typeof createAdminClient>;

const EMBED_BATCH = 8;

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value.toFixed(6))).join(",")}]`;
}

function parseVector(value: string | null): number[] {
  if (!value) return [];
  const body = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!body) return [];
  return body.split(",").map((part) => Number(part));
}

export async function processEmbedJobs(admin: Admin, workspaceId: string): Promise<{ stored: number; failed: number; reused: number }> {
  const { data: reviews, error } = await admin
    .from("grm_reviews")
    .select("id, location_id, comment")
    .eq("workspace_id", workspaceId)
    .is("missing_on_google_at", null)
    .not("comment", "is", null)
    .order("review_create_time", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const { data: existing, error: existingError } = await admin
    .from("grm_review_embeddings")
    .select("review_id, model, content_hash")
    .eq("workspace_id", workspaceId);
  if (existingError) throw new Error(existingError.message);
  const plan = planEmbeddingWork(
    (reviews ?? []).map((review) => ({ reviewId: review.id, comment: review.comment })),
    (existing ?? []).map((row) => ({ reviewId: row.review_id, model: row.model, contentHash: row.content_hash }))
  );
  const { data: openJobs, error: openError } = await admin
    .from("grm_intelligence_jobs")
    .select("id, review_id, source_hash, status, attempts, max_attempts, started_at")
    .eq("workspace_id", workspaceId)
    .eq("operation", "embed_review")
    .in("status", ["queued", "running"]);
  if (openError) throw new Error(openError.message);
  for (const open of openJobs ?? []) {
    const done = (existing ?? []).some(
      (row) => row.review_id === open.review_id && row.content_hash === open.source_hash && row.model === EMBEDDING_MODEL
    );
    if (!done) continue;
    await admin
      .from("grm_intelligence_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), last_error: null, error_class: null })
      .eq("id", open.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "running"]);
  }
  let stored = 0;
  let failed = 0;
  for (const item of plan.embed.slice(0, EMBED_BATCH)) {
    const budget = checkRateLimit(`workspace:${workspaceId}`, "intelligence.embed", WORKSPACE_EMBED_LIMIT);
    if (!budget.allowed) break;
    const review = (reviews ?? []).find((row) => row.id === item.reviewId);
    if (!review) continue;
    const open = (openJobs ?? []).find((job) => job.review_id === review.id && job.source_hash === item.contentHash);
    const startedAt = open?.started_at ? Date.parse(open.started_at) : 0;
    if (open?.status === "running" && Date.now() - startedAt < 2 * 60 * 1000) continue;
    let job: { id: string; attempts: number | null; max_attempts: number | null } | null = open
      ? { id: open.id, attempts: open.attempts, max_attempts: open.max_attempts }
      : null;
    if (!job) {
      const { data, error: insertError } = await admin
        .from("grm_intelligence_jobs")
        .insert({
          workspace_id: workspaceId,
          operation: "embed_review",
          status: "running",
          review_id: review.id,
          location_id: review.location_id,
          source_hash: item.contentHash,
          analysis_version: "embed-v1",
          started_at: new Date().toISOString(),
        })
        .select("id, attempts, max_attempts")
        .single();
      if (insertError) {
        if (insertError.code === "23505") continue;
        throw new Error(insertError.message);
      }
      job = data;
    } else {
      const { error: claimError } = await admin
        .from("grm_intelligence_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("workspace_id", workspaceId)
        .in("status", ["queued", "running"]);
      if (claimError) throw new Error(claimError.message);
    }
    if (!job) continue;
    try {
      const { data: live, error: liveError } = await admin
        .from("grm_reviews")
        .select("comment")
        .eq("id", review.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (liveError) throw new Error(liveError.message);
      const liveHash = embeddingContentHash(live?.comment ?? "");
      if (!commitIsCurrent({ sourceHash: item.contentHash, analysisVersion: "embed-v1" }, { sourceHash: liveHash, analysisVersion: "embed-v1" })) {
        await admin
          .from("grm_intelligence_jobs")
          .update({ status: "cancelled", finished_at: new Date().toISOString(), last_error: "Superseded by newer review text", error_class: null })
          .eq("id", job.id)
          .eq("workspace_id", workspaceId)
          .eq("status", "running");
        continue;
      }
      const result = await requestEmbedding(item.text);
      const { error: upsertError } = await admin.from("grm_review_embeddings").upsert(
        {
          workspace_id: workspaceId,
          review_id: review.id,
          content_hash: item.contentHash,
          model: result.model,
          dimensions: result.dimensions,
          embedding: vectorLiteral(result.values),
        },
        { onConflict: "review_id,model,content_hash" }
      );
      if (upsertError) throw new Error(upsertError.message);
      const { error: doneError } = await admin
        .from("grm_intelligence_jobs")
        .update({ status: "succeeded", finished_at: new Date().toISOString(), last_error: null, error_class: null })
        .eq("id", job.id)
        .eq("workspace_id", workspaceId)
        .eq("status", "running");
      if (doneError) throw new Error(doneError.message);
      stored += 1;
      logger.info("intelligence.embed_stored", {
        reviewId: review.id,
        latencyMs: result.latencyMs,
        estimatedCostUsd: result.estimatedCostUsd,
      });
    } catch (cause) {
      failed += 1;
      const message = cause instanceof Error ? cause.message : "embedding failed";
      const attempts = (job.attempts ?? 0) + 1;
      const maxAttempts = job.max_attempts ?? 5;
      const terminal = attempts >= maxAttempts;
      const { error: failError } = await admin
        .from("grm_intelligence_jobs")
        .update({
          status: terminal ? "failed" : "queued",
          attempts,
          error_class: processingErrorClass(message),
          last_error: message.slice(0, 500),
          not_before: terminal ? null : new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** (attempts - 1))).toISOString(),
          finished_at: terminal ? new Date().toISOString() : null,
          started_at: null,
        })
        .eq("id", job.id)
        .eq("status", "running");
      if (failError) logger.error("intelligence.embed_fail_write", { message: failError.message });
    }
  }
  return { stored, failed, reused: plan.reuse.length };
}

export interface EmbedReviewSetResult {
  stored: number;
  reused: number;
  failed: number;
  quotaStopped: boolean;
  budgetStopped: boolean;
}

/**
 * Embeds every supplied review whose text is long enough, skipping rows whose
 * current text is already stored. Used by Fazyo’s Update summary. The hourly
 * cron cap does not apply here; a provider quota or the monthly budget stops
 * the pass so the next click can continue.
 */
export async function embedReviewSet(
  admin: Admin,
  workspaceId: string,
  reviewIds: readonly string[],
  onProgress?: (progress: { stored: number; reused: number }) => void
): Promise<EmbedReviewSetResult> {
  const result: EmbedReviewSetResult = { stored: 0, reused: 0, failed: 0, quotaStopped: false, budgetStopped: false };
  if (reviewIds.length === 0) return result;
  const reviews: Array<{ id: string; comment: string | null }> = [];
  const existing: Array<{ reviewId: string; model: string; contentHash: string }> = [];
  for (let offset = 0; offset < reviewIds.length; offset += 100) {
    const slice = reviewIds.slice(offset, offset + 100);
    const [{ data: reviewRows, error: reviewError }, { data: embeddingRows, error: embeddingError }] = await Promise.all([
      admin.from("grm_reviews").select("id, comment").eq("workspace_id", workspaceId).in("id", slice),
      admin.from("grm_review_embeddings").select("review_id, model, content_hash").eq("workspace_id", workspaceId).in("review_id", slice),
    ]);
    if (reviewError) throw new Error(reviewError.message);
    if (embeddingError) throw new Error(embeddingError.message);
    reviews.push(...(reviewRows ?? []));
    existing.push(...(embeddingRows ?? []).map((row) => ({ reviewId: row.review_id, model: row.model, contentHash: row.content_hash })));
  }
  const plan = planEmbeddingWork(
    reviews.map((review) => ({ reviewId: review.id, comment: review.comment })),
    existing
  );
  result.reused = plan.reuse.length;
  for (const item of plan.embed) {
    const budget = await getAiBudget(admin, workspaceId);
    if (budget.exceeded) {
      result.budgetStopped = true;
      break;
    }
    try {
      const embedded = await requestEmbedding(item.text);
      const { error } = await admin.from("grm_review_embeddings").upsert(
        {
          workspace_id: workspaceId,
          review_id: item.reviewId,
          content_hash: item.contentHash,
          model: embedded.model,
          dimensions: embedded.dimensions,
          embedding: vectorLiteral(embedded.values),
        },
        { onConflict: "review_id,model,content_hash" }
      );
      if (error) throw new Error(error.message);
      await recordAiUsage(admin, {
        workspaceId,
        operation: "embed_review",
        model: embedded.model,
        inputTokens: Math.ceil(item.text.length / 4),
        outputTokens: 0,
      });
      result.stored += 1;
      if (result.stored % 25 === 0) onProgress?.({ stored: result.stored, reused: result.reused });
    } catch (error) {
      const message = error instanceof Error ? error.message : "embedding failed";
      if (/quota/i.test(message)) {
        result.quotaStopped = true;
        break;
      }
      result.failed += 1;
      logger.warn("intelligence.embed_set_failed", { workspaceId, reviewId: item.reviewId, message: message.slice(0, 200) });
    }
  }
  onProgress?.({ stored: result.stored, reused: result.reused });
  return result;
}

async function rowsById<T>(
  ids: readonly string[],
  load: (slice: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await load(ids.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function rebuildWorkspaceClusters(admin: Admin, workspaceId: string): Promise<number> {
  const embeddings: Array<{ review_id: string; content_hash: string; embedding: string | null; model: string }> = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("grm_review_embeddings")
      .select("review_id, content_hash, embedding, model")
      .eq("workspace_id", workspaceId)
      .eq("model", EMBEDDING_MODEL)
      .order("review_id", { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    embeddings.push(...page);
    if (page.length < 500) break;
  }
  if (embeddings.length === 0) return 0;
  const reviewIds = embeddings.map((row) => row.review_id);
  const [reviews, assignments, intelligence] = await Promise.all([
    rowsById(reviewIds, (slice) =>
      admin.from("grm_reviews").select("id, location_id, comment, review_create_time").eq("workspace_id", workspaceId).in("id", slice)
    ),
    rowsById(reviewIds, (slice) =>
      admin.from("grm_review_topic_assignments").select("review_id, excerpt, topic_id, polarity").eq("workspace_id", workspaceId).in("review_id", slice)
    ),
    rowsById(reviewIds, (slice) =>
      admin
        .from("grm_review_intelligence")
        .select("id, review_id, extraction")
        .eq("workspace_id", workspaceId)
        .eq("is_current", true)
        .in("review_id", slice)
    ),
  ]);
  const topicIds = [...new Set((assignments ?? []).map((row) => row.topic_id))];
  const { data: topics, error: topicError } = topicIds.length
    ? await admin.from("grm_topics").select("id, code").in("id", topicIds)
    : { data: [], error: null };
  if (topicError) throw new Error(topicError.message);
  const codeByTopic = new Map((topics ?? []).map((topic) => [topic.id, topic.code]));
  const reviewById = new Map((reviews ?? []).map((review) => [review.id, review]));
  const stored: StoredClusterReview[] = [];
  for (const row of embeddings) {
    const review = reviewById.get(row.review_id);
    const text = embeddingInput(review?.comment ?? null);
    if (!review || !text || embeddingContentHash(text) !== row.content_hash) continue;
    const related = (assignments ?? []).filter((assignment) => assignment.review_id === review.id);
    const current = (intelligence ?? []).find((item) => item.review_id === review.id);
    const extraction = current?.extraction as { interpretation?: { severity?: StoredClusterReview["severity"] } } | null;
    const severity = extraction?.interpretation?.severity ?? "low";
    const vector = parseVector(row.embedding);
    const byPolarity = new Map<"praise" | "complaint", { topics: string[]; excerpt: string }>();
    for (const assignment of related) {
      if (assignment.polarity !== "praise" && assignment.polarity !== "complaint") continue;
      const code = codeByTopic.get(assignment.topic_id);
      if (!code) continue;
      const entry = byPolarity.get(assignment.polarity) ?? { topics: [], excerpt: "" };
      entry.topics.push(code);
      if (!entry.excerpt && assignment.excerpt) entry.excerpt = assignment.excerpt;
      byPolarity.set(assignment.polarity, entry);
    }
    const sides = byPolarity.size > 0 ? [...byPolarity.entries()] : [[undefined, { topics: related.map((assignment) => codeByTopic.get(assignment.topic_id)).filter((code): code is string => Boolean(code)), excerpt: related[0]?.excerpt || "" }] as const];
    for (const [polarity, side] of sides) {
      stored.push({
        reviewId: review.id,
        workspaceId,
        locationId: review.location_id,
        createdAt: review.review_create_time,
        comment: review.comment,
        topics: side.topics,
        polarity,
        severity,
        vector,
        excerpt: side.excerpt || text.slice(0, 240),
        intelligenceId: current?.id ?? null,
      });
    }
  }
  const previous = await loadPreviousClusters(admin, workspaceId);
  const result = rebuildFromPoints(pointsFromReviews(stored), previous);
  await persistClusterBuild(admin, workspaceId, result.clusters, result.events);
  return result.clusters.length;
}
