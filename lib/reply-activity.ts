const LABELS: Record<string, string> = {
  "review.synced": "Review stored from Google",
  "reply.ai_generated": "Draft generated",
  "reply.edited": "Draft edited",
  "reply.submitted": "Submitted for approval",
  "reply.approved": "Draft approved",
  "reply.guardrail_blocked": "Guardrail blocked the reply",
  "reply.publish_attempted": "Publication started",
  "reply.published": "Reply published",
  "reply.publish_failed": "Publication failed",
  "reply.publish_uncertain": "Google did not confirm the reply",
  "reply.reconciled": "Checked the reply already on Google",
  "reply.deleted": "Draft removed",
};

export function replyActivityLabel(action: string): string | null {
  return LABELS[action] ?? null;
}
