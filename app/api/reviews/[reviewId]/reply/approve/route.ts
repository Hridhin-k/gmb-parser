import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit";
import { parseBody, validateId, approveReplyBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode, AppError } from "@/lib/errors";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertReviewAction } from "@/lib/services/access";
import { assertSafePublicReply, replyContentHash } from "@/lib/services/reply-checks";
import { negativeReviewNeedsApproval } from "@/lib/reply-guardrails";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

/**
 * POST /api/reviews/[reviewId]/reply/approve
 * Body: { replyId: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { reviewId: rawReviewId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let reviewId: string;
  try {
    reviewId = validateId(rawReviewId, "reviewId");
  } catch {
    return NextResponse.json({ error: "Invalid review ID" }, { status: 400 });
  }

  let body: { replyId: string };
  try {
    body = await parseBody(request, approveReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user);

  try {
    await assertReviewAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      action: "approve",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const { data: reply } = await admin
    .from("grm_review_replies")
    .select("id, status, content, ai_draft_id, grm_reviews!inner(star_rating)")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });

  if (reply.status !== "draft" && reply.status !== "failed") {
    return NextResponse.json(
      { error: "Only a draft can be approved" },
      { status: 400 }
    );
  }

  try {
    await assertSafePublicReply({
      workspaceId: membership.workspace_id,
      userId: user.id,
      reviewId,
      content: reply.content,
      stage: "approve",
    });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 400;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }

  const approvedAt = new Date().toISOString();
  const reviewRow = Array.isArray(reply.grm_reviews) ? reply.grm_reviews[0] : reply.grm_reviews;

  await admin
    .from("grm_review_replies")
    .update({
      status: "approved",
      approved_at: approvedAt,
      approved_by: user.id,
      last_error: null,
    })
    .eq("id", body.replyId);

  await admin
    .from("grm_reviews")
    .update({ reply_status: "approved" })
    .eq("id", reviewId);

  await AuditService.log({
    workspaceId: membership.workspace_id,
    userId: user.id,
    action: "reply.approved",
    entityType: "grm_review_replies",
    entityId: reviewId,
    metadata: {
      replyId: body.replyId,
      decision: "approved",
      approvedAt,
      approverId: user.id,
      contentHash: replyContentHash(reply.content),
      draftId: reply.ai_draft_id,
      humanReview: negativeReviewNeedsApproval(reviewRow?.star_rating ?? 5),
    },
  });

  return NextResponse.json({ success: true });
}
