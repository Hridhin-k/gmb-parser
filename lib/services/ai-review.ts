import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "./audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createHash } from "crypto";
import {
  GEMINI_MODEL_ID,
  classifyGeminiError,
  geminiGenerateUrl,
  logGeminiFailure,
} from "@/lib/gemini";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = GEMINI_MODEL_ID;
const PROMPT_VERSION = "v2.0";
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateDraftParams {
  reviewId: string;
  workspaceId: string;
  userId: string;
}

interface ReviewContext {
  reviewerName: string;
  starRating: number;
  comment: string | null;
  businessName: string;
  locationName: string;
}

export interface GenerateDraftResult {
  draftId: string;
  replyId: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: ReviewContext): string {
  const ratingLabel =
    ctx.starRating <= 2 ? "negative" : ctx.starRating === 3 ? "mixed" : "positive";

  return `You are a reputation management professional writing a reply to a Google Business Profile review on behalf of "${ctx.businessName}" (location: "${ctx.locationName}").

The review is ${ratingLabel} (${ctx.starRating}/5 stars).

REVIEW:
Reviewer: ${ctx.reviewerName}
Rating: ${ctx.starRating}/5
${ctx.comment ? `Comment: ${ctx.comment}` : "Comment: (No written comment — rating only)"}

INSTRUCTIONS:
- Write a single, ready-to-publish reply. Output ONLY the reply text.
- Be professional, natural, and concise (2–4 sentences).
- Acknowledge the reviewer's specific experience when they left a comment.
- Reflect the tone appropriate for a ${ctx.starRating}-star review.

${ratingLabel === "negative" ? `NEGATIVE REVIEW GUIDELINES:
- Acknowledge the concern sincerely.
- Apologize where appropriate without admitting legal liability.
- Avoid defensiveness or arguing with the reviewer.
- Suggest resolving the matter privately when appropriate (e.g. "please reach out to us directly").
- Do not invent compensation, discounts, or specific remedies.
- Do not make promises the business has not authorized.` : ""}

${ratingLabel === "positive" ? `POSITIVE REVIEW GUIDELINES:
- Thank the reviewer genuinely.
- Reference specific positive points they mentioned when possible.
- Avoid repetitive template phrases like "We appreciate your kind words".` : ""}

${ratingLabel === "mixed" ? `MIXED REVIEW GUIDELINES:
- Thank the reviewer for their feedback.
- Acknowledge both positive aspects and concerns they raised.
- Offer to address concerns privately if appropriate.` : ""}

ABSOLUTE RULES:
- Write in the first person plural as the business ("we", "our team"). Do not add meta commentary about how the reply was drafted.
- Never invent facts, staff names, policies, phone numbers, email addresses, or URLs.
- Never include placeholder brackets like [Name] or [Phone].
- Never argue with or contradict the reviewer.
- Never make unsupported claims about the business.
- Never expose internal business information.`;
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
           grm_clients(name)
         )`
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
    };
    const clientData = locTyped.grm_clients;
    const businessName = Array.isArray(clientData)
      ? (clientData[0]?.name ?? locTyped.location_title)
      : (clientData?.name ?? locTyped.location_title);

    const ctx: ReviewContext = {
      reviewerName: review.reviewer_is_anonymous
        ? "a valued customer"
        : (review.reviewer_display_name || "a customer"),
      starRating: review.star_rating,
      comment: review.comment,
      businessName,
      locationName: locTyped.location_title,
    };

    const systemPrompt = buildSystemPrompt(ctx);
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
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 400,
            topP: 0.9,
          },
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
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text || typeof text !== "string" || text.trim().length < 5) {
        throw new AppError(
          "AI returned an empty or unusable response. Please try again.",
          "AI_INVALID_RESPONSE",
          502
        );
      }

      responseText = text.trim();
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
        generation_params: {
          temperature: 0.7,
          maxOutputTokens: 400,
          topP: 0.9,
        },
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
