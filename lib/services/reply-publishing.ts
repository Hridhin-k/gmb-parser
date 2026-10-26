import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleReviewService } from "./google-reviews";
import { GoogleOAuthService } from "./google-oauth";
import { AuditService } from "./audit";
import { AppError, GoogleApiError, ValidationError } from "@/lib/errors";
import { checkReplyGuardrails, negativeReviewNeedsApproval } from "@/lib/reply-guardrails";
import { comparePublishedReply } from "@/lib/reply-adjustments";
import { forgetReviewList } from "@/lib/services/dashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishResult {
  replyId: string;
  reviewId: string;
  publishedAt: string;
}

export interface PublishError {
  code: string;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Error classification for Google reply publishing
// ---------------------------------------------------------------------------

function classifyPublishError(error: unknown): PublishError {
  // Check AppError subclasses by their code property (works across module instances)
  if (error instanceof Error && "code" in error && "statusCode" in error) {
    const appErr = error as AppError;
    switch (appErr.code) {
      case "OAUTH_REVOKED":
      case "OAUTH_INVALID_GRANT":
        return {
          code: appErr.code,
          message: "Your Google connection has been revoked. Please reconnect your account in Settings.",
          retryable: false,
        };
      case "OAUTH_REFRESH_FAILED":
        return {
          code: appErr.code,
          message: "Failed to refresh your Google credentials. Please try again.",
          retryable: true,
        };
      case "NOT_FOUND":
        return {
          code: appErr.code,
          message: "Reply or review not found.",
          retryable: false,
        };
      case "GOOGLE_API_ERROR": {
        // GoogleApiError carries googleErrorCode
        const googleErr = error as GoogleApiError;
        const status = googleErr.googleErrorCode ?? 0;
        if (status === 401) {
          return {
            code: "GOOGLE_AUTH",
            message: "Google rejected the request due to an authentication failure. Please reconnect your account.",
            retryable: false,
          };
        }
        if (status === 403) {
          return {
            code: "GOOGLE_FORBIDDEN",
            message: "You do not have permission to reply to this review on Google.",
            retryable: false,
          };
        }
        if (status === 404) {
          return {
            code: "GOOGLE_NOT_FOUND",
            message: "The review could not be found on Google. It may have been deleted.",
            retryable: false,
          };
        }
        if (status === 429) {
          return {
            code: "GOOGLE_QUOTA",
            message: "Google API rate limit exceeded. Please wait a moment and try again.",
            retryable: true,
          };
        }
        if (status >= 500 || status === 0) {
          return {
            code: "GOOGLE_UNAVAILABLE",
            message: "Google's API is temporarily unavailable. Please try again shortly.",
            retryable: true,
          };
        }
        return {
          code: "GOOGLE_API_ERROR",
          message: "Google rejected the reply. Please review the content and try again.",
          retryable: false,
        };
      }
      default:
        return {
          code: appErr.code,
          message: appErr.message,
          retryable: appErr.statusCode >= 500,
        };
    }
  }

  return {
    code: "UNKNOWN",
    message: "An unexpected error occurred while publishing. Please try again.",
    retryable: true,
  };
}

function publishOutcomeUncertain(error: unknown): boolean {
  if (!(error instanceof GoogleApiError)) return false;
  const status = error.googleErrorCode;
  return status === undefined || status >= 500;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReplyPublishingService {
  /**
   * Publish an approved reply to Google Business Profile.
   *
   * Uses a `pending_publish` state transition as a concurrency lock —
   * only one concurrent publish operation can proceed per reply.
   * On success: state → `published`.
   * On failure: state → `failed` (retryable) or stays `failed`.
   */
  static async publishReply(
    replyId: string,
    reviewId: string,
    workspaceId: string,
    userId: string,
    options?: { automated?: boolean }
  ): Promise<PublishResult> {
    forgetReviewList(workspaceId);
    const supabase = createAdminClient();

    // ── 1. Load reply with full relationship chain ────────────────────────
    const { data: reply, error: replyError } = await supabase
      .from("grm_review_replies")
      .select(`
        id, content, status, failure_count, review_id, workspace_id, approved_by, published_at,
        grm_reviews!inner(
          id,
          star_rating,
          comment,
          review_create_time,
          google_review_name,
          location_id,
          workspace_id,
          grm_google_locations!inner(
            id,
            google_location_name,
            google_account_id,
            client_id,
            workspace_id,
            grm_google_accounts!inner(
              id,
              connection_id,
              grm_google_connections!inner(status)
            )
          )
        )
      `)
      .eq("id", replyId)
      .eq("review_id", reviewId)
      .eq("workspace_id", workspaceId)
      .single();

    if (replyError || !reply) {
      throw new AppError("Reply not found", "NOT_FOUND", 404);
    }

    // ── 2. Validate state — must be `approved` to publish ─────────────────
    if (reply.status === "published") {
      return { replyId, reviewId, publishedAt: reply.published_at ?? new Date().toISOString() };
    }

    if (reply.status === "pending_publish") {
      // Concurrency guard: another request is already in-flight
      throw new AppError(
        "This reply is already being published. Please wait.",
        "PUBLISH_IN_PROGRESS",
        409
      );
    }

    if (reply.status !== "approved") {
      throw new AppError(
        "Reply must be approved before publishing",
        "INVALID_STATE",
        400
      );
    }

    const violations = checkReplyGuardrails(reply.content);
    if (violations.length) {
      await AuditService.log({
        workspaceId,
        userId,
        action: "reply.guardrail_blocked",
        entityType: "grm_reviews",
        entityId: reviewId,
        metadata: { codes: violations.map((item) => item.code), stage: "publish" },
      });
      throw new ValidationError(violations[0].message);
    }

    const loadedReview = Array.isArray(reply.grm_reviews) ? reply.grm_reviews[0] : reply.grm_reviews;
    if (negativeReviewNeedsApproval(loadedReview?.star_rating ?? 5) && !reply.approved_by) {
      throw new ValidationError("A 1–3 star review has to be approved by an owner or admin before it is published.");
    }

    // ── 3. Navigate the join tree to get the connection ID ────────────────
    const reviewData = Array.isArray(reply.grm_reviews)
      ? reply.grm_reviews[0]
      : reply.grm_reviews;

    if (!reviewData) {
      throw new AppError("Review data not found", "NOT_FOUND", 404);
    }

    const locationData = Array.isArray(reviewData.grm_google_locations)
      ? reviewData.grm_google_locations[0]
      : reviewData.grm_google_locations;

    if (!locationData) {
      throw new AppError("Location data not found", "NOT_FOUND", 404);
    }

    const accountData = Array.isArray(locationData.grm_google_accounts)
      ? locationData.grm_google_accounts[0]
      : locationData.grm_google_accounts;

    if (!accountData?.connection_id) {
      throw new AppError(
        "No Google connection associated with this location",
        "CONFIG_ERROR",
        400
      );
    }

    const connectionRow = Array.isArray(accountData.grm_google_connections)
      ? accountData.grm_google_connections[0]
      : accountData.grm_google_connections;
    if (connectionRow?.status && connectionRow.status !== "active") {
      throw new AppError(
        "The Google connection is not active. Reconnect it in Settings before publishing.",
        "OAUTH_REVOKED",
        403
      );
    }

    if (options?.automated) {
      const { assertAutomationAllowsPublish } = await import("@/lib/services/reply-settings");
      await assertAutomationAllowsPublish({
        workspaceId,
        locationId: locationData.id,
        stars: reviewData.star_rating,
        comment: reviewData.comment,
        createdAt: reviewData.review_create_time,
        replyText: reply.content,
      });
    }

    const connectionId = accountData.connection_id;
    const googleReviewName = reviewData.google_review_name;
    if (!googleReviewName) {
      throw new AppError("This review has no Google id, so it cannot be published.", "CONFIG_ERROR", 400);
    }

    // ── 4. Transition to `pending_publish` — acts as a distributed lock ───
    //    Use conditional update: only succeed if status is still `approved`.
    //    This prevents two simultaneous requests from both proceeding.
    const { data: locked, error: lockError } = await supabase
      .from("grm_review_replies")
      .update({ status: "pending_publish" })
      .eq("id", replyId)
      .eq("status", "approved") // conditional — only transitions from approved
      .select("id")
      .single();

    if (lockError || !locked) {
      // Another request won the race — return 409
      throw new AppError(
        "This reply is already being published. Please wait.",
        "PUBLISH_IN_PROGRESS",
        409
      );
    }

    // Update review status to reflect in-progress
    await supabase
      .from("grm_reviews")
      .update({ reply_status: "pending_publish" })
      .eq("id", reviewId);

    // ── 5. Audit: publish attempted ───────────────────────────────────────
    await AuditService.log({
      workspaceId,
      userId,
      action: "reply.publish_attempted",
      entityType: "grm_review_replies",
      entityId: replyId,
      metadata: {
        reviewId,
        locationId: locationData.id,
        clientId: locationData.client_id,
      },
    });

    // ── 6. Get valid access token (auto-refresh if expired) ───────────────
    let accessToken: string;
    try {
      accessToken = await GoogleOAuthService.getValidAccessToken(connectionId);
    } catch (tokenError) {
      // Token acquisition failed — revert to `approved` so user can retry
      await supabase
        .from("grm_review_replies")
        .update({ status: "approved" })
        .eq("id", replyId);
      await supabase
        .from("grm_reviews")
        .update({ reply_status: "approved" })
        .eq("id", reviewId);
      throw tokenError;
    }

    // ── 7. Call Google's official Business Profile review reply API ────────
    let googleReply: { comment: string; updateTime: string | null };
    try {
      googleReply = await GoogleReviewService.replyToReview(accessToken, googleReviewName, reply.content);
    } catch (googleError) {
      if (publishOutcomeUncertain(googleError)) {
        const message = "Google did not confirm whether this reply was published. It has not been marked as published.";
        await supabase
          .from("grm_review_replies")
          .update({ status: "pending_publish", last_error: message })
          .eq("id", replyId);
        await supabase
          .from("grm_reviews")
          .update({ reply_status: "pending_publish" })
          .eq("id", reviewId);
        await AuditService.log({
          workspaceId,
          userId,
          action: "reply.publish_uncertain",
          entityType: "grm_reviews",
          entityId: reviewId,
          metadata: { replyId },
        });
        throw new AppError(message, "PUBLISH_UNCERTAIN", 409);
      }

      const classified = classifyPublishError(googleError);

      // Mark as failed — store safe error info, never tokens
      await supabase
        .from("grm_review_replies")
        .update({
          status: "failed",
          last_error: classified.message,
          failure_count: reply.failure_count + 1,
        })
        .eq("id", replyId);

      await supabase
        .from("grm_reviews")
        .update({ reply_status: "failed" })
        .eq("id", reviewId);

      await AuditService.log({
        workspaceId,
        userId,
        action: "reply.publish_failed",
        entityType: "grm_review_replies",
        entityId: replyId,
        metadata: {
          reviewId,
          errorCode: classified.code,
          retryable: classified.retryable,
          // Never log access tokens, review content, or PII beyond what's needed
        },
      });

      const { notifyProfileEvent } = await import("@/lib/services/notifications");
      await notifyProfileEvent({
        workspaceId,
        locationId: locationData.id,
        kind: "publish_failed",
        detail: "A reply failed to publish.",
        href: `/reviews?location=${locationData.id}&filter=failed`,
        dedupeKey: `publish_failed:${replyId}:${reply.failure_count + 1}`,
      });

      throw new AppError(classified.message, classified.code, 502);
    }

    const outcome = comparePublishedReply(reply.content, googleReply.comment);
    if (outcome !== "matched") {
      const message = "Google returned a different reply from the one that was approved. It was not marked as published.";
      await supabase
        .from("grm_review_replies")
        .update({
          status: "pending_publish",
          last_error: message,
          publish_result: googleReply,
        })
        .eq("id", replyId);
      await AuditService.log({
        workspaceId,
        userId,
        action: "reply.publish_uncertain",
        entityType: "grm_reviews",
        entityId: reviewId,
        metadata: { replyId, outcome },
      });
      throw new AppError(message, "PUBLISH_UNCERTAIN", 409);
    }

    // ── 8. Google confirmed the same reply — mark as published ────────────
    const publishedAt = googleReply.updateTime ?? new Date().toISOString();

    await supabase
      .from("grm_review_replies")
      .update({
        status: "published",
        published_at: publishedAt,
        published_by: userId,
        last_error: null,
        publish_result: googleReply,
      })
      .eq("id", replyId);

    const { recordUsageEvent } = await import("@/lib/services/usage-events");
    await recordUsageEvent({
      workspaceId,
      clientId: locationData.client_id,
      kind: "reply_published",
      sourceId: replyId,
      occurredAt: publishedAt,
    });

    await supabase
      .from("grm_reviews")
      .update({
        reply_status: "published",
        reopened_at: null,
        google_reply_comment: googleReply.comment,
        google_reply_update_time: googleReply.updateTime,
      })
      .eq("id", reviewId);

    // ── 9. Audit: publish succeeded ────────────────────────────────────────
    await AuditService.log({
      workspaceId,
      userId,
      action: "reply.published",
      entityType: "grm_review_replies",
      entityId: replyId,
      metadata: {
        reviewId,
        locationId: locationData.id,
        clientId: locationData.client_id,
        publishedAt,
      },
    });

    return { replyId, reviewId, publishedAt };
  }

  /**
   * A publish that did not get a confirmed result stays pending.
   * Read the review from Google before anyone retries the write.
   */
  static async reconcilePendingPublish(
    replyId: string,
    reviewId: string,
    workspaceId: string,
    userId: string
  ): Promise<PublishResult> {
    const supabase = createAdminClient();
    const { data: reply, error } = await supabase
      .from("grm_review_replies")
      .select(`
        id, content, status,
        grm_reviews!inner(
          google_review_name,
          grm_google_locations!inner(
            grm_google_accounts!inner(
              connection_id,
              grm_google_connections!inner(status)
            )
          )
        )
      `)
      .eq("id", replyId)
      .eq("review_id", reviewId)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !reply) throw new AppError("Reply not found", "NOT_FOUND", 404);
    if (reply.status !== "pending_publish") {
      throw new AppError("This reply is not waiting on a Google result.", "INVALID_STATE", 400);
    }

    const reviewData = Array.isArray(reply.grm_reviews) ? reply.grm_reviews[0] : reply.grm_reviews;
    const locationData = Array.isArray(reviewData?.grm_google_locations)
      ? reviewData.grm_google_locations[0]
      : reviewData?.grm_google_locations;
    const accountData = Array.isArray(locationData?.grm_google_accounts)
      ? locationData.grm_google_accounts[0]
      : locationData?.grm_google_accounts;
    const connection = Array.isArray(accountData?.grm_google_connections)
      ? accountData.grm_google_connections[0]
      : accountData?.grm_google_connections;
    if (connection?.status && connection.status !== "active") {
      throw new AppError(
        "The Google connection is not active. Reconnect it in Settings before checking this reply.",
        "OAUTH_REVOKED",
        403
      );
    }
    const connectionId = accountData?.connection_id;
    const googleReviewName = reviewData?.google_review_name;
    if (!connectionId || !googleReviewName) {
      throw new AppError("This review is not linked to a Google location.", "CONFIG_ERROR", 400);
    }

    let remoteComment: string | null = null;
    let remoteTime: string | null = null;
    try {
      const accessToken = await GoogleOAuthService.getValidAccessToken(connectionId);
      const remote = await GoogleReviewService.getReview(accessToken, googleReviewName);
      remoteComment = remote.reviewReply?.comment ?? null;
      remoteTime = remote.reviewReply?.updateTime ?? null;
    } catch {
      throw new AppError(
        "Google could not be checked, so this reply is still not marked as published.",
        "PUBLISH_UNCERTAIN",
        409
      );
    }

    const compared = comparePublishedReply(reply.content, remoteComment);
    if (compared === "matched") {
      const publishedAt = remoteTime ?? new Date().toISOString();
      await supabase
        .from("grm_review_replies")
        .update({
          status: "published",
          published_at: publishedAt,
          published_by: userId,
          last_error: null,
          publish_result: { comment: remoteComment, updateTime: remoteTime },
        })
        .eq("id", replyId)
        .eq("status", "pending_publish");
      await supabase
        .from("grm_reviews")
        .update({
          reply_status: "published",
          reopened_at: null,
          google_reply_comment: remoteComment,
          google_reply_update_time: remoteTime,
        })
        .eq("id", reviewId);
      await AuditService.log({
        workspaceId,
        userId,
        action: "reply.reconciled",
        entityType: "grm_reviews",
        entityId: reviewId,
        metadata: { replyId, publishedAt },
      });
      return { replyId, reviewId, publishedAt };
    }

    if (compared === "absent") {
      await supabase
        .from("grm_review_replies")
        .update({ status: "approved", last_error: null })
        .eq("id", replyId)
        .eq("status", "pending_publish");
      await supabase.from("grm_reviews").update({ reply_status: "approved" }).eq("id", reviewId);
      throw new AppError(
        "Google does not have this reply. It was not published. You can try again.",
        "PUBLISH_NOT_SENT",
        409
      );
    }

    throw new AppError(
      "Google already has a different reply on this review. It was not replaced.",
      "PUBLISH_CONFLICT",
      409
    );
  }

  /**
   * Re-approve a failed reply for publishing.
   * Resets state from `failed` back to `approved` so the user can retry.
   */
  static async resetFailedReply(
    replyId: string,
    reviewId: string,
    workspaceId: string
  ): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("grm_review_replies")
      .update({ status: "approved", last_error: null })
      .eq("id", replyId)
      .eq("review_id", reviewId)
      .eq("workspace_id", workspaceId)
      .eq("status", "failed");

    if (error) {
      throw new AppError("Failed to reset reply status", "DB_ERROR", 500);
    }

    await supabase
      .from("grm_reviews")
      .update({ reply_status: "approved" })
      .eq("id", reviewId);
  }

