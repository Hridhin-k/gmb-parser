import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIReviewService } from "@/lib/services/ai-review";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { validateId } from "@/lib/validation";
import { checkRateLimit, AI_GENERATE_LIMIT } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

/**
 * POST /api/reviews/[reviewId]/generate
 *
 * Generate an AI draft response for a review.
 * Server-only — Gemini API key never reaches the browser.
 */
export async function POST(_request: Request, { params }: RouteParams) {
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

  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: review } = await admin
    .from("grm_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  try {
    const result = await AIReviewService.generateDraft({
      reviewId,
      workspaceId: membership.workspace_id,
      userId: user.id,
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
