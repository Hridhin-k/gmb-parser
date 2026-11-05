import { createAdminClient } from "@/lib/db/client";
import type { AuditAction } from "@/lib/types";
import type { Json } from "@/lib/types/database-schema";
import { sanitizeAuditMetadata } from "@/lib/audit-details";

interface AuditLogEntry {
  workspaceId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  static async log(entry: AuditLogEntry): Promise<void> {
    try {
      const db = createAdminClient();

      const { error } = await db.from("grm_audit_logs").insert({
        workspace_id: entry.workspaceId,
        user_id: entry.userId ?? null,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        metadata: sanitizeAuditMetadata(entry.metadata ?? {}) as Json,
        ip_address: entry.ipAddress ?? null,
        user_agent: entry.userAgent ?? null,
      });

      if (error) throw error;
    } catch {
      // Observability failures must not replace the original outcome or trigger a second paid call.
      console.error("[AuditService] Failed to write audit log", { action: entry.action, workspaceId: entry.workspaceId, entityId: entry.entityId });
    }
  }
}
