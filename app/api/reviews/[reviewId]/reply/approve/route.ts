import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { parseBody, validateId, approveReplyBodySchema } from "@/lib/validation";
import { toUserMessage, toStatusCode, AppError } from "@/lib/errors";
import { assertCanApproveReplies, ensurePersonalWorkspace } from "@/lib/services/workspace";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

/**
 * POST /api/reviews/[reviewId]/reply/approve
 * Body: { replyId: string }
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
    body = await parseBody(request, approveReplyBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: toStatusCode(e) });
  }

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user);

  try {
    await assertCanApproveReplies(user.id, membership.workspace_id);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const { data: reply } = await admin
    .from("grm_review_replies")
    .select("id, status")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });

  if (reply.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft replies can be approved" },
      { status: 400 }
    );
  }

  await admin
    .from("grm_review_replies")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
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
    entityId: body.replyId,
  });

  return NextResponse.json({ success: true });
}
