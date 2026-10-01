import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { logger } from "@/lib/logger";
import {
  parseBody,
  validateId,
  createReplyBodySchema,
  updateReplyBodySchema,
  deleteReplyBodySchema,
} from "@/lib/validation";
import { toUserMessage, toStatusCode } from "@/lib/errors";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

async function getWorkspace(user: { id: string; email?: string | null }) {
  return ensurePersonalWorkspace(user);
}

/**
 * POST /api/reviews/[reviewId]/reply
 * Create a manual draft reply.
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

  let body: { content: string };
  try {
    body = await parseBody(request, createReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const membership = await getWorkspace(user);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  const { data: review } = await admin
    .from("grm_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const { data: reply, error } = await admin
    .from("grm_review_replies")
    .insert({
      workspace_id: membership.workspace_id,
      review_id: reviewId,
      content: body.content,
      source: "manual" as const,
      status: "draft" as const,
      created_by: user.id,
    })
    .select("id, content, source, status, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "An active reply already exists for this review." },
        { status: 409 }
      );
    }
    logger.error("reply.create.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      errorCode: error.code,
    });
    return NextResponse.json({ error: "Failed to create reply" }, { status: 500 });
  }

  await admin.from("grm_reviews").update({ reply_status: "draft" }).eq("id", reviewId);
  return NextResponse.json(reply, { status: 201 });
}

/**
 * PUT /api/reviews/[reviewId]/reply
 * Edit an existing draft reply.
 */
export async function PUT(request: Request, { params }: RouteParams) {
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

  let body: { content: string; replyId: string };
  try {
    body = await parseBody(request, updateReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const membership = await getWorkspace(user);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  const { data: reply } = await admin
    .from("grm_review_replies")
    .select("id, status")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });

  if (reply.status !== "draft" && reply.status !== "approved") {
    return NextResponse.json(
      { error: "Only draft or approved replies can be edited" },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("grm_review_replies")
    .update({ content: body.content, status: "draft" })
    .eq("id", body.replyId);

  if (error) {
    logger.error("reply.edit.failed", {
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      replyId: body.replyId,
      errorCode: error.code,
    });
    return NextResponse.json({ error: "Failed to update reply" }, { status: 500 });
  }

  await admin.from("grm_reviews").update({ reply_status: "draft" }).eq("id", reviewId);

  await AuditService.log({
    workspaceId: membership.workspace_id,
    userId: user.id,
    action: "reply.edited",
    entityType: "grm_review_replies",
    entityId: body.replyId,
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/reviews/[reviewId]/reply
 * Delete a draft reply.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
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
    body = await parseBody(request, deleteReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const membership = await getWorkspace(user);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  const { data: reply } = await admin
    .from("grm_review_replies")
    .select("id, status")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });

  if (reply.status === "published" || reply.status === "pending_publish") {
    return NextResponse.json(
      { error: "Cannot delete a published or pending reply" },
      { status: 400 }
    );
  }

  await admin.from("grm_review_replies").delete().eq("id", body.replyId);
  await admin.from("grm_reviews").update({ reply_status: "none" }).eq("id", reviewId);

  await AuditService.log({
    workspaceId: membership.workspace_id,
    userId: user.id,
    action: "reply.deleted",
    entityType: "grm_review_replies",
    entityId: body.replyId,
  });

  return NextResponse.json({ success: true });
}
