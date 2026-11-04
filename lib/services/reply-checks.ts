import { createHash } from "crypto";
import { AuditService } from "@/lib/services/audit";
import { ValidationError } from "@/lib/errors";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";

export function replyContentHash(content: string): string {
  return createHash("sha256").update(content.trim()).digest("hex").slice(0, 16);
}

/** Records a blocked public reply and throws. A passing check does not approve anything. */
export async function assertSafePublicReply(input: {
  workspaceId: string;
  userId: string;
  reviewId: string;
  content: string;
  stage: string;
}): Promise<void> {
  const violations = checkReplyGuardrails(input.content);
  if (!violations.length) return;
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "reply.guardrail_blocked",
    entityType: "grm_reviews",
    entityId: input.reviewId,
    metadata: { codes: violations.map((item) => item.code), stage: input.stage },
  });
  throw new ValidationError(violations[0].message);
}
