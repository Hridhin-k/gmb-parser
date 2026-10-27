import { generateAi } from "@/lib/ai/service";
import { extractionSchema } from "@/lib/ai/schemas";
import { createAdminClient } from "@/lib/db/client";

import { logger } from "@/lib/logger";
import { contentFingerprint } from "@/lib/review-version";
import { detectReviewLanguage } from "@/lib/review-inbox";
import {
  aggregateObservations,
  extractionPrompt,
  parseExtractionResponse,
  validateObservations,
  ANALYSIS_VERSION,
  type ObservationAggregates,
  type ObservationRow,
} from "@/lib/review-intelligence";

type Admin = ReturnType<typeof createAdminClient>;

const REQUEST_TIMEOUT_MS = 45_000;
const PAGE = 1000;

export type AnalysisOutcome =
  | { reviewId: string; status: "ready"; observationCount: number; reused: boolean }
  | { reviewId: string; status: "no_text"; reused: boolean }
  | { reviewId: string; status: "failed"; error: string };

export interface ReviewForAnalysis {
  id: string;
  location_id: string;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  review_language: string | null;
  content_fingerprint: string | null;
}

export function fingerprintOf(review: ReviewForAnalysis): string {
  return (
    review.content_fingerprint ??
    contentFingerprint({
      starRating: review.star_rating,
      comment: review.comment,
      createTime: review.review_create_time,
    })
  );
}

const locationContextCache = new Map<string, { clientId: string | null; groupId: string | null }>();

