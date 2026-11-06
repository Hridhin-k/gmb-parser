// Re-export the database schema types as the canonical database types.
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
  GrmMemberRole,
  GrmConnectionStatus,
  GrmReplyStatus,
  GrmReplyPubStatus,
  GrmReplySource,
  GrmAiDraftStatus,
  GrmSyncStatus,
} from "@/lib/types/database-schema";

// ---------------------------------------------------------------------------
// Audit action literals — typed set of allowed audit log action values.
// ---------------------------------------------------------------------------
export type AuditAction =
  | "google_connection.created"
  | "google_connection.failed"
  | "google_connection.revoked"
  | "google_sync.completed"
  | "google_sync.failed"
  | "client.created"
  | "client.updated"
  | "client.brand_profile_saved"
  | "client.onboarding_issued"
  | "client.approval_updated"
  | "branding.updated"
  | "location.connected"
  | "location.disconnected"
  | "review.sync_started"
  | "review.synced"
  | "review.edit_synced"
  | "review.edits_checked"
  | "review.edit_sync_failed"
  | "review.sync_failed"
  | "reply.ai_generated"
  | "reply.template_generated"
  | "reply.ai_failed"
  | "ai.request_failed"
  | "ai.request_completed"
  | "ai.persistence_failed"
  | "review.analysis_failed"
  | "analysis.run_failed"
  | "insight.report_failed"
  | "reviews.bulk_failed"
  | "reply.edited"
  | "reply.edit_failed"
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
  | "automation.ready"
  | "automation.held"
  | "reply.deleted"
  | "locations.reset_unassigned"
  | "reviews.bulk_generate"
  | "reviews.bulk_approve"
  | "reviews.bulk_publish"
  | "reviews.bulk_discard"
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
  | "platform.tenant_created"
  | "platform.tenant_suspend"
  | "platform.tenant_reactivate"
  | "platform.tenant_delete"
  | "platform.tenant_restore"
  | "platform.tenant_reset"
  | "platform.support_view_started"
  | "onboarding.updated"
  | "location_group.updated"
  | "review.assigned"
  | "review.note_added"
  | "insight.action_assigned"
  | "insight.action_unassigned"
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
  | "location.grouping_failed"
  | "location.tagged"
  | "location.manager_set"
  | "location.settings_updated"
  | "location.duplicate_reviewed";
