import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { saveManualReply } from "@/lib/services/manual-reply";
import { ReplyPublishingService } from "@/lib/services/reply-publishing";
import { GoogleOAuthService } from "@/lib/services/google-oauth";
import { GoogleReviewService } from "@/lib/services/google-reviews";

vi.mock("@/lib/services/dashboard", () => ({ forgetReviewList: vi.fn() }));

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("saving published reply updates", () => {
  const ws = randomUUID(), other = randomUUID(), user = randomUUID(), location = randomUUID();
  let ready = false;
  const pool = () => getPool();
  const live = "Thank you for your feedback. Our team will follow up.";
  const updated = "Thank you for the update. We appreciate the chance to resolve this.";
  async function fixture(status = "published", withReply = true) {
    const reviewId = randomUUID(), replyId = randomUUID();
    await pool().query(`INSERT INTO grm_reviews(id,workspace_id,location_id,google_review_name,google_review_id,star_rating,review_create_time,google_reply_comment,reply_status,reopened_at)
      VALUES($1::uuid,$2,$3,$4,$1::text,2,now(),$5,$6,now())`, [reviewId, ws, location, `reviews/${reviewId}`, live, status]);
    if (withReply) await pool().query(`INSERT INTO grm_review_replies(id,workspace_id,review_id,content,source,status,created_by,approved_by,approved_at,published_at,client_approval,last_error,failure_count,publish_result)
      VALUES($1,$2,$3,$4,'ai',$5,$6,$6,now(),now(),'approved','Old error',2,'{"retry":{"code":"GOOGLE_REPLY_UNAVAILABLE"}}')`, [replyId, ws, reviewId, live, status, user]);
    return { workspaceId: ws, userId: user, reviewId, ...(withReply ? { replyId } : {}), content: updated, expectedGoogleReply: live, ...(withReply ? { expectedContent: live } : {}) };
  }
  beforeAll(async () => {
    process.loadEnvFile(".env.local"); const url = new URL(process.env.DATABASE_URL || "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") throw new Error("Dedicated local database required");
    await pool().query("INSERT INTO authn.users(id,email) VALUES($1,$2)", [user, `${user}@grm.test`]);
    await pool().query("INSERT INTO grm_workspaces(id,name,slug) VALUES($1,'Reply QA',$2),($3,'Other QA',$4)", [ws, `test-${ws}`, other, `test-${other}`]); ready = true;
    const { rows: [conn] } = await pool().query(`INSERT INTO grm_google_connections(workspace_id,authorized_by_user_id,google_email,access_token_enc,refresh_token_enc,token_expires_at)
      VALUES($1,$2,'test@example.test','test','test',now()) RETURNING id`, [ws, user]);
    const { rows: [account] } = await pool().query(`INSERT INTO grm_google_accounts(workspace_id,connection_id,google_account_name,account_display_name,account_type)
      VALUES($1,$2,'accounts/qa','QA','PERSONAL') RETURNING id`, [ws, conn.id]);
    await pool().query(`INSERT INTO grm_google_locations(id,workspace_id,google_account_id,google_location_name,location_title)
      VALUES($1,$2,$3,'locations/qa','QA store')`, [location, ws, account.id]);
  });
  afterAll(async () => {
    if (ready) { await pool().query("DELETE FROM grm_workspaces WHERE id=ANY($1::uuid[])", [[ws, other]]); await pool().query("DELETE FROM authn.users WHERE id=$1", [user]); await pool().end(); }
  });
  it("saves an update draft, clears approval/retry state, and preserves the live reply and audit history", async () => {
    const input = await fixture(); const saved = await saveManualReply(input);
    expect(saved).toMatchObject({ id: input.replyId, content: updated, source: "manual", status: "draft", approved_by: null, approved_at: null, published_at: null, last_error: null, failure_count: 0 });
    const { rows: [review] } = await pool().query("SELECT google_reply_comment,reply_status,reopened_at FROM grm_reviews WHERE id=$1", [input.reviewId]);
    expect(review).toMatchObject({ google_reply_comment: live, reply_status: "draft" }); expect(review.reopened_at).toBeTruthy();
    expect((await pool().query("SELECT publish_result,client_approval FROM grm_review_replies WHERE id=$1", [input.replyId])).rows[0]).toEqual({ publish_result: null, client_approval: "none" });
    const { rows: [audit] } = await pool().query("SELECT metadata FROM grm_audit_logs WHERE workspace_id=$1 AND entity_id=$2", [ws, input.replyId]);
    expect(audit.metadata).toMatchObject({ googleReplyBefore: live, before: { content: live, status: "published" }, after: { content: updated, status: "draft", approved_by: null } });
  });
  it("creates an update draft for a reply synced from Google with no local reply row", async () => {
    const input = await fixture("published", false); const saved = await saveManualReply(input);
    expect(saved).toMatchObject({ status: "draft", content: updated });
    expect((await pool().query("SELECT google_reply_comment FROM grm_reviews WHERE id=$1", [input.reviewId])).rows[0].google_reply_comment).toBe(live);
  });
  it("rejects pending sends, stale edits and cross-workspace IDs without changing anything", async () => {
    const pending = await fixture("pending_publish");
    await expect(saveManualReply(pending)).rejects.toMatchObject({ code: "PUBLISH_IN_PROGRESS" });
    const input = await fixture();
    await expect(saveManualReply({ ...input, expectedContent: "outdated" })).rejects.toMatchObject({ code: "REPLY_CHANGED" });
    await expect(saveManualReply({ ...input, expectedGoogleReply: "outdated" })).rejects.toMatchObject({ code: "REPLY_CHANGED" });
    await expect(saveManualReply({ ...input, workspaceId: other })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const another = await fixture();
    await expect(saveManualReply({ ...input, replyId: another.replyId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pool().query("SELECT status,content FROM grm_review_replies WHERE id=$1", [input.replyId])).rows[0]).toEqual({ status: "published", content: live });
  });
  it("allows only one competing edit and retains its before/after history", async () => {
    const input = await fixture();
    const results = await Promise.allSettled([saveManualReply(input), saveManualReply({ ...input, content: "A different proposed update." })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await pool().query("SELECT count(*)::int n FROM grm_audit_logs WHERE workspace_id=$1 AND entity_id=$2", [ws, input.replyId])).rows[0].n).toBe(1);
  });
  it("publishes an approved replacement to the same Google review and clears reopened only after confirmation", async () => {
    const input = await fixture(); const saved = await saveManualReply(input);
    await pool().query("UPDATE grm_review_replies SET status='approved',approved_by=$1,approved_at=now() WHERE id=$2", [user, saved.id]);
    await pool().query("UPDATE grm_reviews SET reply_status='approved' WHERE id=$1", [input.reviewId]);
    const auth = vi.spyOn(GoogleOAuthService, "getValidAccessToken").mockResolvedValue("test-no-google-call");
    const send = vi.spyOn(GoogleReviewService, "replyToReview").mockResolvedValue({ comment: updated, updateTime: new Date().toISOString() });
    try {
      await ReplyPublishingService.publishReply(saved.id, input.reviewId, ws, user);
      expect(send).toHaveBeenCalledExactlyOnceWith("test-no-google-call", `reviews/${input.reviewId}`, updated);
      expect((await pool().query("SELECT reply_status,google_reply_comment,reopened_at FROM grm_reviews WHERE id=$1", [input.reviewId])).rows[0])
        .toEqual({ reply_status: "published", google_reply_comment: updated, reopened_at: null });
      expect((await pool().query("SELECT metadata FROM grm_audit_logs WHERE workspace_id=$1 AND entity_id=$2 AND action='reply.edited'", [ws, saved.id])).rows[0].metadata.before.content).toBe(live);
    } finally { auth.mockRestore(); send.mockRestore(); }
  });
});