async function loadLocationContext(
  admin: Admin,
  workspaceId: string,
  locationId: string
): Promise<{ clientId: string | null; groupId: string | null }> {
  const cacheKey = `${workspaceId}:${locationId}`;
  const cached = locationContextCache.get(cacheKey);
  if (cached) return cached;
  const { data } = await admin
    .from("grm_google_locations")
    .select("client_id, group_id")
    .eq("id", locationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const context = { clientId: data?.client_id ?? null, groupId: data?.group_id ?? null };
  if (locationContextCache.size > 5000) locationContextCache.clear();
  locationContextCache.set(cacheKey, context);
  return context;
}

async function callExtractor(comment: string, starRating: number, workspaceId: string) {
  return generateAi({
    workspaceId, task: "extract", operation: "extract_review",
    prompt: extractionPrompt({ comment, starRating }), schema: extractionSchema,
    temperature: 0.1, maxOutputTokens: 4096, timeoutMs: REQUEST_TIMEOUT_MS,
  });
}

async function upsertAnalysisRow(
  admin: Admin,
  workspaceId: string,
  review: ReviewForAnalysis,
  fingerprint: string,
  status: string
): Promise<string> {
  const { data: existing } = await admin
    .from("grm_review_analyses")
    .select("id")
    .eq("review_id", review.id)
    .eq("analysis_version", ANALYSIS_VERSION)
    .maybeSingle();
  if (existing) {
    const { error } = await admin
      .from("grm_review_analyses")
      .update({ status, error: null, content_fingerprint: fingerprint })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to record review analysis: ${error.message}`);
    return existing.id as string;
  }
  const { data: saved, error: saveError } = await admin
    .from("grm_review_analyses")
    .insert({
      workspace_id: workspaceId,
      review_id: review.id,
      location_id: review.location_id,
      analysis_version: ANALYSIS_VERSION,
      content_fingerprint: fingerprint,
      status,
    })
    .select("id")
    .single();
  if (saveError || !saved) {
    throw new Error(`Failed to record review analysis: ${saveError?.message ?? "unknown"}`);
  }
  return saved.id as string;
}

/**
 * Stores validated observations for one review and marks its analysis
 * ready. Replace, never append: retries of the same analysis stay
 * duplicate-free under the observations' dedupe keys.
 */
export async function persistAnalysisResult(
  admin: Admin,
  workspaceId: string,
  review: ReviewForAnalysis,
  observations: ReturnType<typeof validateObservations>,
  model: string
): Promise<void> {
  const fingerprint = fingerprintOf(review);
  const analysisId = await upsertAnalysisRow(admin, workspaceId, review, fingerprint, "processing");
  const context = await loadLocationContext(admin, workspaceId, review.location_id);
  const language = review.review_language ?? detectReviewLanguage(review.comment ?? "");

  await admin.from("grm_review_observations").delete().eq("analysis_id", analysisId);
  if (observations.length > 0) {
    const { error: insertError } = await admin.from("grm_review_observations").insert(
      observations.map((obs) => ({
        workspace_id: workspaceId,
        analysis_id: analysisId,
        review_id: review.id,
        location_id: review.location_id,
        client_id: context.clientId,
        group_id: context.groupId,
        review_create_time: review.review_create_time,
        star_rating: review.star_rating,
        language,
        topic: obs.topic,
        subtopic: obs.subtopic,
        sentiment: obs.sentiment,
        detail: obs.detail,
        entity_type: obs.entityType,
        entity_name: obs.entityName,
        severity: obs.severity,
        severity_rationale: obs.severityRationale,
        evidence_excerpt: obs.evidenceExcerpt,
        evidence_start: obs.evidenceStart,
        evidence_end: obs.evidenceEnd,
        basis: obs.basis,
        confidence: obs.confidence,
        is_ambiguous: obs.isAmbiguous,
        dedupe_key: obs.dedupeKey,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  }
  const { error } = await admin
    .from("grm_review_analyses")
    .update({
      status: "ready",
      observation_count: observations.length,
      model,
      error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", analysisId);
  if (error) throw new Error(error.message);
}

/** Records a failed analysis so the review is accounted for and can be retried later. */
export async function markAnalysisFailed(
  admin: Admin,
  workspaceId: string,
  review: ReviewForAnalysis,
  message: string
): Promise<void> {
  const fingerprint = fingerprintOf(review);
  const analysisId = await upsertAnalysisRow(admin, workspaceId, review, fingerprint, "failed");
  await admin
    .from("grm_review_analyses")
    .update({ status: "failed", error: message.slice(0, 500) })
    .eq("id", analysisId);
}

/** Rating-only reviews are accounted for without a model call. They are never evidence. */
export async function markRatingOnly(
  admin: Admin,
  workspaceId: string,
  review: ReviewForAnalysis
): Promise<void> {
  await markRatingOnlyBulk(admin, workspaceId, [review]);
}

/**
 * Bulk no_text accounting for rating-only reviews: one upsert per chunk
 * instead of three round trips per review. Any observations left over
 * from a previous written version of the review are removed — a
 * rating-only review is never evidence.
 */
export async function markRatingOnlyBulk(
  admin: Admin,
  workspaceId: string,
  reviews: ReviewForAnalysis[]
): Promise<void> {
  for (let i = 0; i < reviews.length; i += 200) {
    const group = reviews.slice(i, i + 200);
    const { data, error } = await admin
      .from("grm_review_analyses")
      .upsert(
        group.map((review) => ({
          workspace_id: workspaceId,
          review_id: review.id,
          location_id: review.location_id,
          analysis_version: ANALYSIS_VERSION,
          content_fingerprint: fingerprintOf(review),
          status: "no_text",
          observation_count: 0,
          model: null,
          error: null,
          processed_at: new Date().toISOString(),
        })),
        { onConflict: "review_id,analysis_version" }
      )
      .select("id");
    if (error) throw new Error(`Failed to record rating-only reviews: ${error.message}`);
    const ids = (data ?? []).map((row) => row.id as string);
    if (ids.length > 0) {
      await admin.from("grm_review_observations").delete().in("analysis_id", ids);
    }
  }
}

/**
 * Analyses one review into stored observations. Idempotent: a ready
 * analysis for the same content fingerprint and version is reused, and
 * reprocessing replaces the analysis's observations under their dedupe
 * keys instead of adding copies.
 */
export async function analyzeReview(
  admin: Admin,
  workspaceId: string,
  reviewId: string
): Promise<AnalysisOutcome> {
  const { data: review, error } = await admin
    .from("grm_reviews")
    .select("id, location_id, star_rating, comment, review_create_time, review_language, content_fingerprint")
    .eq("id", reviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load review: ${error.message}`);
  if (!review) throw new Error("Review not found");

  const typed = review as ReviewForAnalysis;
  const fingerprint = fingerprintOf(typed);
  const comment = typed.comment?.trim() ?? "";

  const { data: existing } = await admin
    .from("grm_review_analyses")
    .select("id, status, observation_count, content_fingerprint")
    .eq("review_id", reviewId)
    .eq("analysis_version", ANALYSIS_VERSION)
    .maybeSingle();

  if (
    existing &&
    existing.content_fingerprint === fingerprint &&
    (existing.status === "ready" || existing.status === "no_text")
  ) {
    return existing.status === "no_text"
      ? { reviewId, status: "no_text", reused: true }
      : { reviewId, status: "ready", observationCount: existing.observation_count, reused: true };
  }

  if (!comment) {
    await markRatingOnly(admin, workspaceId, typed);
    return { reviewId, status: "no_text", reused: false };
  }

  try {
    const { text, model } = await callExtractor(comment, typed.star_rating, workspaceId);
    const observations = validateObservations(parseExtractionResponse(text), comment);
    await persistAnalysisResult(admin, workspaceId, typed, observations, model);
    return { reviewId, status: "ready", observationCount: observations.length, reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    await markAnalysisFailed(admin, workspaceId, typed, message).catch(() => undefined);
    logger.error("review_observation.failed", { reviewId, message });
    return { reviewId, status: "failed", error: message };
  }
}

/**
 * Aggregates computed from current (ready) analyses only. Stale and failed
 * analyses are excluded; their observations remain stored for traceability.
 */
export async function loadObservationAggregates(
  workspaceId: string,
  input: { locationIds: string[]; start: string | null; end: string | null }
): Promise<ObservationAggregates & { storedObservations: number }> {
  const admin = createAdminClient();
  const rows: ObservationRow[] = [];
  if (input.locationIds.length === 0) return { ...aggregateObservations([]), storedObservations: 0 };

  for (let c = 0; c < input.locationIds.length; c += 80) {
    const locationChunk = input.locationIds.slice(c, c + 80);
    let from = 0;
    for (;;) {
      let query = admin
        .from("grm_review_observations")
        .select(
          "review_id, location_id, client_id, group_id, review_create_time, star_rating, topic, subtopic, sentiment, detail, entity_type, entity_name, severity, severity_rationale, evidence_excerpt, evidence_start, evidence_end, basis, confidence, is_ambiguous, dedupe_key, grm_review_analyses!inner(status)"
        )
        .eq("workspace_id", workspaceId)
        .in("location_id", locationChunk)
      .eq("grm_review_analyses.status", "ready")
      .order("review_create_time", { ascending: false })
      .range(from, from + PAGE - 1);
    if (input.start) query = query.gte("review_create_time", input.start);
    if (input.end) query = query.lt("review_create_time", input.end);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load observations: ${error.message}`);
    const page = data ?? [];
    for (const row of page) {
      rows.push({
        reviewId: row.review_id,
        locationId: row.location_id,
        clientId: row.client_id,
        groupId: row.group_id,
        reviewCreateTime: row.review_create_time,
        starRating: row.star_rating,
        topic: row.topic,
        subtopic: row.subtopic,
        sentiment: row.sentiment as ObservationRow["sentiment"],
        detail: row.detail,
        entityType: row.entity_type as ObservationRow["entityType"],
        entityName: row.entity_name,
        severity: row.severity,
        severityRationale: row.severity_rationale,
        evidenceExcerpt: row.evidence_excerpt,
        evidenceStart: row.evidence_start,
        evidenceEnd: row.evidence_end,
        basis: row.basis as ObservationRow["basis"],
        confidence: row.confidence,
        isAmbiguous: row.is_ambiguous,
        dedupeKey: row.dedupe_key,
      });
    }
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }
  return { ...aggregateObservations(rows), storedObservations: rows.length };
}
