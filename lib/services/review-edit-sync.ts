import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { AppError, GoogleApiError } from "@/lib/errors";
import { auditErrorDetails, sanitizeAuditMetadata } from "@/lib/audit-details";
import { AuditService } from "@/lib/services/audit";
import { GoogleReviewService } from "@/lib/services/google-reviews";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { reviewHash } from "@/lib/services/review-sync";
import { forgetReviewList } from "@/lib/services/dashboard";
import { planReviewVersion } from "@/lib/review-version";
import { shouldReopenReview, detectReviewLanguage, detectComplaintTheme } from "@/lib/review-inbox";
import { googleReviewReplyUrl, normalizeReviewMedia } from "@/lib/review-media";
import type { GoogleReview } from "@/lib/types/google";
import type { GrmReview } from "@/lib/types";

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const OVERLAP_MS = 48 * 60 * 60 * 1000;
type EditSyncState = {
  workspace_id: string; location_id: string; last_completed_at: string | null; run_started_at: string | null;
  cutoff: string | null; page_token: string | null; pages_processed: number; reviews_checked: number; reviews_updated: number; attempts: number;
};
type Target = { connection_id: string; google_location_name: string };

/** Timestamp boundary, never the review's original creation date. Unknown dates
 * cannot prove we've crossed the boundary, so continue paging in that case. */
export function editSyncReachedCutoff(reviews: GoogleReview[], cutoff: string | null): boolean {
  return Boolean(cutoff && reviews.length && reviews.every((r) => Number.isFinite(Date.parse(r.updateTime ?? "")))
    && reviews.some((r) => Date.parse(r.updateTime!) < Date.parse(cutoff)));
}

async function audit(db: PoolClient, workspaceId: string, entityType: string, entityId: string, action: string, metadata: Record<string, unknown>) {
  await db.query(`INSERT INTO grm_audit_logs(workspace_id,user_id,action,entity_type,entity_id,metadata)
    VALUES($1,NULL,$2,$3,$4,$5::jsonb)`, [workspaceId, action, entityType, entityId, JSON.stringify(sanitizeAuditMetadata(metadata))]);
}

/** Updates only rows already stored for this exact tenant/location. Row locks
 * preserve concurrent manual drafts/approvals; the location lock excludes the
 * regular fetch/analysis pipeline. Never insert, analyse, summarise or publish. */
async function refreshStoredReviews(db: PoolClient, state: EditSyncState, reviews: GoogleReview[]) {
  const { rows } = await db.query<GrmReview>(`SELECT * FROM grm_reviews WHERE workspace_id=$1 AND location_id=$2
    AND google_review_name=ANY($3::text[]) ORDER BY id FOR UPDATE`, [state.workspace_id, state.location_id, reviews.map((r) => r.name)]);
  const incoming = new Map(reviews.map((r) => [r.name, r]));
  let changed = 0;
  for (const stored of rows) {
    const review = incoming.get(stored.google_review_name)!;
    const hash = reviewHash(review);
    if (stored.sync_hash === hash && !stored.missing_on_google_at) continue;
    const stars = STARS[review.starRating];
    if (!stars || !Number.isFinite(Date.parse(review.createTime))) throw new AppError("Google returned an invalid review", "INVALID_GOOGLE_REVIEW", 502);
    const comment = review.comment ?? null, googleReply = review.reviewReply?.comment ?? null;
    const version = planReviewVersion({ id: stored.id, comment: stored.comment, starRating: stored.star_rating,
      createTime: stored.review_create_time, replyComment: stored.google_reply_comment, contentFingerprint: stored.content_fingerprint,
      responseFingerprint: stored.response_fingerprint, missingOnGoogleAt: stored.missing_on_google_at },
    { starRating: stars, comment, createTime: review.createTime, replyComment: googleReply });
    const reopened = shouldReopenReview({ replyStatus: stored.reply_status, previousComment: stored.comment,
      previousStars: stored.star_rating, nextComment: comment, nextStars: stars })
      || Boolean(stored.google_reply_comment) && (version.textChanged || version.ratingChanged);
    const now = new Date().toISOString();
    const media = normalizeReviewMedia(review.reviewMediaItems);
    const patch = {
      star_rating: stars, comment, review_create_time: review.createTime, review_update_time: review.updateTime ?? null,
      google_reply_comment: googleReply, google_reply_update_time: review.reviewReply?.updateTime ?? null,
      reviewer_display_name: review.reviewer?.displayName ?? "", reviewer_profile_url: review.reviewer?.profilePhotoUrl ?? null,
      reviewer_is_anonymous: review.reviewer?.isAnonymous ?? !review.reviewer?.displayName,
      review_media_items: JSON.stringify(media), review_url: googleReviewReplyUrl(review.reviewReplyUrl),
      review_language: detectReviewLanguage(comment), complaint_theme: detectComplaintTheme(comment, stars),
      sync_hash: hash,
      // Do not invalidate legacy analysis merely to initialise a fingerprint.
      content_fingerprint: version.contentChanged ? version.contentFingerprint : stored.content_fingerprint,
      response_fingerprint: version.responseChanged ? version.responseFingerprint : stored.response_fingerprint,
      missing_on_google_at: null, last_synced_at: now,
      downstream_stale_at: version.contentChanged || version.responseChanged ? now : stored.downstream_stale_at,
      reopened_at: reopened ? now : stored.reopened_at,
      reply_status: googleReply && stored.reply_status === "none" ? "published" : stored.reply_status,
    };
    const values = Object.values(patch);
    // Column names come exclusively from the constant patch above, never input.
    await db.query(`UPDATE grm_reviews SET ${Object.keys(patch).map((key, i) => `${key}=$${i + 4}`).join(",")}
      WHERE workspace_id=$1 AND location_id=$2 AND id=$3`, [state.workspace_id, state.location_id, stored.id, ...values]);
    await audit(db, state.workspace_id, "grm_reviews", stored.id, "review.edit_synced", {
      source: "edited_review_poll", contentChanged: version.contentChanged, responseChanged: version.responseChanged, reopened,
      before: { comment: stored.comment, stars: stored.star_rating, googleReply: stored.google_reply_comment, replyStatus: stored.reply_status, attachmentCount: normalizeReviewMedia(stored.review_media_items).length },
      after: { comment, stars, googleReply, replyStatus: patch.reply_status, attachmentCount: media.length },
    });
    changed++;
  }
  return { checked: rows.length, changed };
}