  /**
   * Delete the Google-published reply (if required by product).
   * Calls the Google API and marks the reply as deleted locally.
   */
  static async deletePublishedReply(
    replyId: string,
    reviewId: string,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const supabase = createAdminClient();

    const { data: reply, error } = await supabase
      .from("grm_review_replies")
      .select(`
        id, status,
        grm_reviews!inner(
          google_review_name,
          grm_google_locations!inner(
            grm_google_accounts!inner(connection_id)
          )
        )
      `)
      .eq("id", replyId)
      .eq("workspace_id", workspaceId)
      .single();

    if (error || !reply) {
      throw new AppError("Reply not found", "NOT_FOUND", 404);
    }

    if (reply.status !== "published") {
      throw new AppError("Only published replies can be deleted from Google", "INVALID_STATE", 400);
    }

    const reviewData = Array.isArray(reply.grm_reviews)
      ? reply.grm_reviews[0]
      : reply.grm_reviews;
    const locationData = Array.isArray(reviewData?.grm_google_locations)
      ? reviewData.grm_google_locations[0]
      : reviewData?.grm_google_locations;
    const accountData = Array.isArray(locationData?.grm_google_accounts)
      ? locationData.grm_google_accounts[0]
      : locationData?.grm_google_accounts;

    const connectionId = (accountData as { connection_id?: string } | null)?.connection_id;
    if (!connectionId) {
      throw new AppError("No Google connection found", "CONFIG_ERROR", 400);
    }

    const googleReviewName = (reviewData as { google_review_name?: string } | null)?.google_review_name;
    if (!googleReviewName) {
      throw new AppError("Google review name missing", "CONFIG_ERROR", 400);
    }

    const accessToken = await GoogleOAuthService.getValidAccessToken(connectionId);
    await GoogleReviewService.deleteReply(accessToken, googleReviewName);

    // Mark reply as draft (retracted) in the DB
    await supabase
      .from("grm_review_replies")
      .update({ status: "draft", published_at: null, published_by: null })
      .eq("id", replyId);

    await supabase
      .from("grm_reviews")
      .update({ reply_status: "draft" })
      .eq("id", reviewId);

    await AuditService.log({
      workspaceId,
      userId,
      action: "reply.deleted",
      entityType: "grm_review_replies",
      entityId: replyId,
      metadata: { reviewId },
    });
  }
}
