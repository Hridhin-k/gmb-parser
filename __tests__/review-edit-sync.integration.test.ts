import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { syncEditedReviews } from "@/lib/services/review-edit-sync";
import { GoogleReviewService } from "@/lib/services/google-reviews";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { GoogleApiError } from "@/lib/errors";
import { contentFingerprint, responseFingerprint } from "@/lib/review-version";
import { reviewHash } from "@/lib/services/review-sync";
import type { GoogleReview } from "@/lib/types/google";
import { generateAi } from "@/lib/ai/service";
import { refreshDailySummaries } from "@/lib/services/daily-insights";

vi.mock("@/lib/services/dashboard", () => ({ forgetReviewList: vi.fn() }));
vi.mock("@/lib/ai/service", async (original) => ({ ...await original<typeof import("@/lib/ai/service")>(), generateAi: vi.fn() }));
vi.mock("@/lib/services/daily-insights", async (original) => ({ ...await original<typeof import("@/lib/services/daily-insights")>(), refreshDailySummaries: vi.fn() }));

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("edited-review polling in Postgres", () => {
  const ws = randomUUID(), foreign = randomUUID(), user = randomUUID(), location = randomUUID(), otherLocation = randomUUID();
  const db = () => getPool();
  const list = vi.spyOn(GoogleReviewService, "listReviews"), auth = vi.spyOn(GoogleOAuthService, "getValidAccessToken"), publish = vi.spyOn(GoogleReviewService, "replyToReview");
  let ready = false;
  const base = (id = "existing"): GoogleReview => ({ name: `accounts/qa/locations/qa/reviews/${id}`, reviewId: id,
    reviewer: { displayName: "Customer" }, starRating: "FIVE", comment: "Good service", createTime: "2020-01-01T00:00:00Z", updateTime: "2020-01-01T00:00:00Z",
    reviewReply: { comment: "Thank you for your feedback.", updateTime: "2020-01-02T00:00:00Z" } });
  async function seed(review = base(), workspace = ws, loc = location, status = "published", legacy = false) {
    const id = randomUUID();
    await db().query(`INSERT INTO grm_reviews(id,workspace_id,location_id,google_review_name,google_review_id,star_rating,comment,
      review_create_time,review_update_time,google_reply_comment,reply_status,content_fingerprint,response_fingerprint,sync_hash)
      VALUES($1,$2,$3,$4,$5,5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, workspace, loc, review.name, review.reviewId, review.comment,
      review.createTime, review.updateTime, review.reviewReply?.comment ?? null, status,
      legacy ? null : contentFingerprint({ starRating: 5, comment: review.comment ?? null, createTime: review.createTime }), responseFingerprint(review.reviewReply?.comment), reviewHash(review)]);
    return id;
  }
  const run = (maxPages = 1) => syncEditedReviews({ workspaceId: ws, maxPages });
  const state = async () => (await db().query("SELECT * FROM grm_review_edit_sync WHERE workspace_id=$1", [ws])).rows[0];
  const due = () => db().query("UPDATE grm_review_edit_sync SET available_at=now()-interval '1 minute' WHERE workspace_id=$1", [ws]);
  beforeAll(async () => {
    process.loadEnvFile(".env.local"); const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Dedicated local database required");
    await db().query("INSERT INTO authn.users(id,email) VALUES($1,$2)", [user, `${user}@grm.test`]);
    await db().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Edit sync QA',$2),($3,'Foreign QA',$4)", [ws, `test-${ws}`, foreign, `test-${foreign}`]); ready = true;
    for (const [workspace, loc] of [[ws, location], [foreign, otherLocation]]) {
      const { rows: [conn] } = await db().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
        VALUES($1,$2,'test@example.test','test','test',now()) RETURNING id`, [workspace, user]);
      const { rows: [account] } = await db().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type)
        VALUES($1,$2,'accounts/qa','QA','PERSONAL') RETURNING id`, [workspace, conn.id]);
      await db().query(`INSERT INTO grm_google_locations(id,workspace_id,google_account_id,google_location_name,location_title)
        VALUES($1,$2,$3,'accounts/qa/locations/qa','QA')`, [loc, workspace, account.id]);
    }
    await seed(base(), foreign, otherLocation);
  });
  beforeEach(async () => {
    await db().query("DELETE FROM grm_review_edit_sync WHERE workspace_id=$1", [ws]);
    await db().query("DELETE FROM grm_reviews WHERE workspace_id=$1", [ws]);
    await db().query("DELETE FROM grm_audit_logs WHERE workspace_id=$1", [ws]);
    vi.clearAllMocks(); list.mockReset(); auth.mockResolvedValue("test-no-provider");
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (ready) { await db().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, foreign]]); await db().query("DELETE FROM authn.users WHERE id=$1", [user]); await db().end(); }
  });
  it("updates an edited 2020 review, flags its published reply, and does not import or delete other reviews", async () => {
    const id = await seed(), absent = await seed(base("not-returned"));
    list.mockResolvedValueOnce({ reviews: [{ ...base(), comment: "The service has changed", starRating: "TWO", updateTime: new Date().toISOString() }, { ...base("new-unknown"), updateTime: new Date().toISOString() }], totalReviewCount: 2, averageRating: 2 });
    expect(await run()).toMatchObject({ pages: 1, reviewsUpdated: 1, failures: 0 });
    const { rows: [row] } = await db().query("SELECT comment,star_rating,reply_status,reopened_at FROM grm_reviews WHERE id=$1", [id]);
    expect(row).toMatchObject({ comment: "The service has changed", star_rating: 2, reply_status: "published" }); expect(row.reopened_at).toBeTruthy();
    expect((await db().query("SELECT missing_on_google_at FROM grm_reviews WHERE id=$1", [absent])).rows[0].missing_on_google_at).toBeNull();
    expect((await db().query("SELECT count(*)::int n FROM grm_reviews WHERE workspace_id=$1", [ws])).rows[0].n).toBe(2);
    expect((await db().query("SELECT comment FROM grm_reviews WHERE workspace_id=$1", [foreign])).rows[0].comment).toBe("Good service");
    const audit = (await db().query("SELECT metadata FROM grm_audit_logs WHERE entity_id=$1 AND action='review.edit_synced'", [id])).rows[0];
    expect(audit.metadata).toMatchObject({ before: { comment: "Good service", stars: 5 }, after: { comment: "The service has changed", stars: 2 }, reopened: true });
    expect((await state()).last_completed_at).toBeTruthy();
    expect(generateAi).not.toHaveBeenCalled(); expect(refreshDailySummaries).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect((await db().query("SELECT count(*)::int n FROM grm_daily_insights WHERE workspace_id=$1", [ws])).rows[0].n).toBe(0);
  });
  it("resumes durable pages and preserves the watermark across provider failure", async () => {
    await seed();
    list.mockResolvedValueOnce({ reviews: [base()], nextPageToken: "page-two", totalReviewCount: 100, averageRating: 5 });
    await run(); const first = await state();
    expect(first).toMatchObject({ page_token: "page-two", last_completed_at: null, pages_processed: 1 });
    list.mockRejectedValueOnce(new GoogleApiError("Provider temporarily unavailable", 503));
    expect(await run()).toMatchObject({ failures: 1 });
    expect(await state()).toMatchObject({ page_token: "page-two", last_completed_at: null, pages_processed: 1 });
    await due(); list.mockResolvedValueOnce({ reviews: [], totalReviewCount: 100, averageRating: 5 });
    await run(); expect(list.mock.calls.at(-1)?.[2]).toBe("page-two");
    expect(await state()).toMatchObject({ last_completed_at: first.run_started_at, run_started_at: null, page_token: null, pages_processed: 2 });
    expect((await db().query("SELECT count(*)::int n FROM grm_audit_logs WHERE workspace_id=$1 AND action='review.edit_sync_failed'", [ws])).rows[0].n).toBe(1);
  });
  it("polls recent updates to old reviews, stops at the overlap, and leaves existing approvals/drafts intact", async () => {
    const id = await seed(base(), ws, location, "approved"), reply = randomUUID();
    await db().query(`INSERT INTO grm_review_replies(id,workspace_id,review_id,content,source,status,created_by,approved_by,approved_at)
      VALUES($1,$2,$3,'Local approved response','manual','approved',$4,$4,now())`, [reply, ws, id, user]);
    list.mockResolvedValueOnce({ reviews: [base()], totalReviewCount: 1, averageRating: 5 }); await run();
    await due();
    await db().query("UPDATE grm_review_edit_sync SET last_completed_at=now()-interval '2 hours' WHERE workspace_id=$1", [ws]);
    list.mockClear(); list.mockResolvedValueOnce({ reviews: [{ ...base(), comment: "Edited years later", updateTime: new Date().toISOString() }, { ...base("old-unknown"), updateTime: "2020-01-01T00:00:00Z" }], nextPageToken: "must-not-fetch", totalReviewCount: 100, averageRating: 5 });
    await run(20); expect(list).toHaveBeenCalledTimes(1);
    expect((await state()).page_token).toBeNull();
    expect((await db().query("SELECT content,status,approved_by FROM grm_review_replies WHERE id=$1", [reply])).rows[0]).toEqual({ content: "Local approved response", status: "approved", approved_by: user });
    expect((await db().query("SELECT reply_status,reopened_at FROM grm_reviews WHERE id=$1", [id])).rows[0]).toMatchObject({ reply_status: "approved", reopened_at: expect.any(String) });
  });
  it("defers while the regular sync owns the location and serializes competing workers", async () => {
    await seed(); const lock = await db().connect(); const key = `location-pipeline:${ws}:${location}`;
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [key]);
    try { expect(await run()).toMatchObject({ pages: 0, deferred: 1 }); expect(list).not.toHaveBeenCalled(); }
    finally { await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); lock.release(); }
    list.mockResolvedValue({ reviews: [base()], totalReviewCount: 1, averageRating: 5 });
    await Promise.all([run(), run()]); expect(list).toHaveBeenCalledTimes(1);
  });
  it("refreshes media without invalidating legacy text analysis, and resets expired cursors safely", async () => {
    const id = await seed(base(), ws, location, "published", true);
    const before = (await db().query("SELECT revision FROM grm_insight_days WHERE workspace_id=$1 AND location_id=$2", [ws, location])).rows[0].revision;
    list.mockResolvedValueOnce({ reviews: [{ ...base(), reviewMediaItems: [{ thumbnailUrl: "https://lh3.googleusercontent.com/photo" }] }], nextPageToken: "expired", totalReviewCount: 100, averageRating: 5 });
    await run();
    expect((await db().query("SELECT content_fingerprint,review_media_items FROM grm_reviews WHERE id=$1", [id])).rows[0])
      .toMatchObject({ content_fingerprint: null, review_media_items: [expect.objectContaining({ thumbnailUrl: "https://lh3.googleusercontent.com/photo" })] });
    expect((await db().query("SELECT revision FROM grm_insight_days WHERE workspace_id=$1 AND location_id=$2", [ws, location])).rows[0].revision).toBe(before);
    list.mockRejectedValueOnce(new GoogleApiError("Invalid page token", 400)); await run();
    expect(await state()).toMatchObject({ page_token: null, run_started_at: null, last_completed_at: null });
    await due(); list.mockResolvedValueOnce({ reviews: [base()], totalReviewCount: 1, averageRating: 5 }); await run();
    expect(list.mock.calls.at(-1)?.[2]).toBeUndefined(); expect((await state()).last_completed_at).toBeTruthy();
  });
  it("rolls back the whole page and its cursor when a later stored review is invalid", async () => {
    const a = base("atomic-a"), b = base("atomic-b");
    const aId = await seed(a), bId = await seed(b);
    const invalidName = aId > bId ? a.name : b.name;
    const incoming = [a, b].map((r) => ({ ...r, comment: "Changed on this page", starRating: r.name === invalidName ? "INVALID" as GoogleReview["starRating"] : "TWO" as const }));
    list.mockResolvedValueOnce({ reviews: incoming, nextPageToken: "must-not-save", totalReviewCount: 100, averageRating: 2 });
    expect(await run()).toMatchObject({ failures: 1, pages: 0 });
    expect(await state()).toMatchObject({ page_token: null, pages_processed: 0, last_completed_at: null });
    expect((await db().query("SELECT comment FROM grm_reviews WHERE workspace_id=$1", [ws])).rows.every((r) => r.comment === "Good service")).toBe(true);
    expect((await db().query("SELECT count(*)::int n FROM grm_audit_logs WHERE workspace_id=$1 AND action='review.edit_synced'", [ws])).rows[0].n).toBe(0);
  });
});