async function runPage(locationId: string, workspaceId: string): Promise<{ checked: number; changed: number } | { failed: true } | null> {
  const db = await getPool().connect();
  const key = `location-pipeline:${workspaceId}:${locationId}`;
  let locked = false, discard = false;
  let state: EditSyncState | undefined;
  try {
    locked = (await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked", [key])).rows[0].locked;
    if (!locked) return null;
    state = (await db.query<EditSyncState>("SELECT * FROM grm_review_edit_sync WHERE workspace_id=$1 AND location_id=$2 AND available_at<=now()", [workspaceId, locationId])).rows[0];
    if (!state) return null;
    const target = (await db.query<Target>(`SELECT a.connection_id,l.google_location_name FROM grm_google_locations l
      JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
      JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
      JOIN grm_workspaces w ON w.id=l.workspace_id
      WHERE l.workspace_id=$1 AND l.id=$2 AND l.is_active AND l.hold_reason IS NULL AND c.status='active' AND w.status='active'`, [workspaceId, locationId])).rows[0];
    if (!target) {
      await db.query("UPDATE grm_review_edit_sync SET available_at=now()+interval '1 hour' WHERE workspace_id=$1 AND location_id=$2", [workspaceId, locationId]);
      return null;
    }
    if (!state.run_started_at) {
      const start = new Date().toISOString();
      const cutoff = state.last_completed_at ? new Date(Date.parse(state.last_completed_at) - OVERLAP_MS).toISOString() : null;
      state = (await db.query<EditSyncState>(`UPDATE grm_review_edit_sync SET run_started_at=$3,cutoff=$4,page_token=NULL,
        pages_processed=0,reviews_checked=0,reviews_updated=0 WHERE workspace_id=$1 AND location_id=$2 RETURNING *`, [workspaceId, locationId, start, cutoff])).rows[0];
    }
    const token = await GoogleOAuthService.getValidAccessToken(target.connection_id);
    const page = await GoogleReviewService.listReviews(token, target.google_location_name, state.page_token ?? undefined);
    if (!Array.isArray(page.reviews) && page.totalReviewCount !== 0) throw new AppError("Google returned no review list", "INVALID_GOOGLE_PAGE", 502);
    if (page.nextPageToken && page.nextPageToken === state.page_token) throw new AppError("Google repeated the review page token", "INVALID_GOOGLE_PAGE", 502);
    const reviews = page.reviews ?? [];
    const selected = state.cutoff ? reviews.filter((r) => !Number.isFinite(Date.parse(r.updateTime ?? "")) || Date.parse(r.updateTime!) >= Date.parse(state!.cutoff!)) : reviews;
    const complete = !page.nextPageToken || editSyncReachedCutoff(reviews, state.cutoff);
    await db.query("BEGIN");
    const result = await refreshStoredReviews(db, state, selected);
    await db.query(`UPDATE grm_review_edit_sync SET page_token=$3,pages_processed=pages_processed+1,
      reviews_checked=reviews_checked+$4,reviews_updated=reviews_updated+$5,last_attempt_at=now(),last_error=NULL,attempts=0,
      available_at=CASE WHEN $6 THEN now()+interval '1 hour' ELSE now() END,
      last_completed_at=CASE WHEN $6 THEN run_started_at ELSE last_completed_at END,
      run_started_at=CASE WHEN $6 THEN NULL ELSE run_started_at END,cutoff=CASE WHEN $6 THEN NULL ELSE cutoff END
      WHERE workspace_id=$1 AND location_id=$2`, [workspaceId, locationId, complete ? null : page.nextPageToken, result.checked, result.changed, complete]);
    if (complete) await audit(db, workspaceId, "grm_google_locations", locationId, "review.edits_checked", {
      pagesProcessed: state.pages_processed + 1, reviewsChecked: state.reviews_checked + result.checked,
      reviewsUpdated: state.reviews_updated + result.changed, cutoff: state.cutoff, initialHistoryPass: !state.last_completed_at,
      watermark: state.run_started_at, aiCalls: 0,
    });
    await db.query("COMMIT");
    if (result.changed) forgetReviewList(workspaceId);
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => { discard = true; });
    const details = auditErrorDetails(error);
    if (state) {
      // Expired Google cursors restart the same overlap safely; never advance a
      // watermark on errors, and never interpret absence as a deleted review.
      const reset = Boolean(state.page_token && error instanceof GoogleApiError && error.googleErrorCode === 400);
      await db.query(`UPDATE grm_review_edit_sync SET attempts=attempts+1,last_error=$3,last_attempt_at=now(),
        available_at=now()+(LEAST(3600,300*power(2,LEAST(attempts,4))) * interval '1 second'),
        page_token=CASE WHEN $4 THEN NULL ELSE page_token END,run_started_at=CASE WHEN $4 THEN NULL ELSE run_started_at END
        WHERE workspace_id=$1 AND location_id=$2`, [workspaceId, locationId, String(details.errorMessage).slice(0, 500), reset]);
      await AuditService.log({ workspaceId, action: "review.edit_sync_failed", entityType: "grm_google_locations", entityId: locationId,
        metadata: { ...details, retryable: true, cursorReset: reset, pagesProcessed: state.pages_processed, watermark: state.last_completed_at } });
    }
    return { failed: true };
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]).catch(() => { discard = true; });
    db.release(discard);
  }
}

