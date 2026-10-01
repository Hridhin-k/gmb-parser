import { createAdminClient } from "@/lib/supabase/admin";
import type { AuditAction } from "@/lib/types";
import type { Json } from "@/lib/types/supabase";

interface AuditLogEntry {
  workspaceId: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  static async log(entry: AuditLogEntry): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase.from("grm_audit_logs").insert({
      workspace_id: entry.workspaceId,
      user_id: entry.userId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: (entry.metadata ?? {}) as Json,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
    });

    if (error) {
      console.error("[AuditService] Failed to write audit log:", error);
    }
  }
}
