import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "./audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import {
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LOW,
  classifyGeminiError,
  extractGeminiText,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";
import { splitGoogleTranslation } from "@/lib/review-text";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = GEMINI_MODEL_ID;
const PROMPT_VERSION = "v3.0";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMMENT_CHARS = 4000;

const GENERATION_CONFIG = {
  temperature: 0.6,
  maxOutputTokens: 1024,
  topP: 0.9,
  thinkingConfig: GEMINI_THINKING_LOW,
};

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
}

export interface ReplyPlaybook {
  tone: string;
  do: string[];
  avoid: string[];
}

export interface ReviewContext {
  /** null when the reviewer is anonymous or has no usable name. */
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  businessName: string;
  locationName: string;
  playbook?: ReplyPlaybook | null;
  /** The unpublished draft being replaced when the user clicks Regenerate. */
  previousDraft?: string | null;
}

export interface GenerateDraftResult {
  draftId: string;
  replyId: string;
  content: string;
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

function playbookBlock(playbook: ReplyPlaybook | null | undefined): string {
  if (!playbook) return "";
  const lines: string[] = [];
  if (playbook.tone) lines.push(`Tone: ${playbook.tone}`);
  if (playbook.do.length) lines.push(`Do:\n${playbook.do.map((d) => `- ${d}`).join("\n")}`);
  if (playbook.avoid.length) {
    lines.push(`Avoid:\n${playbook.avoid.map((a) => `- ${a}`).join("\n")}`);
  }
  if (!lines.length) return "";
  return `\nTHIS LOCATION'S REPLY STYLE (from analysis of its past reviews — follow it unless it conflicts with the rules above)\n${lines.join("\n")}\n`;
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
${playbookBlock(ctx.playbook)}${previousDraftBlock(ctx.previousDraft)}
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

function playbookFromAnalysis(analysis: unknown): ReplyPlaybook | null {
  const pb = (analysis as { replyPlaybook?: Partial<ReplyPlaybook> } | null)?.replyPlaybook;
  if (!pb || typeof pb !== "object") return null;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const playbook = {
    tone: typeof pb.tone === "string" ? pb.tone.trim() : "",
    do: list(pb.do).slice(0, 4),
    avoid: list(pb.avoid).slice(0, 4),
  };
  return playbook.tone || playbook.do.length || playbook.avoid.length ? playbook : null;
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

    const admin = createAdminClient();

    // Fetch review with location + client context
    const { data: review, error: reviewErr } = await admin
      .from("grm_reviews")
      .select(
        `id, star_rating, comment, reviewer_display_name, reviewer_is_anonymous,
         grm_google_locations!inner(
           location_title,
           grm_clients(name),
           grm_location_insights(workspace_id, analysis)
         ),
         grm_review_replies(content, status, workspace_id)`
      )
      .eq("id", params.reviewId)
      .eq("workspace_id", params.workspaceId)
      .single();

    if (reviewErr || !review) {
      throw new AppError("Review not found", "NOT_FOUND", 404);
    }

    const loc = Array.isArray(review.grm_google_locations)
      ? review.grm_google_locations[0]
      : review.grm_google_locations;
    const locTyped = loc as {
      location_title: string;
      grm_clients?: { name: string } | Array<{ name: string }> | null;
      grm_location_insights?: Array<{ workspace_id: string; analysis: unknown }> | null;
    };
    const clientData = locTyped.grm_clients;
    const businessName = Array.isArray(clientData)
      ? (clientData[0]?.name ?? locTyped.location_title)
      : (clientData?.name ?? locTyped.location_title);

    const insightRow = (locTyped.grm_location_insights ?? []).find(
      (row) => row.workspace_id === params.workspaceId
    );
    const replies = (review as {
      grm_review_replies?: Array<{ content: string; status: string; workspace_id: string }> | null;
    }).grm_review_replies;
    const previousDraft = (replies ?? []).find(
      (r) =>
        r.workspace_id === params.workspaceId &&
        (r.status === "draft" || r.status === "failed")
    )?.content;

    const ctx: ReviewContext = {
      reviewerName: review.reviewer_is_anonymous
        ? null
        : review.reviewer_display_name?.trim() || null,
      starRating: review.star_rating,
      comment: review.comment,
      businessName,
      locationName: locTyped.location_title,
      playbook: playbookFromAnalysis(insightRow?.analysis),
      previousDraft,
    };

    const systemPrompt = buildReplyPrompt(ctx);
    const promptHash = hashPrompt(systemPrompt);

    // Call Gemini
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let responseText: string;
    try {
      const response = await fetch(geminiGenerateUrl(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: GENERATION_CONFIG,
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const body = await response.text();
        logGeminiFailure("ai_review.gemini_failed", response.status, body, {
          reviewId: params.reviewId,
        });
        const classified = classifyGeminiError(response.status, body);
        throw new AppError(classified.message, `AI_${classified.type.toUpperCase()}`, 502);
      }

      const data = await response.json();
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

      responseText = cleaned;
    } catch (error) {
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
    } finally {
      clearTimeout(timeout);
    }

    // Store AI draft (preserves the original AI output permanently)
    const { data: draft, error: draftErr } = await admin
      .from("grm_review_ai_drafts")
      .insert({
        workspace_id: params.workspaceId,
        review_id: params.reviewId,
        content: responseText,
        ai_model: MODEL_ID,
        prompt_version: PROMPT_VERSION,
        ai_prompt_hash: promptHash,
        generated_by: params.userId,
        generation_params: GENERATION_CONFIG,
      })
      .select("id")
      .single();

    if (draftErr || !draft) {
      logger.error("ai_review.store_draft_failed", {
        message: draftErr instanceof Error ? draftErr.message : "Unknown",
      });
      throw new AppError("Failed to store AI draft", "DB_ERROR", 500);
    }

    // Delete any existing non-published reply to avoid conflicts, then create new one
    await admin
      .from("grm_review_replies")
      .delete()
      .eq("review_id", params.reviewId)
      .eq("workspace_id", params.workspaceId)
      .in("status", ["draft", "failed"]);

    const { data: reply, error: replyErr } = await admin
      .from("grm_review_replies")
      .insert({
        workspace_id: params.workspaceId,
        review_id: params.reviewId,
        content: responseText,
        source: "ai" as const,
        status: "draft" as const,
        created_by: params.userId,
        ai_draft_id: draft.id,
      })
      .select("id")
      .single();

    if (replyErr || !reply) {
      logger.error("ai_review.create_reply_failed", {
        message: replyErr instanceof Error ? replyErr.message : "Unknown",
      });
      throw new AppError("Failed to create reply from AI draft", "DB_ERROR", 500);
    }

    // Update review reply_status
    await admin
      .from("grm_reviews")
      .update({ reply_status: "draft" })
      .eq("id", params.reviewId);

    await AuditService.log({
      workspaceId: params.workspaceId,
      userId: params.userId,
      action: "reply.ai_generated",
      entityType: "grm_review_ai_drafts",
      entityId: draft.id,
      metadata: { model: MODEL_ID, promptVersion: PROMPT_VERSION, reviewId: params.reviewId },
    });

    return {
      draftId: draft.id,
      replyId: reply.id,
      content: responseText,
    };
  }
}
