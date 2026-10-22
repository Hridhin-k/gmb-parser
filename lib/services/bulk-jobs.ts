import { createAdminClient } from "@/lib/supabase/admin";
import { AIReviewService } from "@/lib/services/ai-review";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";
import { AuditService } from "@/lib/services/audit";
import { assertReviewAction } from "@/lib/services/access";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { mapPool } from "@/lib/pool";
import type { Json } from "@/lib/types/supabase";

export type BulkJobAction = "generate" | "publish";
export type BulkJobStatus = "queued" | "running" | "done" | "failed";

export interface BulkItemResult {
  reviewId: string;
  ok: boolean;
  error?: string;
  replyId?: string;
  content?: string;
}

export interface BulkJob {
  id: string;
  workspace_id: string;
  user_id: string;
  action: BulkJobAction;
  review_ids: string[];
  results: BulkItemResult[];
  status: BulkJobStatus;
  succeeded: number;
  failed: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Items processed at once: enough to be fast, few enough to spare Google/Gemini quotas. */
const BULK_CONCURRENCY = 4;

/**
 * Enqueues a bulk generate/publish job. Returns null when the jobs table is
 * unavailable so the caller can fall back to processing synchronously.
 */
export async function createBulkJob(input: {
  workspaceId: string;
  userId: string;
  action: BulkJobAction;
  reviewIds: string[];
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_bulk_jobs")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      action: input.action,
      review_ids: input.reviewIds as unknown as Json,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !data) {
    logger.error("bulk_job.create_failed", { message: error?.message ?? "Unknown" });
    return null;
  }
  return data.id as string;
}

export async function getBulkJob(jobId: string): Promise<BulkJob | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("grm_bulk_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as unknown as BulkJob | null) ?? null;
}

async function reviewAllowed(
  userId: string,
  workspaceId: string,
  reviewId: string,
  action: "draft" | "approve" | "publish"
): Promise<string | null> {
  try {
    await assertReviewAction({ userId, workspaceId, reviewId, action });
    return null;
  } catch (error) {
    if (error instanceof AppError) return error.message;
    throw error;
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function latestReply(admin: Admin, workspaceId: string, reviewId: string) {
  const { data } = await admin
    .from("grm_review_replies")
    .select("id, status, content")
    .eq("review_id", reviewId)
    .eq("workspace_id", workspaceId)
    .in("status", ["draft", "approved", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function approveReply(admin: Admin, replyId: string, userId: string): Promise<void> {
  await admin
    .from("grm_review_replies")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: userId,
      last_error: null,
    })
    .eq("id", replyId);
}

/** One generate or publish for one review. Mirrors the single-item API behaviour. */
export async function processBulkItem(input: {
  action: BulkJobAction;
  reviewId: string;
  workspaceId: string;
  userId: string;
}): Promise<BulkItemResult> {
  const { action, reviewId, workspaceId, userId } = input;
  const admin = createAdminClient();
  try {
    if (action === "generate") {
      const denied = await reviewAllowed(userId, workspaceId, reviewId, "draft");
      if (denied) return { reviewId, ok: false, error: denied };
      const draft = await AIReviewService.generateDraft({ reviewId, workspaceId, userId });
      return { reviewId, ok: true, replyId: draft.replyId, content: draft.content };
    }

    // publish
    const denied = await reviewAllowed(userId, workspaceId, reviewId, "publish");
    if (denied) return { reviewId, ok: false, error: denied };
    const reply = await latestReply(admin, workspaceId, reviewId);
    if (!reply) return { reviewId, ok: false, error: "No draft/approved reply found" };
    if (reply.status === "draft" || reply.status === "failed") {
      const approveDenied = await reviewAllowed(userId, workspaceId, reviewId, "approve");
      if (approveDenied) return { reviewId, ok: false, error: approveDenied };
      await approveReply(admin, reply.id, userId);
    } else if (reply.status !== "approved") {
      return { reviewId, ok: false, error: "Reply cannot be published" };
    }
    await ReplyPublishingService.publishReply(reply.id, reviewId, workspaceId, userId);
    return { reviewId, ok: true };
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : error instanceof Error ? error.message : "Failed";
    logger.warn("bulk_job.item_failed", { action, reviewId, message });
    return { reviewId, ok: false, error: message };
  }
}

/**
 * Claims and runs a queued bulk job with bounded concurrency, writing
 * progress back after every item so pollers see live counts. Safe to call
 * twice: only the caller that wins the queued→running claim does the work.
 */
export async function processBulkJob(jobId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("grm_bulk_jobs")
    .update({ status: "running" })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return;
  const job = claimed as unknown as BulkJob;

  try {
    const reviewIds = Array.isArray(job.review_ids) ? job.review_ids : [];
    const results: BulkItemResult[] = [];
    await mapPool(reviewIds, BULK_CONCURRENCY, async (reviewId) => {
      const result = await processBulkItem({
        action: job.action,
        reviewId,
        workspaceId: job.workspace_id,
        userId: job.user_id,
      });
      results.push(result);
      await admin
        .from("grm_bulk_jobs")
        .update({
          results: results as unknown as Json,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        })
        .eq("id", jobId)
        .then(undefined, () => undefined);
      return result;
    });

    const succeeded = results.filter((r) => r.ok).length;
    await admin
      .from("grm_bulk_jobs")
      .update({
        status: "done",
        results: results as unknown as Json,
        succeeded,
        failed: results.length - succeeded,
      })
      .eq("id", jobId);

    await AuditService.log({
      workspaceId: job.workspace_id,
      userId: job.user_id,
      action: `reviews.bulk_${job.action}`,
      entityType: "grm_reviews",
      metadata: { succeeded, failed: results.length - succeeded, action: job.action, jobId } as Record<
        string,
        unknown
      >,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk job failed";
    await admin
      .from("grm_bulk_jobs")
      .update({ status: "failed", last_error: message.slice(0, 500) })
      .eq("id", jobId)
      .then(undefined, () => undefined);
    logger.error("bulk_job.failed", { jobId, message });
  }
}
