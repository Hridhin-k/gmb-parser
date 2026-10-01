import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody, validateId, publishReplyBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode } from "@/lib/errors";
import { checkRateLimit, PUBLISH_LIMIT } from "@/lib/rate-limit";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

/**
 * POST /api/reviews/[reviewId]/reply/publish
 * Body: { replyId: string }
 *
 * Publishes an approved reply to Google. Success is only returned after
 * Google's API confirms the operation. No fake optimistic success.
 *
 * State machine enforced server-side:
 *   approved → pending_publish → published
 *                             ↘ failed (retryable via re-approve)
 */
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

  let body: { replyId: string };
  try {
    body = await parseBody(request, publishReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  // Rate limit: protect against accidental repeated publish clicks
  const rl = checkRateLimit(user.id, "reply.publish", PUBLISH_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many publish requests. Please wait before retrying." },
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

  const { data: replyCheck } = await admin
    .from("grm_review_replies")
    .select("id, status")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!replyCheck) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  if (replyCheck.status === "published") {
    return NextResponse.json({ success: true, published: true, alreadyPublished: true });
  }

  if (replyCheck.status === "pending_publish") {
    return NextResponse.json(
      { error: "This reply is already being published. Please wait." },
      { status: 409 }
    );
  }

  if (replyCheck.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved replies can be published." },
      { status: 400 }
    );
  }

  try {
    const result = await ReplyPublishingService.publishReply(
      body.replyId,
      reviewId,
      membership.workspace_id,
      user.id
    );

    return NextResponse.json({
      success: true,
      published: true,
      publishedAt: result.publishedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.statusCode === 409) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      if (
        error.code === "OAUTH_REVOKED" ||
        error.code === "OAUTH_INVALID_GRANT" ||
        error.code === "GOOGLE_AUTH" ||
        error.code === "GOOGLE_FORBIDDEN"
      ) {
        return NextResponse.json(
          { error: error.message, code: error.code, retryable: false },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: error.message, code: error.code, retryable: error.statusCode >= 500 },
        { status: error.statusCode }
      );
    }

    logger.error("reply.publish.unexpected", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      replyId: body.replyId,
    });
    return NextResponse.json(
      { error: "An unexpected error occurred while publishing. Please try again.", retryable: true },
      { status: 500 }
    );
  }
}
