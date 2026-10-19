import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { assertSafePublicReply } from "@/lib/services/reply-checks";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";
import { templateById } from "@/lib/reply-adjustments";

const bodySchema = z.object({
  templateId: z.enum(["thanks", "sorry", "short"]),
  replyId: z.string().uuid().optional(),
  replaceEdited: z.boolean().optional(),
});

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

  const template = templateById(body.templateId);
  if (!template) return NextResponse.json({ error: "That template is not available." }, { status: 400 });

  const membership = await ensurePersonalWorkspace(user);
  const admin = createAdminClient();
  const review = await admin
    .from("grm_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();
  if (review.error || !review.data) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  try {
    await assertSafePublicReply({
      workspaceId: membership.workspace_id,
      userId: user.id,
      reviewId,
      content: template.text,
      stage: "template",
    });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 400;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }

  if (body.replyId) {
    const existing = await admin
      .from("grm_review_replies")
      .select("id, status, source, content, grm_review_ai_drafts(content)")
      .eq("id", body.replyId)
      .eq("review_id", reviewId)
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();
    if (!existing.data) return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    if (existing.data.status === "published" || existing.data.status === "pending_publish") {
      return NextResponse.json({ error: "A published reply cannot be replaced with a template." }, { status: 400 });
    }
    const linked = existing.data.grm_review_ai_drafts;
    const original = Array.isArray(linked) ? linked[0]?.content : linked?.content;
    const edited =
      existing.data.source === "manual" || (original && original.trim() !== existing.data.content.trim());
    if (edited && !body.replaceEdited) {
      return NextResponse.json(
        { error: "This draft has manual edits. Apply the template only when you want to replace them." },
        { status: 409 }
      );
    }
    const { error } = await admin
      .from("grm_review_replies")
      .update({
        content: template.text,
        source: "manual",
        status: "draft",
        approved_at: null,
        approved_by: null,
      })
      .eq("id", body.replyId);
    if (error) return NextResponse.json({ error: "Could not apply the template." }, { status: 500 });
  } else {
    const { error } = await admin.from("grm_review_replies").insert({
      workspace_id: membership.workspace_id,
      review_id: reviewId,
      content: template.text,
      source: "manual",
      status: "draft",
      created_by: user.id,
    });
    if (error) {
      const status = error.code === "23505" ? 409 : 500;
      return NextResponse.json(
        { error: status === 409 ? "An active reply already exists for this review." : "Could not apply the template." },
        { status }
      );
    }
  }

  await admin.from("grm_reviews").update({ reply_status: "draft" }).eq("id", reviewId);
  await AuditService.log({
    workspaceId: membership.workspace_id,
    userId: user.id,
    action: "reply.edited",
    entityType: "grm_reviews",
    entityId: reviewId,
    metadata: { templateId: template.id },
  });
  return NextResponse.json({ ok: true, content: template.text });
}
