import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export async function recordUsageEvent(input: {
  workspaceId: string;
  clientId: string | null;
  kind: "reply_published" | "client_connected" | "client_created";
  sourceId: string;
  occurredAt?: string;
}): Promise<void> {
  const { error } = await createAdminClient().from("grm_usage_events").upsert(
    {
      workspace_id: input.workspaceId,
      client_id: input.clientId,
      kind: input.kind,
      source_id: input.sourceId,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    },
    { onConflict: "workspace_id,kind,source_id", ignoreDuplicates: true }
  );
  if (error) {
    logger.error("usage.event_failed", { message: error.message, kind: input.kind });
  }
}
