import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { assertReviewAction } from "@/lib/services/access";
import { assertSafePublicReply, replyContentHash } from "@/lib/services/reply-checks";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AppError, toUserMessage } from "@/lib/errors";
import { parseBody, validateId, approveReplyBodySchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let reviewId: string;
  try {
    reviewId = validateId((await params).reviewId, "reviewId");
  } catch {
    return NextResponse.json({ error: "Invalid review ID" }, { status: 400 });
  }

  let body: { replyId: string };
  try {
    body = await parseBody(request, approveReplyBodySchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: 400 });
  }

  const membership = await ensurePersonalWorkspace(user);
  const admin = createAdminClient();
  const { data: reply } = await admin
    .from("grm_review_replies")
    .select("id, status, content")
    .eq("id", body.replyId)
    .eq("review_id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();
  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  if (reply.status !== "draft") {
    return NextResponse.json({ error: "Only a draft can be submitted for approval." }, { status: 400 });
  }

  try {
    await assertReviewAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      action: "draft",
    });
    await assertSafePublicReply({
      workspaceId: membership.workspace_id,
      userId: user.id,
      reviewId,
      content: reply.content,
      stage: "submit",
    });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 400;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }

  await AuditService.log({
    workspaceId: membership.workspace_id,
    userId: user.id,
    action: "reply.submitted",
    entityType: "grm_reviews",
    entityId: reviewId,
    metadata: { replyId: reply.id, contentHash: replyContentHash(reply.content) },
  });

  return NextResponse.json({ ok: true });
}
