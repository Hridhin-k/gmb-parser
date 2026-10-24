import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertCanAssignReviews, assertReviewAction } from "@/lib/services/access";
import { AppError, toErrorCode, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    userId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("note"),
    body: z.string().trim().min(1).max(2000),
  }),
]);

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

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    const admin = createAdminClient();
    await assertReviewAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      reviewId,
      action: "draft",
    });
    const review = await admin
      .from("grm_reviews")
      .select("id")
      .eq("id", reviewId)
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();
    if (review.error || !review.data) {
      return NextResponse.json({ error: "That review is not in this workspace." }, { status: 404 });
    }

    if (body.action === "assign") {
      await assertCanAssignReviews(user.id, membership.workspace_id);
      if (body.userId) {
        const member = await admin
          .from("grm_workspace_members")
          .select("user_id")
          .eq("workspace_id", membership.workspace_id)
          .eq("user_id", body.userId)
          .maybeSingle();
        if (member.error || !member.data) {
          return NextResponse.json(
            { error: "That person is not in this workspace." },
            { status: 400 }
          );
        }
      }
      const { error } = await admin
        .from("grm_reviews")
        .update({ assigned_to: body.userId })
        .eq("id", reviewId)
        .eq("workspace_id", membership.workspace_id);
      if (error) throw new AppError("Could not assign the review.", "DB_ERROR", 500);
      await AuditService.log({
        workspaceId: membership.workspace_id,
        userId: user.id,
        action: "review.assigned",
        entityType: "grm_reviews",
        entityId: reviewId,
        metadata: { assigneeId: body.userId },
      });
      return NextResponse.json({ ok: true });
    }

    const { error } = await admin.from("grm_review_notes").insert({
      workspace_id: membership.workspace_id,
      review_id: reviewId,
      author_id: user.id,
      body: body.body,
    });
    if (error) throw new AppError("Could not save the note.", "DB_ERROR", 500);
    await AuditService.log({
      workspaceId: membership.workspace_id,
      userId: user.id,
      action: "review.note_added",
      entityType: "grm_reviews",
      entityId: reviewId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : toStatusCode(error);
    return NextResponse.json(
      { error: toUserMessage(error), code: toErrorCode(error) },
      { status }
    );
  }
}
