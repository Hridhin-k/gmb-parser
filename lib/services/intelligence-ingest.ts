import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { PLATFORM_TAXONOMY_VERSION } from "@/lib/intelligence/identity";
import { contentFingerprint, responseFingerprint, RULES_ANALYSIS_VERSION } from "@/lib/intelligence/fingerprint";
import { EXTRACT_ANALYSIS_VERSION, bindAssignments, type ReviewExtraction } from "@/lib/intelligence/extraction";
import { alignStoredIntelligence } from "@/lib/intelligence/freshness";
import { TAXONOMY_VERSION } from "@/lib/intelligence/taxonomy";
import {
  reviewsConfirmedMissing,
  type ReviewVersionEffect,
} from "@/lib/intelligence/ingestion-plan";
import { buildRulesIntelligence } from "@/lib/intelligence/rules-intelligence";
import type { Database, Json } from "@/lib/types/supabase";
import { invalidateLocationSummaries } from "@/lib/services/summary-service";

export { invalidateLocationSummaries };

type Admin = ReturnType<typeof createAdminClient>;
type IntelligenceInsert = Database["public"]["Tables"]["grm_review_intelligence"]["Insert"];

/**
 * After the review upsert has succeeded. Failures are logged.
 * Reconciliation repairs a missed enqueue. Provider sync is not failed by this step.
 */
export async function applyIngestionEffects(
  supabase: Admin,
  input: {
    workspaceId: string;
    locationId: string;
    effects: ReviewVersionEffect[];
    now: string;
  }
): Promise<void> {
  for (const effect of input.effects) {
    try {
      if (effect.contentChanged || effect.responseChanged) {
        await supabase
          .from("grm_reviews")
          .update({ downstream_stale_at: input.now })
          .eq("id", effect.reviewId)
          .eq("workspace_id", input.workspaceId);
        await invalidateLocationSummaries(supabase, input.workspaceId, input.locationId);
      }
      if (!effect.contentChanged) continue;
      if (!effect.created && !effect.textChanged) {
        await alignCurrentIntelligence(supabase, input.workspaceId, input.locationId, effect);
        continue;
      }
      await supabase
        .from("grm_review_intelligence")
        .update({ is_current: false, status: "stale" })
        .eq("workspace_id", input.workspaceId)
        .eq("review_id", effect.reviewId)
        .eq("is_current", true)
        .neq("content_hash", effect.contentFingerprint);
      await enqueueClassify(supabase, {
        workspaceId: input.workspaceId,
        reviewId: effect.reviewId,
        locationId: input.locationId,
        sourceHash: effect.contentFingerprint,
      });
    } catch (error) {
      logger.error("intelligence.ingest_effect_failed", {
        reviewId: effect.reviewId,
        message: error instanceof Error ? error.message : "Unknown",
      });
    }
  }
}

export async function markConfirmedAbsences(
  supabase: Admin,
  input: {
    workspaceId: string;
    locationId: string;
    seenNames: readonly string[];
    now: string;
  }
): Promise<number> {
  const { data, error } = await supabase
    .from("grm_reviews")
    .select("id, google_review_name, missing_on_google_at")
    .eq("workspace_id", input.workspaceId)
    .eq("location_id", input.locationId);
  if (error || !Array.isArray(data)) return 0;
  const missing = reviewsConfirmedMissing(
    data.map((row) => ({
      id: row.id,
      googleReviewName: row.google_review_name,
      missingOnGoogleAt: row.missing_on_google_at,
    })),
    new Set(input.seenNames)
  );
  for (const row of missing) {
    const { error: updateError } = await supabase
      .from("grm_reviews")
      .update({ missing_on_google_at: input.now, downstream_stale_at: input.now })
      .eq("id", row.id)
      .eq("workspace_id", input.workspaceId)
      .is("missing_on_google_at", null);
    if (updateError) {
      logger.error("intelligence.absence_mark_failed", { reviewId: row.id, message: updateError.message });
      continue;
    }
    await supabase
      .from("grm_review_intelligence")
      .update({ is_current: false, status: "stale" })
      .eq("workspace_id", input.workspaceId)
      .eq("review_id", row.id)
      .eq("is_current", true);
    await invalidateLocationSummaries(supabase, input.workspaceId, input.locationId);
  }
  return missing.length;
}