/** Called every five minutes. Each location starts at most once an hour;
 * unfinished initial/history pages resume on subsequent invocations. */
export async function syncEditedReviews(options: { maxPages?: number; deadlineAt?: number; workspaceId?: string } = {}) {
  const db = getPool();
  await db.query(`INSERT INTO grm_review_edit_sync(workspace_id,location_id)
    SELECT l.workspace_id,l.id FROM grm_google_locations l
    JOIN grm_google_accounts a ON a.workspace_id=l.workspace_id AND a.id=l.google_account_id
    JOIN grm_google_connections c ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
    JOIN grm_workspaces w ON w.id=l.workspace_id
    WHERE l.is_active AND l.hold_reason IS NULL AND c.status='active' AND w.status='active'
      AND ($1::uuid IS NULL OR l.workspace_id=$1)
      AND EXISTS(SELECT 1 FROM grm_reviews r WHERE r.workspace_id=l.workspace_id AND r.location_id=l.id)
    ON CONFLICT(location_id) DO NOTHING`, [options.workspaceId ?? null]);
  let pages = 0, checked = 0, updated = 0, failed = 0;
  const skipped: string[] = [];
  const deadline = options.deadlineAt ?? Date.now() + 45_000;
  for (let i = 0; i < (options.maxPages ?? 20) && Date.now() < deadline; i++) {
    const { rows: [candidate] } = await db.query<{ workspace_id: string; location_id: string }>(`SELECT workspace_id,location_id FROM grm_review_edit_sync
      WHERE available_at<=now() AND NOT(location_id=ANY($1::uuid[])) AND ($2::uuid IS NULL OR workspace_id=$2)
      ORDER BY last_attempt_at NULLS FIRST,location_id LIMIT 1`, [skipped, options.workspaceId ?? null]);
    if (!candidate) break;
    const result = await runPage(candidate.location_id, candidate.workspace_id);
    if (!result) { skipped.push(candidate.location_id); continue; }
    if ("failed" in result) { failed++; skipped.push(candidate.location_id); continue; }
    pages++; checked += result.checked; updated += result.changed;
  }
  return { pages, reviewsChecked: checked, reviewsUpdated: updated, failures: failed, deferred: skipped.length - failed };
}
