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
  | "client.updated"
  | "client.onboarding_issued"
  | "client.approval_updated"
  | "branding.updated"
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
  | "reply.publish_uncertain"
  | "reply.reconciled"
  | "reply.submitted"
  | "reply.guardrail_blocked"
  | "settings.reply_updated"
  | "settings.template_saved"
  | "ai_config.activated"
  | "ai_config.archived"
  | "ai_config.saved"
  | "ai_knowledge.created"
  | "ai_knowledge.updated"
  | "ai_knowledge.deleted"
  | "insight.feedback"
  | "automation.ready"
  | "automation.held"
  | "reply.deleted"
  | "locations.reset_unassigned"
  | "reviews.bulk_generate"
  | "reviews.bulk_approve"
  | "reviews.bulk_publish"
  | "reviews.bulk_discard"
  | "location_insight.generated"
  | "scope_insight.generated"
  | "workspace.invite_created"
  | "workspace.invite_resent"
  | "workspace.invite_revoked"
  | "workspace.member_role_changed"
  | "workspace.member_scope_changed"
  | "workspace.member_deactivated"
  | "workspace.member_activated"
  | "workspace.notifications_updated"
  | "workspace.member_removed"
  | "workspace.member_left"
  | "workspace.invite_accepted"
  | "onboarding.updated"
  | "location_group.updated"
  | "review.assigned"
  | "review.note_added"
  | "escalation.policy_updated"
  | "escalation.contact_updated"
  | "escalation.opened"
  | "escalation.assigned"
  | "escalation.started"
  | "escalation.commented"
  | "escalation.fallback"
  | "escalation.level_changed"
  | "escalation.resolved"
  | "escalation.next_step"
  | "escalation.reminder"
  | "autoreply.paused"
  | "autoreply.resumed"
  | "report.saved"
  | "report.deleted"
  | "report.tested"
  | "alert_rule.saved"
  | "alert_rule.deleted"
  | "request.saved"
  | "request.sent"
  | "request.tested"
  | "request.deleted"
  | "request.policy_updated"
  | "location_group.created"
  | "location_group.renamed"
  | "location_group.merged"
  | "location.moved"
  | "location.tagged"
  | "location.manager_set"
  | "location.settings_updated"
  | "location.duplicate_reviewed";
