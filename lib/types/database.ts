// Re-export the generated Supabase types as the canonical database types.
// All application code should import GRM domain types from here.
export type {
  GrmWorkspace,
  GrmWorkspaceMember,
  GrmClient,
  GrmGoogleConnection,
  GrmGoogleConnectionSafe,
  GrmGoogleAccount,
  GrmGoogleLocation,
  GrmReview,
  GrmReviewAiDraft,
  GrmReviewReply,
  GrmAuditLog,
  GrmLocationInsight,
  GrmMemberRole,
  GrmConnectionStatus,
  GrmReplyStatus,
  GrmReplyPubStatus,
  GrmReplySource,
  GrmAiDraftStatus,
  GrmSyncStatus,
} from "@/lib/types/supabase";

// ---------------------------------------------------------------------------
// Audit action literals — typed set of allowed audit log action values.
// ---------------------------------------------------------------------------
export type AuditAction =
  | "google_connection.created"
  | "google_connection.failed"
  | "google_connection.revoked"
  | "google_sync.completed"
  | "client.created"
  | "location.connected"
  | "location.disconnected"
  | "review.sync_started"
  | "review.synced"
  | "review.sync_failed"
  | "reply.ai_generated"
  | "reply.edited"
  | "reply.approved"
  | "reply.publish_attempted"
  | "reply.published"
  | "reply.publish_failed"
  | "reply.deleted"
  | "locations.reset_unassigned"
  | "reviews.bulk_generate"
  | "reviews.bulk_approve"
  | "reviews.bulk_publish"
  | "reviews.bulk_discard"
  | "location_insight.generated"
  | "workspace.invite_created"
  | "workspace.invite_revoked"
  | "workspace.member_role_changed"
  | "workspace.member_removed"
  | "workspace.member_left"
  | "workspace.invite_accepted";