async function alignCurrentIntelligence(
  supabase: Admin,
  workspaceId: string,
  locationId: string,
  effect: ReviewVersionEffect
): Promise<void> {
  const { data: review, error: reviewError } = await supabase
    .from("grm_reviews")
    .select("star_rating")
    .eq("id", effect.reviewId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (reviewError || !review) return;
  const { data: row, error } = await supabase
    .from("grm_review_intelligence")
    .select("id, content_hash, extraction")
    .eq("workspace_id", workspaceId)
    .eq("review_id", effect.reviewId)
    .eq("is_current", true)
    .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
    .maybeSingle();
  if (error) return;
  if (!row) {
    await enqueueClassify(supabase, {
      workspaceId,
      reviewId: effect.reviewId,
      locationId,
      sourceHash: effect.contentFingerprint,
    });
    return;
  }
  const extraction = alignStoredIntelligence(row.extraction, review.star_rating);
  if (!extraction) {
    await enqueueClassify(supabase, {
      workspaceId,
      reviewId: effect.reviewId,
      locationId,
      sourceHash: effect.contentFingerprint,
    });
    return;
  }
  const { data: updated, error: updateError } = await supabase
    .from("grm_review_intelligence")
    .update({ content_hash: effect.contentFingerprint, extraction: extraction as Json })
    .eq("id", row.id)
    .eq("workspace_id", workspaceId)
    .eq("content_hash", row.content_hash)
    .select("id");
  if (updateError) {
    logger.warn("intelligence.rating_align_failed", { reviewId: effect.reviewId, message: updateError.message });
    return;
  }
  if (!updated || updated.length === 0) {
    logger.warn("intelligence.rating_align_superseded", { reviewId: effect.reviewId });
  }
}

async function enqueueClassify(
  supabase: Admin,
  input: { workspaceId: string; reviewId: string; locationId: string; sourceHash: string }
): Promise<void> {
  const { data: open } = await supabase
    .from("grm_intelligence_jobs")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("operation", "classify_review")
    .eq("review_id", input.reviewId)
    .eq("source_hash", input.sourceHash)
    .in("status", ["queued", "running"])
    .limit(1);
  if (open && open.length > 0) return;
  const { error } = await supabase.from("grm_intelligence_jobs").insert({
    workspace_id: input.workspaceId,
    operation: "classify_review",
    status: "queued",
    review_id: input.reviewId,
    location_id: input.locationId,
    source_hash: input.sourceHash,
    analysis_version: EXTRACT_ANALYSIS_VERSION,
  });
  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}

export async function commitRulesIntelligence(
  supabase: Admin,
  review: {
    id: string;
    workspaceId: string;
    locationId: string;
    contentFingerprint: string;
    starRating: number;
    comment: string | null;
  }
): Promise<void> {
  const draft = buildRulesIntelligence({ starRating: review.starRating, comment: review.comment });
  const { data: existing, error: readError } = await supabase
    .from("grm_review_intelligence")
    .select("id, status, is_current")
    .eq("review_id", review.id)
    .eq("content_hash", review.contentFingerprint)
    .eq("analysis_version", RULES_ANALYSIS_VERSION)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  await supabase
    .from("grm_review_intelligence")
    .update({ is_current: false, status: "stale" })
    .eq("review_id", review.id)
    .eq("analysis_version", RULES_ANALYSIS_VERSION)
    .eq("is_current", true)
    .neq("content_hash", review.contentFingerprint);

  let intelligenceId = existing?.id ?? null;
  if (existing && existing.is_current && existing.status === "ready") {
    intelligenceId = existing.id;
  } else if (existing) {
    const { error } = await supabase
      .from("grm_review_intelligence")
      .update({
        is_current: true,
        status: "ready",
        sentiment: draft.sentiment,
        model: "rules",
        generated_at: new Date().toISOString(),
        error_class: null,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const row: IntelligenceInsert = {
      workspace_id: review.workspaceId,
      review_id: review.id,
      location_id: review.locationId,
      content_hash: review.contentFingerprint,
      analysis_version: RULES_ANALYSIS_VERSION,
      taxonomy_version: PLATFORM_TAXONOMY_VERSION,
      prompt_version: RULES_ANALYSIS_VERSION,
      model: "rules",
      sentiment: draft.sentiment,
      status: "ready",
      is_current: true,
      generated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("grm_review_intelligence").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    intelligenceId = data.id;
  }

  if (!draft.issueCode || !draft.excerpt || !intelligenceId) return;
  const { data: topic } = await supabase
    .from("grm_topics")
    .select("id")
    .is("workspace_id", null)
    .eq("taxonomy_version", PLATFORM_TAXONOMY_VERSION)
    .eq("kind", "issue")
    .eq("code", draft.issueCode)
    .maybeSingle();
  if (!topic) return;
  const { error: assignmentError } = await supabase.from("grm_review_topic_assignments").insert({
    workspace_id: review.workspaceId,
    intelligence_id: intelligenceId,
    review_id: review.id,
    topic_id: topic.id,
    relevance: 1,
    sentiment: draft.sentiment,
    polarity: "complaint",
    excerpt: draft.excerpt,
  });
  if (assignmentError && assignmentError.code !== "23505") {
    throw new Error(assignmentError.message);
  }
}

export async function commitValidatedExtraction(
  supabase: Admin,
  review: {
    id: string;
    workspaceId: string;
    locationId: string;
    contentFingerprint: string;
    comment: string | null;
  },
  extraction: ReviewExtraction,
  model: string
): Promise<void> {
  if (extraction.reused) return;
  const assignments = bindAssignments({
    workspaceId: review.workspaceId,
    reviewId: review.id,
    comment: review.comment,
    extraction,
  });
  await supabase
    .from("grm_review_intelligence")
    .update({ is_current: false, status: "stale" })
    .eq("review_id", review.id)
    .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
    .eq("is_current", true)
    .neq("content_hash", review.contentFingerprint);

  const { data: existing, error: readError } = await supabase
    .from("grm_review_intelligence")
    .select("id")
    .eq("review_id", review.id)
    .eq("content_hash", review.contentFingerprint)
    .eq("analysis_version", EXTRACT_ANALYSIS_VERSION)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const generatedAt = new Date().toISOString();
  let intelligenceId = existing?.id ?? null;
  if (existing) {
    const { error } = await supabase
      .from("grm_review_intelligence")
      .update({
        is_current: true,
        status: "ready",
        sentiment: extraction.interpretation.textSentiment,
        model,
        taxonomy_version: TAXONOMY_VERSION,
        prompt_version: EXTRACT_ANALYSIS_VERSION,
        extraction: extraction as unknown as Json,
        generated_at: generatedAt,
        error_class: null,
      })
      .eq("id", existing.id)
      .eq("workspace_id", review.workspaceId);
    if (error) throw new Error(error.message);
  } else {
    const row: IntelligenceInsert = {
      workspace_id: review.workspaceId,
      review_id: review.id,
      location_id: review.locationId,
      content_hash: review.contentFingerprint,
      analysis_version: EXTRACT_ANALYSIS_VERSION,
      taxonomy_version: TAXONOMY_VERSION,
      prompt_version: EXTRACT_ANALYSIS_VERSION,
      model,
      sentiment: extraction.interpretation.textSentiment,
      status: "ready",
      is_current: true,
      extraction: extraction as unknown as Json,
      generated_at: generatedAt,
    };
    const { data, error } = await supabase.from("grm_review_intelligence").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    intelligenceId = data.id;
  }
  if (!intelligenceId) return;

  await supabase.from("grm_review_topic_assignments").delete().eq("intelligence_id", intelligenceId).eq("workspace_id", review.workspaceId);
  for (const assignment of assignments) {
    const { data: topic, error: topicError } = await supabase
      .from("grm_topics")
      .select("id")
      .is("workspace_id", null)
      .eq("taxonomy_version", TAXONOMY_VERSION)
      .eq("kind", "topic")
      .eq("code", assignment.topicCode)
      .maybeSingle();
    if (topicError) throw new Error(topicError.message);
    if (!topic) throw new Error(`Topic ${assignment.topicCode} is not in ${TAXONOMY_VERSION}`);
    const { error: assignmentError } = await supabase.from("grm_review_topic_assignments").insert({
      workspace_id: review.workspaceId,
      intelligence_id: intelligenceId,
      review_id: review.id,
      topic_id: topic.id,
      relevance: assignment.confidence,
      sentiment: assignment.sentiment,
      polarity: assignment.polarity,
      excerpt: assignment.excerpt,
      assignment_rank: assignment.rank,
      confidence: assignment.confidence,
      uncertain: assignment.uncertain,
      basis: "quotation",
    });
    if (assignmentError && assignmentError.code !== "23505") throw new Error(assignmentError.message);
  }
}

export function fingerprintsForStored(row: {
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  google_reply_comment: string | null;
  content_fingerprint: string | null;
  response_fingerprint: string | null;
}): { content: string; response: string } {
  return {
    content:
      row.content_fingerprint ??
      contentFingerprint({
        starRating: row.star_rating,
        comment: row.comment,
        createTime: row.review_create_time,
      }),
    response: row.response_fingerprint ?? responseFingerprint(row.google_reply_comment),
  };
}
