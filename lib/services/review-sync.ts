import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleReviewService, classifyReviewError } from "./google-reviews";
import { GoogleOAuthService } from "./google-oauth";
import { AuditService } from "./audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { GoogleReview } from "@/lib/types/google";
import { detectComplaintTheme, detectReviewLanguage, shouldReopenReview } from "@/lib/review-inbox";
import { absenceIsConfirmed, planReviewVersion, reviewsConfirmedMissing } from "@/lib/review-version";
import { isFreshReview } from "@/lib/services/notifications";
import { forgetWorkspaceDashboardCaches } from "@/lib/services/dashboard-cache";
import type { Database } from "@/lib/types/supabase";

type ReviewInsert = Database["public"]["Tables"]["grm_reviews"]["Insert"];

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

// ---------------------------------------------------------------------------
// Retry configuration
// Rate-limit and transient errors get a short back-off before retry.
// Auth/permission failures are NOT retried — they require user intervention.
// ---------------------------------------------------------------------------
const MAX_TRANSIENT_RETRIES = 2;
/** A second sync for the same location waits until this lease expires. */
export const SYNC_LEASE_MS = 10 * 60 * 1000;
const ABSENCE_PAGE = 1000;

/** True when this caller may take the location. A fresh `syncing` row belongs to the other run. */
export function syncLeaseOpen(
  status: string | null | undefined,
  startedAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (status !== "syncing") return true;
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(started)) return true;
  return now - started >= SYNC_LEASE_MS;
}

/**
 * Exponential delay with caller-supplied jitter. Quota waits longer than a dropped connection.
 * `attempt` is 1 for the first retry.
 */
export function retryDelayMs(attempt: number, errorClass: string, jitterMs: number): number {
  const base = errorClass === "quota" || errorClass === "rate_limit" ? 1_000 : 300;
  const exp = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp + Math.max(0, jitterMs), 20_000);
}
/** Stop incremental sync after this many newest-first pages with no changes. */
const UNCHANGED_PAGES_TO_STOP = 2;
/** Safety cap if incremental never hits two unchanged pages (e.g. hash mismatch). */
const MAX_INCREMENTAL_PAGES = 40;
const LOCATION_CONCURRENCY = 3;

export type ReviewSyncMode = "incremental" | "full";

