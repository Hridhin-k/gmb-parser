import { getPool } from "@/lib/db/pool";
import { AppError } from "@/lib/errors";
import { sanitizeAuditMetadata } from "@/lib/audit-details";
import { forgetReviewList } from "@/lib/services/dashboard";

export interface ManualReplyDraft {
  id: string; content: string; source: string; status: string; created_at: string;
  approved_at: string | null; approved_by: string | null; published_at: string | null;
  last_error: string | null; failure_count: number;
}
type ReplySnapshot = Pick<ManualReplyDraft, "content" | "status" | "source" | "approved_at" | "approved_by" | "published_at">;

/** Access and public-text checks run in the route before this atomic save.
 * Saving never calls Google. The published text remains on the review until
 * the normal approval/publish flow confirms a replacement. */
export async function saveManualReply(input: {
  workspaceId: string; userId: string; reviewId: string; content: string;
  replyId?: string; expectedContent?: string; expectedGoogleReply?: string | null;
}): Promise<ManualReplyDraft> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const { rows: [review] } = await db.query<{ google_reply_comment: string | null; missing_on_google_at: string | null }>(
      "SELECT google_reply_comment,missing_on_google_at FROM grm_reviews WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [input.workspaceId, input.reviewId]);
    if (!review) throw new AppError("Review not found", "NOT_FOUND", 404);
    if (review.missing_on_google_at) throw new AppError("This review is no longer available on Google. Its history is kept.", "GOOGLE_REVIEW_MISSING", 410);
    if (input.expectedGoogleReply !== undefined && input.expectedGoogleReply !== review.google_reply_comment) {
      throw new AppError("The Google reply changed. Refresh this review before saving your update.", "REPLY_CHANGED", 409);
    }
    let before: ReplySnapshot | null = null;
    let saved: ManualReplyDraft;
    if (input.replyId) {
      const { rows: [reply] } = await db.query<ReplySnapshot>(`SELECT content,status,source,approved_at,approved_by,published_at FROM grm_review_replies
        WHERE workspace_id=$1 AND review_id=$2 AND id=$3 FOR UPDATE`, [input.workspaceId, input.reviewId, input.replyId]);
      if (!reply) throw new AppError("Reply not found", "NOT_FOUND", 404);
      if (reply.status === "pending_publish") throw new AppError("This reply is being published. Wait until that finishes, then edit it.", "PUBLISH_IN_PROGRESS", 409);
      if (!["draft", "approved", "failed", "published"].includes(reply.status)) throw new AppError("This reply cannot be edited.", "INVALID_STATE", 409);
      if (input.expectedContent !== undefined && input.expectedContent !== reply.content) throw new AppError("Someone changed this reply. Refresh before saving your update.", "REPLY_CHANGED", 409);
      before = reply;
      const { rows } = await db.query<ManualReplyDraft>(`UPDATE grm_review_replies SET content=$4,source='manual',status='draft',
        approved_at=NULL,approved_by=NULL,published_at=NULL,published_by=NULL,last_error=NULL,failure_count=0,publish_result=NULL,client_approval='none'
        WHERE workspace_id=$1 AND review_id=$2 AND id=$3
        RETURNING id,content,source,status,created_at,approved_at,approved_by,published_at,last_error,failure_count`,
      [input.workspaceId, input.reviewId, input.replyId, input.content]);
      saved = rows[0];
    } else {
      const { rows } = await db.query<ManualReplyDraft>(`INSERT INTO grm_review_replies(workspace_id,review_id,content,source,status,created_by)
        VALUES($1,$2,$3,'manual','draft',$4)
        RETURNING id,content,source,status,created_at,approved_at,approved_by,published_at,last_error,failure_count`,
      [input.workspaceId, input.reviewId, input.content, input.userId]);
      saved = rows[0];
    }
    await db.query("UPDATE grm_reviews SET reply_status='draft' WHERE workspace_id=$1 AND id=$2", [input.workspaceId, input.reviewId]);
    await db.query(`INSERT INTO grm_audit_logs(workspace_id,user_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'reply.edited','grm_review_replies',$3,$4::jsonb)`, [input.workspaceId, input.userId, saved.id,
      JSON.stringify(sanitizeAuditMetadata({ reviewId: input.reviewId, source: "manual", operation: before ? "edit" : "create",
        publishedReplyUnchanged: Boolean(review.google_reply_comment), googleReplyBefore: review.google_reply_comment,
        before, after: { content: saved.content, status: saved.status, source: saved.source, approved_at: null, approved_by: null } }))]);
    await db.query("COMMIT");
    forgetReviewList(input.workspaceId, input.userId);
    return saved;
  } catch (error) {
    await db.query("ROLLBACK");
    if (error instanceof AppError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new AppError("An active reply already exists. Refresh this review to edit it.", "REPLY_EXISTS", 409);
    throw new AppError("Could not save the reply. Your published reply has not changed.", "DB_ERROR", 500);
  } finally { db.release(); }
}
