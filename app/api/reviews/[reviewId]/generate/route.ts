import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIReviewService } from "@/lib/services/ai-review";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { validateId } from "@/lib/validation";
import { type DraftAdjustment, type ReplyLanguage } from "@/lib/reply-adjustments";
import { z } from "zod";
import { checkRateLimit, AI_GENERATE_LIMIT } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertReviewAction } from "@/lib/services/access";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

/**
 * POST /api/reviews/[reviewId]/generate
 *
 * Generate an AI draft response for a review.
 * Server-only — Gemini API key never reaches the browser.
 */
const generateBodySchema = z.object({
  adjustment: z.enum(["regenerate", "shorter", "warmer", "formal"]).optional(),
  language: z.enum(["en", "ml", "manglish", "hi", "hinglish", "ar"]).optional(),
  replaceEdited: z.boolean().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { reviewId: rawReviewId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let reviewId: string;
  try {
    reviewId = validateId(rawReviewId, "reviewId");
  } catch {
    return NextResponse.json({ error: "Invalid review ID" }, { status: 400 });
  }

  // Rate limit: protect against repeated AI generation requests
  const rl = checkRateLimit(user.id, "ai.generate", AI_GENERATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait before generating again." },
      { status: 429 }
    );
  }

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user);
  try {
    await assertReviewAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      action: "draft",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const { data: review } = await admin
    .from("grm_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  let adjustment: DraftAdjustment | undefined;
  let replaceEdited = false;
  const rawBody = await request.text();
  if (rawBody.trim()) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "That reply adjustment is not supported." }, { status: 400 });
    }
    const parsed = generateBodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "That reply adjustment is not supported." }, { status: 400 });
    }
    replaceEdited = parsed.data.replaceEdited ?? false;
    if (parsed.data.language) {
      adjustment = { kind: "language", language: parsed.data.language as ReplyLanguage };
    } else if (parsed.data.adjustment) {
      adjustment = { kind: parsed.data.adjustment };
    }
  }

  try {
    const result = await AIReviewService.generateDraft({
      reviewId,
      workspaceId: membership.workspace_id,
      userId: user.id,
      adjustment,
      replaceEdited,
    });

    return NextResponse.json({
      draftId: result.draftId,
      replyId: result.replyId,
      content: result.content,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    logger.error("ai.generate.unexpected", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
    });
    return NextResponse.json(
      { error: "Failed to generate AI response. Please try again." },
      { status: 500 }
    );
  }
}
