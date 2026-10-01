import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIReviewService } from "@/lib/services/ai-review";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";
import { AuditService } from "@/lib/services/audit";
import { AppError, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody, bulkReviewsBodySchema } from "@/lib/validation";
import { checkRateLimit, AI_GENERATE_LIMIT, PUBLISH_LIMIT } from "@/lib/rate-limit";

type BulkAction = "generate" | "approve" | "publish" | "discard";

/**
 * POST /api/reviews/bulk
 * Body: { action: generate|approve|publish|discard, reviewIds: string[] }
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { action: BulkAction; reviewIds: string[] };
  try {
    body = await parseBody(request, bulkReviewsBodySchema);
  } catch (e) {
    return NextResponse.json({ error: toUserMessage(e) }, { status: 400 });
  }

  if (body.action === "generate") {
    const rl = checkRateLimit(user.id, "ai.generate", AI_GENERATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many AI generation requests. Please wait." },
        { status: 429 }
      );
    }
  }

  if (body.action === "publish") {
    const rl = checkRateLimit(user.id, "reply.publish", PUBLISH_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many publish requests. Please wait." },
        { status: 429 }
      );
    }
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const workspaceId = membership.workspace_id;
  const results: Array<{ reviewId: string; ok: boolean; error?: string }> = [];

  for (const reviewId of body.reviewIds) {
    try {
      if (body.action === "generate") {
        await AIReviewService.generateDraft({
          reviewId,
          workspaceId,
          userId: user.id,
        });
        results.push({ reviewId, ok: true });
        continue;
      }

      const { data: reply } = await admin
        .from("grm_review_replies")
        .select("id, status")
        .eq("review_id", reviewId)
        .eq("workspace_id", workspaceId)
        .in("status", ["draft", "approved", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!reply) {
        results.push({ reviewId, ok: false, error: "No draft/approved reply found" });
        continue;
      }

      if (body.action === "approve") {
        if (reply.status !== "draft" && reply.status !== "failed") {
          results.push({ reviewId, ok: false, error: "Reply is not a draft" });
          continue;
        }
        await admin
          .from("grm_review_replies")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            last_error: null,
          })
          .eq("id", reply.id);
        await admin
          .from("grm_reviews")
          .update({ reply_status: "approved" })
          .eq("id", reviewId);
        results.push({ reviewId, ok: true });
        continue;
      }

      if (body.action === "publish") {
        if (reply.status === "draft") {
          await admin
            .from("grm_review_replies")
            .update({
              status: "approved",
              approved_at: new Date().toISOString(),
              approved_by: user.id,
            })
            .eq("id", reply.id);
        } else if (reply.status !== "approved" && reply.status !== "failed") {
          results.push({ reviewId, ok: false, error: "Reply cannot be published" });
          continue;
        }

        if (reply.status === "failed") {
          await admin
            .from("grm_review_replies")
            .update({
              status: "approved",
              approved_at: new Date().toISOString(),
              approved_by: user.id,
              last_error: null,
            })
            .eq("id", reply.id);
        }

        await ReplyPublishingService.publishReply(
          reply.id,
          reviewId,
          workspaceId,
          user.id
        );
        results.push({ reviewId, ok: true });
        continue;
      }

      if (body.action === "discard") {
        if (reply.status === "published" || reply.status === "pending_publish") {
          results.push({ reviewId, ok: false, error: "Cannot discard a published reply" });
          continue;
        }
        await admin.from("grm_review_replies").delete().eq("id", reply.id);
        await admin
          .from("grm_reviews")
          .update({ reply_status: "none" })
          .eq("id", reviewId);
        results.push({ reviewId, ok: true });
      }
    } catch (error) {
      const message =
        error instanceof AppError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed";
      results.push({ reviewId, ok: false, error: message });
      logger.warn("reviews.bulk.item_failed", {
        action: body.action,
        reviewId,
        message,
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  await AuditService.log({
    workspaceId,
    userId: user.id,
    action: `reviews.bulk_${body.action}`,
    entityType: "grm_reviews",
    metadata: { succeeded, failed, action: body.action } as Record<string, unknown>,
  });

  return NextResponse.json({ succeeded, failed, results });
}
