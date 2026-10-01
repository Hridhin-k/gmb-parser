import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleReviewService, classifyReviewError } from "./google-reviews";
import { GoogleOAuthService } from "./google-oauth";
import { AuditService } from "./audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { GoogleReview } from "@/lib/types/google";

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

// ---------------------------------------------------------------------------
// Retry configuration
// Rate-limit and transient errors get a short back-off before retry.
// Auth/permission failures are NOT retried — they require user intervention.
// ---------------------------------------------------------------------------
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

// Errors that should never be retried (permanent failures)
const NON_RETRYABLE_CLASSES = new Set([
  "authentication",
  "authorization",
  "not_found",
  "invalid_request",
]);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface LocationSyncResult {
  locationId: string;
  reviewsSynced: number;
  reviewsUpdated: number;
  pagesProcessed: number;
  errorClass: string | null;
  errorMessage: string | null;
}

export interface BulkSyncResult {
  locationsAttempted: number;
  locationsSucceeded: number;
  locationsFailed: number;
  totalReviewsSynced: number;
  results: LocationSyncResult[];
}

// ---------------------------------------------------------------------------
// Hash helper — detects whether a review changed since last sync
// ---------------------------------------------------------------------------
function reviewHash(review: GoogleReview): string {
  const stable = {
    starRating: review.starRating,
    comment: review.comment ?? null,
    updateTime: review.updateTime ?? null,
    replyComment: review.reviewReply?.comment ?? null,
    replyUpdateTime: review.reviewReply?.updateTime ?? null,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// ReviewSyncService
// ---------------------------------------------------------------------------
export class ReviewSyncService {
  /**
   * Synchronizes reviews for a single Google location.
   *
   * Flow:
   *   1. Mark location as `syncing`
   *   2. Get a valid access token for the connection
   *   3. Paginate through ALL reviews from the API
   *   4. Upsert each review; skip if hash unchanged (no actual update)
   *   5. Mark location as `success` | `partial` | `failed`
   *   6. Write a single audit record (not one per page)
   *
   * This method is idempotent — calling it multiple times produces the
   * same DB state as calling it once.
   */
  static async syncLocation(
    locationId: string,
    connectionId: string,
    workspaceId: string,
    userId: string
  ): Promise<LocationSyncResult> {
    const supabase = createAdminClient();
    const syncStarted = new Date().toISOString();

    // --- 1. Fetch location record ---
    const { data: location, error: locError } = await supabase
      .from("grm_google_locations")
      .select("id, google_location_name, workspace_id")
      .eq("id", locationId)
      .eq("workspace_id", workspaceId)
      .single();

    if (locError || !location) {
      throw new AppError("Location not found", "NOT_FOUND", 404);
    }

    // --- 2. Mark sync as started ---
    await supabase
      .from("grm_google_locations")
      .update({
        sync_status: "syncing",
        sync_started_at: syncStarted,
        sync_error: null,
      })
      .eq("id", locationId);

    await AuditService.log({
      workspaceId,
      userId,
      action: "review.sync_started",
      entityType: "grm_google_locations",
      entityId: locationId,
      metadata: { googleLocationName: location.google_location_name } as Record<string, unknown>,
    });

    // --- 3. Get a valid access token ---
    let accessToken: string;
    try {
      accessToken = await GoogleOAuthService.getValidAccessToken(connectionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown auth error";
      await this.markLocationFailed(supabase, locationId, workspaceId, userId, "failed", errorMessage);
      throw error;
    }

    // --- 4. Paginate through all reviews ---
    let reviewsSynced = 0;
    let reviewsUpdated = 0;
    let pagesProcessed = 0;
    let errorClass: string | null = null;
    let errorMessage: string | null = null;
    let pageToken: string | undefined;
    let abortSync = false;

    do {
      let retries = 0;
      let pageResult: Awaited<ReturnType<typeof GoogleReviewService.listReviews>> | null = null;

      // Retry loop for transient failures on a single page
      while (retries <= MAX_TRANSIENT_RETRIES) {
        try {
          pageResult = await GoogleReviewService.listReviews(
            accessToken,
            location.google_location_name,
            pageToken
          );
          break; // Success — exit retry loop
        } catch (err) {
          const cls = classifyReviewError(err);

          if (NON_RETRYABLE_CLASSES.has(cls)) {
            // Permanent error — abort the whole sync
            errorClass = cls;
            errorMessage = err instanceof Error ? err.message : String(err);
            abortSync = true;
            break;
          }

          retries++;
          if (retries > MAX_TRANSIENT_RETRIES) {
            // Exhausted retries — record partial failure but don't abort
            errorClass = cls;
            errorMessage = err instanceof Error ? err.message : String(err);
            abortSync = true;
            break;
          }

          await sleep(RETRY_DELAY_MS * retries);
        }
      }

      if (abortSync || !pageResult) break;

      pagesProcessed++;

      // Upsert each review on this page
      for (const review of pageResult.reviews ?? []) {
        try {
          const wasUpdated = await this.upsertReview(
            supabase,
            review,
            locationId,
            workspaceId
          );
          reviewsSynced++;
          if (wasUpdated) reviewsUpdated++;
        } catch (err) {
          // Log per-review failures but don't abort the page
          logger.error("review_sync.upsert_failed", {
            reviewId: review.reviewId,
            message: err instanceof Error ? err.message : "Unknown",
          });
        }
      }

      pageToken = pageResult.nextPageToken;
    } while (pageToken);

    // --- 5. Mark location sync complete ---
    const now = new Date().toISOString();
    const finalStatus =
      abortSync && reviewsSynced === 0
        ? "failed"
        : abortSync
        ? "partial"
        : "success";

    await supabase
      .from("grm_google_locations")
      .update({
        sync_status: finalStatus,
        sync_completed_at: now,
        last_synced_at: now,
        sync_error: errorMessage,
      })
      .eq("id", locationId);

    // --- 6. Single audit record for the whole sync ---
    await AuditService.log({
      workspaceId,
      userId,
      action: finalStatus === "failed" ? "review.sync_failed" : "review.synced",
      entityType: "grm_google_locations",
      entityId: locationId,
      metadata: {
        reviewsSynced,
        reviewsUpdated,
        pagesProcessed,
        status: finalStatus,
        errorClass,
        errorMessage,
      } as Record<string, unknown>,
    });

    return {
      locationId,
      reviewsSynced,
      reviewsUpdated,
      pagesProcessed,
      errorClass,
      errorMessage,
    };
  }

  /**
   * Synchronizes reviews for all connected locations in a workspace.
   * Locations that fail do not block others from syncing.
   * One audit record per location (not one per workspace call).
   */
  static async syncAllWorkspaceLocations(
    workspaceId: string,
    userId: string
  ): Promise<BulkSyncResult> {
    const supabase = createAdminClient();

    // Ensure clients exist for any unassigned profiles (DB only — no Google quota)
    const { autoProvisionClientsFromLocations } = await import(
      "@/lib/services/auto-provision-clients"
    );
    const {
      ensureUnassignedClient,
      listUnassignedClientIds,
      UNASSIGNED_CLIENT_MARKER,
    } = await import("@/lib/services/unassigned-client");

    await autoProvisionClientsFromLocations(workspaceId, userId);
    await ensureUnassignedClient(workspaceId);
    const unassignedIds = new Set(await listUnassignedClientIds(workspaceId));

    // Fetch locations that belong to real clients only
    const { data: locations, error } = await supabase
      .from("grm_google_locations")
      .select(
        `id, google_location_name, workspace_id, client_id,
         grm_google_accounts!inner(connection_id),
         grm_clients!inner(id, notes)`
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);

    if (error) {
      throw new AppError("Failed to fetch locations", "DB_ERROR", 500);
    }

    const eligible = (locations ?? []).filter((loc) => {
      if (loc.client_id && unassignedIds.has(loc.client_id)) return false;
      const client = Array.isArray(loc.grm_clients)
        ? loc.grm_clients[0]
        : loc.grm_clients;
      const notes = (client as { notes?: string | null } | null)?.notes;
      return notes !== UNASSIGNED_CLIENT_MARKER;
    });

    const results: LocationSyncResult[] = [];
    let locationsSucceeded = 0;
    let locationsFailed = 0;
    let totalReviewsSynced = 0;

    for (const loc of eligible) {
      const accountData = Array.isArray(loc.grm_google_accounts)
        ? loc.grm_google_accounts[0]
        : loc.grm_google_accounts;

      const connectionId = (accountData as { connection_id: string } | null)
        ?.connection_id;

      if (!connectionId) continue;

      try {
        const result = await this.syncLocation(
          loc.id,
          connectionId,
          workspaceId,
          userId
        );
        results.push(result);

        if (result.errorClass === null || result.reviewsSynced > 0) {
          locationsSucceeded++;
        } else {
          locationsFailed++;
        }
        totalReviewsSynced += result.reviewsSynced;
      } catch {
        locationsFailed++;
        results.push({
          locationId: loc.id,
          reviewsSynced: 0,
          reviewsUpdated: 0,
          pagesProcessed: 0,
          errorClass: "unknown",
          errorMessage: "Unexpected error during sync",
        });
      }
    }

    return {
      locationsAttempted: eligible.length,
      locationsSucceeded,
      locationsFailed,
      totalReviewsSynced,
      results,
    };
  }

  /**
   * Upserts a single review into the database.
   * Uses sync_hash to avoid writing unchanged rows.
   * Returns true if the row was changed (created or updated), false if unchanged.
   */
  private static async upsertReview(
    supabase: ReturnType<typeof createAdminClient>,
    review: GoogleReview,
    locationId: string,
    workspaceId: string
  ): Promise<boolean> {
    const hash = reviewHash(review);
    const starRating = STAR_RATING_MAP[review.starRating] ?? 0;

    // Check if we already have this review with the same hash
    const { data: existing } = await supabase
      .from("grm_reviews")
      .select("id, sync_hash")
      .eq("workspace_id", workspaceId)
      .eq("google_review_name", review.name)
      .single();

    if (existing?.sync_hash === hash) {
      // Content unchanged — update last_synced_at timestamp only
      await supabase
        .from("grm_reviews")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", existing.id);
      return false;
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from("grm_reviews").upsert(
      {
        workspace_id: workspaceId,
        location_id: locationId,
        google_review_name: review.name,
        google_review_id: review.reviewId,
        reviewer_display_name: review.reviewer?.displayName ?? "",
        reviewer_profile_url: review.reviewer?.profilePhotoUrl ?? null,
        reviewer_is_anonymous: review.reviewer?.isAnonymous ?? !review.reviewer?.displayName,
        star_rating: starRating,
        comment: review.comment ?? null,
        review_create_time: review.createTime,
        review_update_time: review.updateTime ?? null,
        google_reply_comment: review.reviewReply?.comment ?? null,
        google_reply_update_time: review.reviewReply?.updateTime ?? null,
        sync_hash: hash,
        last_synced_at: now,
      },
      {
        onConflict: "workspace_id,google_review_name",
        // Don't overwrite reply_status — that's managed by our publishing flow
        ignoreDuplicates: false,
      }
    );

    if (error) {
      throw new AppError(
        `Failed to upsert review ${review.reviewId}: ${error.message}`,
        "DB_ERROR",
        500
      );
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static async markLocationFailed(
    supabase: ReturnType<typeof createAdminClient>,
    locationId: string,
    workspaceId: string,
    userId: string,
    status: "failed" | "partial",
    errorMessage: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await supabase
      .from("grm_google_locations")
      .update({
        sync_status: status,
        sync_completed_at: now,
        sync_error: errorMessage,
      })
      .eq("id", locationId);

    await AuditService.log({
      workspaceId,
      userId,
      action: "review.sync_failed",
      entityType: "grm_google_locations",
      entityId: locationId,
      metadata: { errorMessage, status } as Record<string, unknown>,
    });
  }
}

// Re-export for use in tests / API routes
export { classifyReviewError };
export type { ReviewApiErrorClass } from "./google-reviews";