export interface SyncLocationOptions {
  mode?: ReviewSyncMode;
}

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

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await fn(current);
    }
  }
  const n = Math.min(Math.max(1, limit), Math.max(items.length, 1));
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface LocationSyncResult {
  locationId: string;
  reviewsSynced: number;
  reviewsUpdated: number;
  pagesProcessed: number;
  truncated: boolean;
  mode: ReviewSyncMode;
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

function priorVersion(row: {
  id?: string;
  comment?: string | null;
  stars?: number;
  createTime?: string;
  replyComment?: string | null;
  contentFingerprint?: string | null;
  responseFingerprint?: string | null;
  missingOnGoogleAt?: string | null;
} | undefined) {
  if (!row?.id || row.stars == null || !row.createTime) return null;
  return {
    id: row.id,
    comment: row.comment ?? null,
    starRating: row.stars,
    createTime: row.createTime,
    replyComment: row.replyComment ?? null,
    contentFingerprint: row.contentFingerprint ?? null,
    responseFingerprint: row.responseFingerprint ?? null,
    missingOnGoogleAt: row.missingOnGoogleAt ?? null,
  };
}

/**
 * Marks stored reviews that a confirmed full sync did not return as missing
 * on Google. Their rows stay; listings exclude them while missing.
 */
async function markConfirmedAbsences(
  supabase: ReturnType<typeof createAdminClient>,
  input: { workspaceId: string; locationId: string; seenNames: readonly string[]; now: string }
): Promise<number> {
  const seen = new Set(input.seenNames);
  let marked = 0;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("grm_reviews")
      .select("id, google_review_name, missing_on_google_at")
      .eq("workspace_id", input.workspaceId)
      .eq("location_id", input.locationId)
      .order("id", { ascending: true })
      .range(from, from + ABSENCE_PAGE - 1);
    if (error || !Array.isArray(data)) return marked;
    const missing = reviewsConfirmedMissing(
      data.map((row) => ({
        id: row.id,
        googleReviewName: row.google_review_name,
        missingOnGoogleAt: row.missing_on_google_at,
      })),
      seen
    );
    for (const row of missing) {
      const { error: updateError } = await supabase
        .from("grm_reviews")
        .update({ missing_on_google_at: input.now, downstream_stale_at: input.now })
        .eq("id", row.id)
        .eq("workspace_id", input.workspaceId)
        .is("missing_on_google_at", null);
      if (updateError) {
        logger.error("review_sync.absence_mark_failed", { reviewId: row.id, message: updateError.message });
      } else {
        marked += 1;
      }
    }
    if (data.length < ABSENCE_PAGE) break;
    from += ABSENCE_PAGE;
  }
  return marked;
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
   *   3. Paginate newest-first (full crawl, or stop after two unchanged pages)
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
    userId: string,
    options: SyncLocationOptions = {}
  ): Promise<LocationSyncResult> {
    const supabase = createAdminClient();
    const syncStarted = new Date().toISOString();

    // --- 1. Fetch location record ---
    const { data: location, error: locError } = await supabase
      .from("grm_google_locations")
      .select("id, google_location_name, workspace_id, last_synced_at, reviews_full_synced_at, sync_status, sync_started_at, sync_cursor")
      .eq("id", locationId)
      .eq("workspace_id", workspaceId)
      .single();

    if (locError || !location) {
      throw new AppError("Location not found", "NOT_FOUND", 404);
    }

    if (!syncLeaseOpen(location.sync_status, location.sync_started_at)) {
      throw new AppError(
        "A sync is already running for this location.",
        "SYNC_IN_PROGRESS",
        409
      );
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

    // A location that has never completed a full crawl must always crawl in
    // full, even when the caller asked for incremental (cron / Sync button).
    // `last_synced_at` cannot be used for this: location discovery stamps it
    // before any review exists. `reviews_full_synced_at` is only set below,
    // after a full crawl finishes every page without failing.
    const mode: ReviewSyncMode =
      options.mode === "full" || !location.reviews_full_synced_at
        ? "full"
        : "incremental";

    // --- 4. Paginate newest-first. Incremental stops once we hit known pages. ---
    let reviewsSynced = 0;
    let reviewsUpdated = 0;
    let freshReviews = 0;
    let pagesProcessed = 0;
    let unchangedPages = 0;
    let truncated = false;
    let errorClass: string | null = null;
    let errorMessage: string | null = null;
    let pageToken: string | undefined =
      mode === "full" && !location.reviews_full_synced_at
        ? location.sync_cursor ?? undefined
        : undefined;
    let abortSync = false;
    let googleTotalReviewCount: number | null = null;
    let googleAverageRating: number | null = null;
    const seenNames = new Set<string>();

    do {
      let retries = 0;
      let pageResult: Awaited<ReturnType<typeof GoogleReviewService.listReviews>> | null = null;

      while (retries <= MAX_TRANSIENT_RETRIES) {
        try {
          pageResult = await GoogleReviewService.listReviews(
            accessToken,
            location.google_location_name,
            pageToken
          );
          break;
        } catch (err) {
          const cls = classifyReviewError(err);

          if (NON_RETRYABLE_CLASSES.has(cls)) {
            errorClass = cls;
            errorMessage = err instanceof Error ? err.message : String(err);
            abortSync = true;
            break;
          }

          retries++;
          if (retries > MAX_TRANSIENT_RETRIES) {
            errorClass = cls;
            errorMessage = err instanceof Error ? err.message : String(err);
            abortSync = true;
            break;
          }

          await sleep(retryDelayMs(retries, cls, Math.floor(Math.random() * 250)));
        }
      }

      if (abortSync || !pageResult) break;

      pagesProcessed++;
      if (typeof pageResult.totalReviewCount === "number") {
        googleTotalReviewCount = pageResult.totalReviewCount;
      }
      if (typeof pageResult.averageRating === "number") {
        googleAverageRating = pageResult.averageRating;
      }
      const pageReviews = pageResult.reviews ?? [];
      for (const review of pageReviews) seenNames.add(review.name);
      const pageUpdated = await this.upsertReviewPage(
        supabase,
        pageReviews,
        locationId,
        workspaceId
      );
      // A failed page write is a sync failure — never an "unchanged page".
      // Treating it as unchanged used to stop incremental sync early and
      // silently discard the whole page.
      if (pageUpdated.failed) {
        errorClass = "db_error";
        errorMessage = pageUpdated.errorMessage ?? "Failed to store reviews";
        abortSync = true;
        break;
      }
      reviewsSynced += pageReviews.length;
      reviewsUpdated += pageUpdated.written;
      freshReviews += pageUpdated.fresh;

      if (pageUpdated.written === 0 && pageReviews.length > 0) unchangedPages += 1;
      else unchangedPages = 0;

      pageToken = pageResult.nextPageToken;

      if (mode === "incremental" && unchangedPages >= UNCHANGED_PAGES_TO_STOP) {
        truncated = Boolean(pageToken);
        break;
      }
      if (mode === "incremental" && pagesProcessed >= MAX_INCREMENTAL_PAGES) {
        truncated = Boolean(pageToken);
        break;
      }
    } while (pageToken);

    // --- 5. Mark location sync complete ---
    const now = new Date().toISOString();

    if (absenceIsConfirmed({ mode, providerFailed: abortSync, truncated })) {
      try {
        await markConfirmedAbsences(supabase, {
          workspaceId,
          locationId,
          seenNames: [...seenNames],
          now,
        });
      } catch (error) {
        logger.error("review_sync.absence_check_failed", {
          locationId,
          message: error instanceof Error ? error.message : "Unknown",
        });
      }
    }
    const finalStatus =
      abortSync && reviewsSynced === 0
        ? "failed"
        : abortSync || truncated
        ? "partial"
        : "success";

    const completedFullCrawl =
      mode === "full" && !abortSync && !truncated;

    await supabase
      .from("grm_google_locations")
      .update({
        sync_status: finalStatus,
        sync_completed_at: now,
        last_synced_at: now,
        sync_error: errorMessage,
        ...(googleTotalReviewCount !== null
          ? { total_review_count: googleTotalReviewCount }
          : {}),
        ...(googleAverageRating !== null
          ? { average_rating: googleAverageRating }
          : {}),
        ...(completedFullCrawl ? { reviews_full_synced_at: now, sync_cursor: null } : {}),
        ...(mode === "full" && !completedFullCrawl ? { sync_cursor: pageToken ?? null } : {}),
      })
      .eq("id", locationId);

    // --- 6. Single audit record for the whole sync ---
    if (freshReviews > 0 && finalStatus !== "failed") {
      const { notifyProfileEvent } = await import("@/lib/services/notifications");
      const day = now.slice(0, 10);
      await notifyProfileEvent({
        workspaceId,
        locationId,
        kind: "new_reviews",
        detail: freshReviews === 1 ? "A new review arrived." : "New reviews arrived.",
        href: `/reviews?location=${locationId}`,
        dedupeKey: `new_reviews:${locationId}:${day}`,
      });
    }

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
        truncated,
        mode,
        status: finalStatus,
        googleTotalReviewCount,
        errorClass,
        errorMessage,
      } as Record<string, unknown>,
    });

    if (reviewsSynced > 0 || reviewsUpdated > 0) {
      forgetWorkspaceDashboardCaches(workspaceId);
    }

    return {
      locationId,
      reviewsSynced,
      reviewsUpdated,
      pagesProcessed,
      truncated,
      mode,
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
    userId: string,
    options: SyncLocationOptions = {}
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

    const jobs = eligible.map((loc) => {
      const accountData = Array.isArray(loc.grm_google_accounts)
        ? loc.grm_google_accounts[0]
        : loc.grm_google_accounts;
      const connectionId = (accountData as { connection_id: string } | null)
        ?.connection_id;
      return { loc, connectionId };
    }).filter((j): j is typeof j & { connectionId: string } => Boolean(j.connectionId));

    await mapPool(jobs, LOCATION_CONCURRENCY, async ({ loc, connectionId }) => {
      try {
        const result = await this.syncLocation(
          loc.id,
          connectionId,
          workspaceId,
          userId,
          options
        );
        results.push(result);
        if (result.errorClass === null || result.reviewsSynced > 0) {
          locationsSucceeded++;
        } else {
          locationsFailed++;
        }
        totalReviewsSynced += result.reviewsUpdated;
      } catch {
        locationsFailed++;
        results.push({
          locationId: loc.id,
          reviewsSynced: 0,
          reviewsUpdated: 0,
          pagesProcessed: 0,
          truncated: false,
          mode: options.mode ?? "incremental",
          errorClass: "unknown",
          errorMessage: "Unexpected error during sync",
        });
      }
    });

    // Only after the sync work finishes: bust this tenant's short-lived
    // dashboard caches when at least one location wrote review rows.
    // Failed-only runs leave TTLs in place so we do not treat a failed sync
    // as a successful data update.
    const wroteReviews = results.some(
      (result) => result.reviewsSynced > 0 || result.reviewsUpdated > 0
    );
    if (wroteReviews) forgetWorkspaceDashboardCaches(workspaceId);

    return {
      locationsAttempted: eligible.length,
      locationsSucceeded,
      locationsFailed,
      totalReviewsSynced,
      results,
    };
  }

  /**
   * One DB read per page, writes only for new/changed reviews.
   * Unchanged hashes are skipped entirely (no last_synced_at stampede).
   */
  private static async upsertReviewPage(
    supabase: ReturnType<typeof createAdminClient>,
    reviews: GoogleReview[],
    locationId: string,
    workspaceId: string
  ): Promise<
    | { written: number; fresh: number; failed: false }
    | { written: 0; fresh: 0; failed: true; errorMessage: string }
  > {
    if (reviews.length === 0) return { written: 0, fresh: 0, failed: false };

    const { data: existingRows, error: existingError } = await supabase
      .from("grm_reviews")
      .select(
        "id, google_review_name, sync_hash, reply_status, comment, star_rating, review_create_time, google_reply_comment, content_fingerprint, response_fingerprint, missing_on_google_at, reopened_at, downstream_stale_at"
      )
      .eq("workspace_id", workspaceId)
      .in(
        "google_review_name",
        reviews.map((r) => r.name)
      );

    if (existingError) {
      logger.error("review_sync.existing_lookup_failed", {
        count: reviews.length,
        message: existingError.message,
      });
      return {
        written: 0,
        fresh: 0,
        failed: true,
        errorMessage: existingError.message,
      };
    }

    const existing = new Map(
      (existingRows ?? []).map((row) => [
        row.google_review_name,
        {
          id: row.id,
          hash: row.sync_hash,
          replyStatus: row.reply_status,
          comment: row.comment,
          stars: row.star_rating,
          createTime: row.review_create_time,
          replyComment: row.google_reply_comment,
          contentFingerprint: row.content_fingerprint,
          responseFingerprint: row.response_fingerprint,
          missingOnGoogleAt: row.missing_on_google_at,
          reopenedAt: row.reopened_at,
          downstreamStaleAt: row.downstream_stale_at,
        },
      ])
    );

    const now = new Date().toISOString();
    const payloads: ReviewInsert[] = [];
    let fresh = 0;

    for (const review of reviews) {
      const hash = reviewHash(review);
      const prior = existing.get(review.name);
      if (prior?.hash === hash) continue;

      const stars = STAR_RATING_MAP[review.starRating];
      if (!stars) continue;
      const comment = review.comment ?? null;
      const googleReply = review.reviewReply?.comment ?? null;
      const stored = priorVersion(prior);
      const version = planReviewVersion(stored, {
        starRating: stars,
        comment,
        createTime: review.createTime,
        replyComment: googleReply,
      });
      // Every key must be present on every row. PostgREST bulk upserts fill
      // keys missing from some rows with NULL — leaving `reply_status` off
      // unreplied rows in a mixed page used to null out a NOT NULL column
      // and fail the entire page.
      const reopened =
        prior &&
        shouldReopenReview({
          replyStatus: prior.replyStatus,
          previousComment: prior.comment,
          previousStars: prior.stars,
          nextComment: comment,
          nextStars: stars,
        });
      const payload: ReviewInsert = {
        workspace_id: workspaceId,
        location_id: locationId,
        google_review_name: review.name,
        google_review_id: review.reviewId,
        reviewer_display_name: review.reviewer?.displayName ?? "",
        reviewer_profile_url: review.reviewer?.profilePhotoUrl ?? null,
        reviewer_is_anonymous:
          review.reviewer?.isAnonymous ?? !review.reviewer?.displayName,
        star_rating: stars,
        comment,
        review_language: detectReviewLanguage(comment),
        complaint_theme: detectComplaintTheme(comment, stars),
        review_create_time: review.createTime,
        review_update_time: review.updateTime ?? null,
        google_reply_comment: googleReply,
        google_reply_update_time: review.reviewReply?.updateTime ?? null,
        sync_hash: hash,
        content_fingerprint: version.contentFingerprint,
        response_fingerprint: version.responseFingerprint,
        missing_on_google_at: null,
        last_synced_at: now,
        downstream_stale_at:
          version.contentChanged || version.responseChanged
            ? now
            : (prior?.downstreamStaleAt ?? null),
        reopened_at: reopened ? now : (prior?.reopenedAt ?? null),
        // A reply that already exists on Google should not sit in
        // "Needs reply". Never overwrite GRM drafts / in-flight publishes.
        reply_status:
          googleReply && (!prior || prior.replyStatus === "none")
            ? "published"
            : (prior?.replyStatus ?? "none"),
      };

      if (!prior && isFreshReview(review.createTime)) fresh += 1;
      payloads.push(payload);
    }

    if (payloads.length === 0) return { written: 0, fresh: 0, failed: false };

    const { error } = await supabase.from("grm_reviews").upsert(payloads, {
      onConflict: "workspace_id,google_review_name",
      ignoreDuplicates: false,
    });

    if (error) {
      logger.error("review_sync.upsert_failed", {
        count: payloads.length,
        message: error.message,
      });
      return { written: 0, fresh: 0, failed: true, errorMessage: error.message };
    }

    return { written: payloads.length, fresh, failed: false };
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
