import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "./audit";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { forgetReviewList } from "@/lib/services/dashboard";
import { createHash } from "crypto";
import {
  GEMINI_FAST_MODEL_ID,
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  GEMINI_THINKING_MINIMAL,
  classifyGeminiError,
  extractGeminiText,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { splitGoogleTranslation } from "@/lib/review-text";
import type { Json } from "@/lib/types/supabase";
import { toneInstruction, type ToneVoice } from "@/lib/onboarding";
import { draftsPausedForLocation, resolvedToneForLocation } from "@/lib/services/hierarchy";
import { adjustmentInstruction, type DraftAdjustment } from "@/lib/reply-adjustments";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";
import { EscalationService } from "@/lib/services/escalations";
import {
  claimAiGenerationJob,
  completeAiGenerationJob,
  createAiGenerationJob,
  failAiGenerationJob,
} from "@/lib/services/ai-generation-jobs";
import { voiceGuide } from "@/lib/automation";
import { loadPromptContextForLocation } from "@/lib/services/ai-config";
import {
  knowledgePromptBlock,
  orgContextPromptBlock,
  templatesPromptBlock,
  type AiKnowledgeRow,
  type OrgContext,
} from "@/lib/ai-config";
import { inventedPromiseViolations, neverSayViolations, retrieveKnowledge } from "@/lib/reply-knowledge";
import { usageFromResponse } from "@/lib/gemini";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = GEMINI_MODEL_ID;
const PROMPT_VERSION = "v3.1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMMENT_CHARS = 4000;

const GENERATION_CONFIG = {
  temperature: 0.6,
  maxOutputTokens: 1024,
  topP: 0.9,
  thinkingConfig: GEMINI_THINKING_LOW,
};

export type DraftModelRoute = "fast" | "full";

const COMPLEX_REVIEW_CUES =
  /\b(but|however|although|though|except|wait(ed|ing)?|rude|dirty|unclean|refund|worst|terrible|awful|horrible|disappoint(ed|ing)?|problem|issue|broken|damaged|late|slow|cold|stale|cancel|booking|appointment|billing|charge[ds]?|pricey|expensive|overpriced|quality|missing|wrong|never|not good|not happy|poor|bad experience|complaint)\b/i;
const NON_LATIN_SCRIPT =
  /[\u0400-\u06FF\u0900-\u097F\u0D00-\u0D7F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

/**
 * Hybrid routing: a short, clearly positive review with no question, contrast,
 * or complaint cue is safe for the fast model. Anything else uses the full model.
 */
export function draftModelRoute(input: {
  starRating: number;
  comment: string | null;
  adjustmentKind?: string | null;
  hasPreviousDraft?: boolean;
}): DraftModelRoute {
  if (input.starRating <= 3) return "full";
  if (input.adjustmentKind && input.adjustmentKind !== "regenerate") return "full";
  if (input.hasPreviousDraft) return "full";
  const comment = input.comment?.trim() ?? "";
  if (!comment) return "fast";
  if (comment.length > 240) return "full";
  if (comment.includes("?")) return "full";
  if (NON_LATIN_SCRIPT.test(comment)) return "full";
  if (COMPLEX_REVIEW_CUES.test(comment)) return "full";
  const sentences = comment.split(/[.!?]+/).filter((part) => part.trim().length > 0);
  if (sentences.length > 2) return "full";
  return "fast";
}

/** The other draft model when the first is overloaded. A budget cap stays on the fast model. */
export function alternateDraftModel(modelId: string, budgetExceeded: boolean): string | null {
  if (modelId === GEMINI_FAST_MODEL_ID) return budgetExceeded ? null : GEMINI_MODEL_ID;
  return GEMINI_FAST_MODEL_ID;
}

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateDraftParams {
  reviewId: string;
  workspaceId: string;
  userId: string;
  adjustment?: DraftAdjustment;
  /** True only when the user explicitly asked to replace a draft they edited. */
  replaceEdited?: boolean;
  /** True only for a background worker. A pause blocks this path. A person drafting is unaffected. */
  automated?: boolean;
  /**
   * Save in the background: the generated text lands in grm_ai_generation_jobs
   * (one write) and the route schedules persistGenerationJob after responding.
   */
  deferPersistence?: boolean;
}

export interface ReviewContext {
  /** null when the reviewer is anonymous or has no usable name. */
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  businessName: string;
  locationName: string;
  /** The unpublished draft being replaced when the user clicks Regenerate. */
  previousDraft?: string | null;
  /** The draft to revise for shorter, warmer, formal, or language changes. */
  currentDraft?: string | null;
  adjustment?: DraftAdjustment | null;
  tone?: { voice: ToneVoice | null; note: string | null } | null;
  voiceGuide?: string | null;
  /** Organisation context from the active AI config (saved instructions, not training). */
  orgContext?: OrgContext | null;
  knowledge?: AiKnowledgeRow[] | null;
  templates?: Array<{ name: string; body: string }> | null;
}

export interface GenerateDraftResult {
  draftId: string;
  replyId: string;
  content: string;
  /** Set when persistence is deferred; replyId is provisional until the job saves. */
  jobId?: string;
  persistence?: "pending" | "saved";
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function lengthRule(comment: string | null): string {
  if (!comment) return "1–2 short sentences.";
  if (comment.length < 200) return "2–3 sentences.";
  return "3–5 sentences — enough to respond to every point they raised, and no more.";
}

function commentBlock(comment: string | null): string {
  if (!comment) return "Written comment: none (rating only)";
  const { original, translation } = splitGoogleTranslation(
    comment.slice(0, MAX_COMMENT_CHARS)
  );
  return translation
    ? `Written comment (original, as the reviewer wrote it):\n${original}\n\nGoogle's English translation (may be inaccurate):\n${translation}`
    : `Written comment:\n${original}`;
}

function previousDraftBlock(previous: string | null | undefined): string {
  const text = previous?.trim();
  if (!text) return "";
  return `\nPREVIOUS DRAFT (the user rejected it and asked for a new version)\n${text.slice(0, 1500)}\n- Write a noticeably different reply: a different opening line and different wording. Keep the same facts and follow every rule above.\n- If the previous draft was cut off or missed a point from the review, make sure the new one is complete and covers it.\n`;
}

export function buildReplyPrompt(ctx: ReviewContext): string {
  const comment = ctx.comment?.trim() || null;

  return `You write replies to Google reviews on behalf of "${ctx.businessName}" (location: "${ctx.locationName}"). The reply is published publicly under the business's name.

REVIEW
Reviewer name: ${ctx.reviewerName ?? "(anonymous — do not use a name)"}
Star rating: ${ctx.starRating}/5
${commentBlock(comment)}

READ THE REVIEW FIRST
- Base the tone on what the reviewer actually wrote. The star rating is only a hint: a 5-star review can contain a complaint and a 1-star review can contain praise. Respond to both sides.
- Identify every distinct point (praise, complaint, request, question). The reply must address each one — never answer only part of the review.
- If the comment is unclear, very short, or only emojis, keep the reply short and general instead of guessing what they meant.
- With no written comment: thank them for the rating. For 1–3 stars, also invite them to tell the business directly what went wrong.

LANGUAGE
- Reply in English when the reviewer wrote in English, or in another language typed in English letters (for example Malayalam or Hindi written in the Latin alphabet).
- If the reviewer wrote in another script (for example Malayalam or Hindi script), reply in that same language and script.

LENGTH
- ${lengthRule(comment)}
- Every sentence must be complete. No signature, sign-off name, or hashtags. Use an emoji only if the reviewer did.

RULES
- Write as the business in first person plural ("we", "our team").
- Use the reviewer's first name at most once; skip it if it looks like a username.
- Refer to the specifics they mentioned (products, sections, staff, waiting, prices) in your own words. Do not copy their sentences back.
- For complaints: apologise sincerely without admitting legal liability, do not argue or make excuses, and invite them to contact the business directly so it can be put right.
- Never claim an action the business has not confirmed (for example "we have retrained our staff", "we are adding more counters", "it is back in stock"). Say the feedback will be shared with the team instead.
- Never offer refunds, discounts, gifts, or compensation.
- Never invent facts, staff names, policies, opening hours, phone numbers, email addresses, or URLs. Never use placeholders like [Name].
- Avoid stock phrases such as "We appreciate your kind words" or "Your feedback is valuable to us".
${toneInstruction(ctx.tone?.voice, ctx.tone?.note)}${ctx.voiceGuide ?? ""}${orgContextPromptBlock(ctx.orgContext ?? { industry: "", positioning: "", priorities: "", policies: "", legacyVoice: "", legacyNote: "" })}${knowledgePromptBlock(ctx.knowledge ?? [])}${templatesPromptBlock(ctx.templates ?? [])}${previousDraftBlock(ctx.previousDraft)}${adjustmentInstruction(ctx.adjustment, ctx.currentDraft)}
OUTPUT
Return only the reply text — no quotes, labels, or notes.`;
}

function cleanReply(text: string): string {
  return text
    .trim()
    .replace(/^(reply|response)\s*:\s*/i, "")
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

export { classifyGeminiError } from "@/lib/gemini";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AIReviewService {
  /**
   * Generate an AI draft for a review, store it in grm_review_ai_drafts,
   * create a linked grm_review_replies entry, and return both IDs.
   */
  static async generateDraft(
    params: GenerateDraftParams
  ): Promise<GenerateDraftResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AppError("Gemini API key not configured", "CONFIG_ERROR", 500);
    }
    const geminiKey = apiKey;

    const admin = createAdminClient();

    // Fetch review with location + client context
    const { data: review, error: reviewErr } = await admin
      .from("grm_reviews")
      .select(
        `id, location_id, star_rating, comment, reviewer_display_name, reviewer_is_anonymous,
         grm_google_locations!inner(
           location_title,
           hold_reason,
           client_id,
           group_id,
           grm_clients(name)
         ),
         grm_review_replies(content, status, source, workspace_id, grm_review_ai_drafts(content))`
      )
      .eq("id", params.reviewId)
      .eq("workspace_id", params.workspaceId)
      .single();

    if (reviewErr || !review) {
      throw new AppError("Review not found", "NOT_FOUND", 404);
    }

    if (params.automated) {
      const pauses = await EscalationService.pausedTargets(params.workspaceId);
      const place = await admin
        .from("grm_google_locations")
        .select("client_id")
        .eq("id", review.location_id)
        .maybeSingle();
      const blocked =
        pauses.workspace ||
        pauses.locationIds.includes(review.location_id) ||
        Boolean(place.data?.client_id && pauses.clientIds.includes(place.data.client_id));
      if (blocked || (await draftsPausedForLocation(params.workspaceId, review.location_id))) {
        throw new AppError(
          "Automatic replies are paused for this location.",
          "AUTOREPLY_PAUSED",
          409
        );
      }
    }

    const loc = Array.isArray(review.grm_google_locations)
      ? review.grm_google_locations[0]
      : review.grm_google_locations;
    const locTyped = loc as {
      location_title: string;
      hold_reason?: string | null;
      client_id?: string | null;
      group_id?: string | null;
      grm_clients?: { name: string } | Array<{ name: string }> | null;
    };
    if (locTyped.hold_reason === "duplicate" || locTyped.hold_reason === "unverified") {
      throw new ValidationError(
        "This profile is unverified or a suspected duplicate, so automatic drafts stay off. You can still write a reply yourself."
      );
    }
    const clientData = locTyped.grm_clients;
    const businessName = Array.isArray(clientData)
      ? (clientData[0]?.name ?? locTyped.location_title)
      : (clientData?.name ?? locTyped.location_title);

    const replies = (review as {
      grm_review_replies?: Array<{
        content: string;
        status: string;
        source?: string;
        workspace_id: string;
        grm_review_ai_drafts?: { content: string } | Array<{ content: string }> | null;
      }> | null;
    }).grm_review_replies;
    const activeReply = (replies ?? []).find(
      (r) =>
        r.workspace_id === params.workspaceId &&
        (r.status === "draft" || r.status === "failed")
    );
    const linkedDraft = activeReply?.grm_review_ai_drafts;
    const originalDraft = Array.isArray(linkedDraft) ? linkedDraft[0]?.content : linkedDraft?.content;
    const manuallyEdited = Boolean(
      activeReply &&
        (activeReply.source === "manual" ||
          (originalDraft && originalDraft.trim() !== activeReply.content.trim()))
    );
    if (manuallyEdited && !params.replaceEdited) {
      throw new ValidationError(
        "This draft has manual edits. Use Shorter, Warmer, More formal, Regenerate, a language, or a template when you want to replace it."
      );
    }
    const previousDraft = activeReply?.content;
    const revising = params.adjustment && params.adjustment.kind !== "regenerate";

    const [tone, configured, promptContext] = await Promise.all([
      resolvedToneForLocation(params.workspaceId, review.location_id),
      import("@/lib/services/reply-settings").then((mod) =>
        mod.resolvedVoiceForDraft(params.workspaceId, {
          id: review.location_id,
          clientId: locTyped.client_id ?? null,
          groupId: locTyped.group_id ?? null,
          title: locTyped.location_title,
        })
      ),
      loadPromptContextForLocation(params.workspaceId, review.location_id),
    ]);
    const org = promptContext.config.snapshot.org;
    const knowledge = retrieveKnowledge(promptContext.knowledge, promptContext.scope, review.comment ?? "");
    const legacyTone =
      org.legacyVoice || org.legacyNote
        ? {
            voice: (org.legacyVoice || null) as ToneVoice | null,
            note: org.legacyNote || null,
          }
        : tone;
    const ctx: ReviewContext = {
      reviewerName: review.reviewer_is_anonymous
        ? null
        : review.reviewer_display_name?.trim() || null,
      starRating: review.star_rating,
      comment: review.comment,
      businessName,
      locationName: locTyped.location_title,
      previousDraft: revising ? null : previousDraft,
      currentDraft: revising ? previousDraft : null,
      adjustment: params.adjustment ?? null,
      tone: legacyTone,
      voiceGuide: voiceGuide(configured.tone, configured.automation.varyWording),
      orgContext: org,
      knowledge,
      templates: promptContext.templates,
    };

    const systemPrompt = buildReplyPrompt(ctx);
    const promptHash = hashPrompt(systemPrompt);
    const route = draftModelRoute({
      starRating: review.star_rating,
      comment: review.comment,
      adjustmentKind: params.adjustment?.kind ?? null,
      hasPreviousDraft: Boolean(previousDraft),
    });
    let modelId = route === "fast" ? GEMINI_FAST_MODEL_ID : MODEL_ID;
    // At the monthly budget, drafts stay available on the cheap model and the
    // full model is skipped. Deterministic features are unaffected.
    let budgetExceeded = false;
    if (modelId !== GEMINI_FAST_MODEL_ID) {
      const budget = await getAiBudget(admin, params.workspaceId);
      if (budget.exceeded) {
        modelId = GEMINI_FAST_MODEL_ID;
        budgetExceeded = true;
      }
    }
    const startedAt = Date.now();

    async function callModel(id: string): Promise<Response> {
      const generationConfig =
        id === GEMINI_FAST_MODEL_ID
          ? { ...GENERATION_CONFIG, thinkingConfig: GEMINI_THINKING_MINIMAL }
          : GENERATION_CONFIG;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(geminiGenerateUrl(geminiKey, id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig,
          }),
          signal: controller.signal,
          cache: "no-store",
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    let responseText: string;
    try {
      let response = await callModel(modelId);
      if (!response.ok && (response.status === 503 || response.status === 502)) {
        const failedBody = await response.text();
        logGeminiFailure("ai_review.gemini_failed", response.status, failedBody, {
          reviewId: params.reviewId,
          model: modelId,
        });
        const alternate = alternateDraftModel(modelId, budgetExceeded);
        if (!alternate) {
          const classified = classifyGeminiError(response.status, failedBody);
          throw new AppError(classified.message, `AI_${classified.type.toUpperCase()}`, 502);
        }
        logger.warn("ai_review.model_fallback", {
          reviewId: params.reviewId,
          from: modelId,
          to: alternate,
          status: response.status,
        });
        modelId = alternate;
        response = await callModel(modelId);
      }

      if (!response.ok) {
        const body = await response.text();
        logGeminiFailure("ai_review.gemini_failed", response.status, body, {
          reviewId: params.reviewId,
          model: modelId,
        });
        logger.error("ai_review.generate_failed", {
          workspaceId: params.workspaceId,
          reviewId: params.reviewId,
          aiConfigVersion: promptContext.config.version,
          durationMs: Date.now() - startedAt,
          success: false,
          statusCode: response.status,
        });
        const classified = classifyGeminiError(response.status, body);
        throw new AppError(classified.message, `AI_${classified.type.toUpperCase()}`, 502);
      }

      const data = await response.json();
      const draftUsage = usageFromResponse(data);
      await recordAiUsage(admin, {
        workspaceId: params.workspaceId,
        operation: "reply_draft",
        model: modelId,
        inputTokens: draftUsage.inputTokens,
        outputTokens: draftUsage.outputTokens,
      });
      const { text, finishReason } = extractGeminiText(data);
      const blockReason = (data as { promptFeedback?: { blockReason?: string } })
        .promptFeedback?.blockReason;

      if (blockReason || (finishReason && BLOCKED_FINISH_REASONS.has(finishReason))) {
        const classified = classifyGeminiError(null, "SAFETY");
        throw new AppError(classified.message, "AI_SAFETY_BLOCKED", 502);
      }

      if (finishReason === "MAX_TOKENS") {
        logger.warn("ai_review.truncated", {
          reviewId: params.reviewId,
          usage: (data as { usageMetadata?: unknown }).usageMetadata,
        });
        throw new AppError(
          "The AI reply was cut off before it finished. Please try again.",
          "AI_INVALID_RESPONSE",
          502
        );
      }

      const cleaned = cleanReply(text);
      if (cleaned.length < 5) {
        throw new AppError(
          "AI returned an empty or unusable response. Please try again.",
          "AI_INVALID_RESPONSE",
          502
        );
      }

      const violations = checkReplyGuardrails(cleaned);
      const forbidden = [
        ...neverSayViolations(cleaned, promptContext.config.snapshot.tone.neverSay ?? []),
        ...inventedPromiseViolations(cleaned, [org.policies]),
      ];
      if (forbidden.length) {
        throw new ValidationError("The draft used a phrase this organisation's rules do not allow.");
      }
      if (violations.length) {
        await AuditService.log({
          workspaceId: params.workspaceId,
          userId: params.userId,
          action: "reply.guardrail_blocked",
          entityType: "grm_reviews",
          entityId: params.reviewId,
          metadata: { codes: violations.map((item) => item.code), stage: "generate" },
        });
        throw new ValidationError(violations[0].message);
      }

      responseText = cleaned;
      logger.info("ai_review.generate_ok", {
        workspaceId: params.workspaceId,
        reviewId: params.reviewId,
        aiConfigVersion: promptContext.config.version,
        durationMs: Date.now() - startedAt,
        success: true,
        model: modelId,
        route,
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "VALIDATION_ERROR") {
        logger.error("ai_review.generate_failed", {
          workspaceId: params.workspaceId,
          reviewId: params.reviewId,
          aiConfigVersion: promptContext.config.version,
          durationMs: Date.now() - startedAt,
          success: false,
          errorCode: error instanceof AppError ? error.code : "UNKNOWN",
        });
      }
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError(
          "AI generation timed out. Please try again.",
          "AI_TIMEOUT",
          504
        );
      }
      throw new AppError(
        "Failed to reach AI service. Please try again.",
        "AI_UNAVAILABLE",
        502
      );
    }

    const generationConfig =
      modelId === GEMINI_FAST_MODEL_ID
        ? { ...GENERATION_CONFIG, thinkingConfig: GEMINI_THINKING_MINIMAL }
        : GENERATION_CONFIG;

    if (params.deferPersistence) {
      const jobId = await createAiGenerationJob({
        workspaceId: params.workspaceId,
        userId: params.userId,
        kind: "reply",
        reviewId: params.reviewId,
        model: modelId,
        route,
        content: responseText,
        payload: {
          promptHash,
          aiConfigVersion: promptContext.config.version,
          generationParams: generationConfig as unknown as Record<string, unknown>,
          adjustmentKind: params.adjustment?.kind ?? "regenerate",
          language: params.adjustment?.kind === "language" ? params.adjustment.language : null,
        },
      });
      if (jobId) {
        return {
          draftId: jobId,
          replyId: `pending:${jobId}`,
          content: responseText,
          jobId,
          persistence: "pending",
        };
      }
      // Jobs table unavailable: save synchronously below so the draft is safe.
    }

    const saved = await this.persistGeneratedDraft({
      workspaceId: params.workspaceId,
      reviewId: params.reviewId,
      userId: params.userId,
      content: responseText,
      modelId,
      route,
      promptHash,
      aiConfigVersion: promptContext.config.version,
      generationParams: generationConfig,
      adjustmentKind: params.adjustment?.kind ?? "regenerate",
      language: params.adjustment?.kind === "language" ? params.adjustment.language : null,
      generationId: null,
    });

    return { ...saved, content: responseText, persistence: "saved" };
  }

  /**
   * Writes a generated reply into place: AI draft row, draft reply, review
   * status, audit. Idempotent when generationId is set — a retry reuses the
   * draft and reply created by an earlier attempt.
   */
  static async persistGeneratedDraft(input: {
    workspaceId: string;
    reviewId: string;
    userId: string;
    content: string;
    modelId: string;
    route: string;
    promptHash: string;
    aiConfigVersion: number;
    generationParams: Record<string, unknown>;
    adjustmentKind: string;
    language: string | null;
    generationId: string | null;
  }): Promise<{ draftId: string; replyId: string }> {
    const admin = createAdminClient();

    let draftId: string | null = null;
    if (input.generationId) {
      const { data: existing } = await admin
        .from("grm_review_ai_drafts")
        .select("id")
        .eq("generation_id", input.generationId)
        .maybeSingle();
      draftId = existing?.id ?? null;
    }

    if (!draftId) {
      const { data: draft, error: draftErr } = await admin
        .from("grm_review_ai_drafts")
        .insert({
          workspace_id: input.workspaceId,
          review_id: input.reviewId,
          content: input.content,
          ai_model: input.modelId,
          prompt_version: PROMPT_VERSION,
          ai_prompt_hash: input.promptHash,
          ai_config_version: input.aiConfigVersion,
          generated_by: input.userId,
          generation_params: input.generationParams as unknown as Json,
          ...(input.generationId ? { generation_id: input.generationId } : {}),
        })
        .select("id")
        .single();

      if (draftErr || !draft) {
        logger.error("ai_review.store_draft_failed", {
          message: draftErr instanceof Error ? draftErr.message : "Unknown",
        });
        throw new AppError("Failed to store AI draft", "DB_ERROR", 500);
      }
      draftId = draft.id as string;
    }

    let replyId: string | null = null;
    let replyCreated = false;
    const { data: existingReply } = await admin
      .from("grm_review_replies")
      .select("id")
      .eq("ai_draft_id", draftId)
      .maybeSingle();
    replyId = existingReply?.id ?? null;

    if (!replyId) {
      const { data: existingRows, error: existingErr } = await admin
        .from("grm_review_replies")
        .select("id, status, created_at")
        .eq("review_id", input.reviewId)
        .eq("workspace_id", input.workspaceId)
        .in("status", ["draft", "approved", "pending_publish", "published", "failed"]);
      if (existingErr) {
        throw new AppError("Failed to create reply from AI draft", "DB_ERROR", 500);
      }
      const rank: Record<string, number> = {
        published: 0,
        pending_publish: 1,
        approved: 2,
        draft: 3,
        failed: 4,
      };
      const current = (existingRows ?? [])
        .slice()
        .sort(
          (a, b) =>
            (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
            Date.parse(b.created_at) - Date.parse(a.created_at)
        )[0];

      if (current && current.status !== "pending_publish") {
        const { error: updateErr } = await admin
          .from("grm_review_replies")
          .update({
            content: input.content,
            source: "ai" as const,
            status: "draft" as const,
            ai_draft_id: draftId,
            approved_at: null,
            approved_by: null,
          })
          .eq("id", current.id);
        if (updateErr) {
          logger.error("ai_review.create_reply_failed", {
            message: updateErr.message,
          });
          throw new AppError("Failed to create reply from AI draft", "DB_ERROR", 500);
        }
        replyId = current.id;
        replyCreated = true;
      } else if (!current) {
        const { data: reply, error: replyErr } = await admin
          .from("grm_review_replies")
          .insert({
            workspace_id: input.workspaceId,
            review_id: input.reviewId,
            content: input.content,
            source: "ai" as const,
            status: "draft" as const,
            created_by: input.userId,
            ai_draft_id: draftId,
          })
          .select("id")
          .single();

        if (replyErr || !reply) {
          logger.error("ai_review.create_reply_failed", {
            message: replyErr instanceof Error ? replyErr.message : "Unknown",
          });
          throw new AppError("Failed to create reply from AI draft", "DB_ERROR", 500);
        }
        replyId = reply.id as string;
        replyCreated = true;
      } else {
        throw new AppError(
          "This reply is being published. Wait until that finishes, then generate again.",
          "CONFLICT",
          409
        );
      }
    }

    await admin
      .from("grm_reviews")
      .update({ reply_status: "draft" })
      .eq("id", input.reviewId);
    forgetReviewList(input.workspaceId);

    if (replyCreated) {
      await AuditService.log({
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: "reply.ai_generated",
        entityType: "grm_review_ai_drafts",
        entityId: draftId,
        metadata: {
          model: input.modelId,
          route: input.route,
          promptVersion: PROMPT_VERSION,
          aiConfigVersion: input.aiConfigVersion,
          reviewId: input.reviewId,
          adjustment: input.adjustmentKind,
          language: input.language,
        },
      });
    }

    return { draftId, replyId };
  }

  /** Background persister for a deferred reply generation job. Safe to retry. */
  static async persistGenerationJob(jobId: string): Promise<void> {
    const job = await claimAiGenerationJob(jobId);
    if (!job || job.kind !== "reply" || !job.review_id || !job.content) return;
    try {
      const payload = job.payload as {
        promptHash?: string;
        aiConfigVersion?: number;
        generationParams?: Record<string, unknown>;
        adjustmentKind?: string;
        language?: string | null;
      };
      const saved = await this.persistGeneratedDraft({
        workspaceId: job.workspace_id,
        reviewId: job.review_id,
        userId: job.user_id,
        content: job.content,
        modelId: job.model,
        route: job.route ?? "full",
        promptHash: payload.promptHash ?? "",
        aiConfigVersion: payload.aiConfigVersion ?? 0,
        generationParams: payload.generationParams ?? {},
        adjustmentKind: payload.adjustmentKind ?? "regenerate",
        language: payload.language ?? null,
        generationId: job.id,
      });
      await completeAiGenerationJob(jobId, saved);
    } catch (error) {
      await failAiGenerationJob(jobId, job.attempts + 1, error);
    }
  }
}
