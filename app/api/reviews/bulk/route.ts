import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIReviewService } from "@/lib/services/ai-review";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";
import { AuditService } from "@/lib/services/audit";
import { AppError, toUserMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseBody, bulkReviewsBodySchema } from "@/lib/validation";
import { checkRateLimit, AI_GENERATE_LIMIT, PUBLISH_LIMIT, WORKSPACE_AI_LIMIT } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertReviewAction } from "@/lib/services/access";
import { assertSafePublicReply } from "@/lib/services/reply-checks";

export const maxDuration = 60;

type BulkAction = "generate" | "approve" | "publish" | "discard" | "assign";

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

  let body: { action: BulkAction; reviewIds: string[]; assigneeId?: string | null };
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
  const membership = await ensurePersonalWorkspace(user);
  if (body.action === "generate") {
    const workspaceLimit = checkRateLimit(`workspace:${membership.workspace_id}`, "ai.generate", WORKSPACE_AI_LIMIT);
    if (!workspaceLimit.allowed) {
      return NextResponse.json(
        { error: "This workspace has reached its AI draft limit. Please wait." },
        { status: 429 }
      );
    }
  }
  const workspaceId = membership.workspace_id;
  const userId = user.id;

  async function reviewAllowed(reviewId: string, action: "draft" | "approve" | "publish"): Promise<string | null> {
    try {
      await assertReviewAction({ userId, workspaceId, reviewId, action });
      return null;
    } catch (error) {
      if (error instanceof AppError) return error.message;
      throw error;
    }
  }

  const results: Array<{
    reviewId: string;
    ok: boolean;
    error?: string;
    replyId?: string;
    content?: string;
  }> = [];

  if (body.action === "assign") {
    const assigneeId = body.assigneeId ?? null;
    if (assigneeId) {
      const member = await admin
        .from("grm_workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", assigneeId)
        .maybeSingle();
      if (member.error || !member.data) {
        return NextResponse.json(
          { error: "That person is not in this workspace." },
          { status: 400 }
        );
      }
    }
    for (const reviewId of body.reviewIds) {
      const denied = await reviewAllowed(reviewId, "draft");
      if (denied) {
        results.push({ reviewId, ok: false, error: denied });
        continue;
      }
      const { data, error } = await admin
        .from("grm_reviews")
        .update({ assigned_to: assigneeId })
        .eq("id", reviewId)
        .eq("workspace_id", workspaceId)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        results.push({ reviewId, ok: false, error: "That review is not in this workspace." });
      } else {
        results.push({ reviewId, ok: true });
      }
    }
    const succeeded = results.filter((item) => item.ok).length;
    await AuditService.log({
      workspaceId,
      userId,
      action: "review.assigned",
      entityType: "grm_reviews",
      metadata: { succeeded, failed: results.length - succeeded, assigneeId } as Record<string, unknown>,
    });
    return NextResponse.json({
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  }

  for (const reviewId of body.reviewIds) {
    try {
      if (body.action === "generate") {
        const denied = await reviewAllowed(reviewId, "draft");
        if (denied) {
          results.push({ reviewId, ok: false, error: denied });
          continue;
        }
        const draft = await AIReviewService.generateDraft({
          reviewId,
          workspaceId,
          userId: user.id,
        });
        results.push({
          reviewId,
          ok: true,
          replyId: draft.replyId,
          content: draft.content,
        });
        continue;
      }

      const { data: reply } = await admin
        .from("grm_review_replies")
        .select("id, status, content")
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
        const denied = await reviewAllowed(reviewId, "approve");
        if (denied) {
          results.push({ reviewId, ok: false, error: denied });
          continue;
        }
        await assertSafePublicReply({
          workspaceId,
          userId: user.id,
          reviewId,
          content: reply.content,
          stage: "approve",
        });
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
        const denied = await reviewAllowed(reviewId, "publish");
        if (denied) {
          results.push({ reviewId, ok: false, error: denied });
          continue;
        }
        if (reply.status === "draft") {
          const approveDenied = await reviewAllowed(reviewId, "approve");
          if (approveDenied) {
            results.push({ reviewId, ok: false, error: approveDenied });
            continue;
          }
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
          const approveDenied = await reviewAllowed(reviewId, "approve");
          if (approveDenied) {
            results.push({ reviewId, ok: false, error: approveDenied });
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
        const denied = await reviewAllowed(reviewId, "draft");
        if (denied) {
          results.push({ reviewId, ok: false, error: denied });
          continue;
        }
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
