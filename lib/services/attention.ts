import { createAdminClient } from "@/lib/supabase/admin";
import { forgetPrefix } from "@/lib/ttl-cache";
import { markNoticeRead } from "@/lib/services/notifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALERT_IDS = new Set(["escalations", "unreplied", "failed", "drafts", "connections", "more-profiles"]);
const CHUNK = 150;

export type AttentionKind = "review" | "escalation" | "alert";

export function isAttentionAlertId(id: string): boolean {
  if (ALERT_IDS.has(id)) return true;
  if (id.startsWith("profile:") && UUID.test(id.slice("profile:".length))) return true;
  if (id.startsWith("notice:") && UUID.test(id.slice("notice:".length))) return true;
  return false;
}

export interface SeenAttention {
  unreplied: number;
  escalations: number;
  unrepliedByLocation: Map<string, number>;
  escalationsByLocation: Map<string, number>;
  dismissedAlerts: Array<{ id: string; title: string }>;
}

function emptySeen(): SeenAttention {
  return {
    unreplied: 0,
    escalations: 0,
    unrepliedByLocation: new Map(),
    escalationsByLocation: new Map(),
    dismissedAlerts: [],
  };
}

function bump(map: Map<string, number>, id: string | null): void {
  if (!id) return;
  map.set(id, (map.get(id) ?? 0) + 1);
}

function chunks(ids: string[]): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) groups.push(ids.slice(index, index + CHUNK));
  return groups;
}

function missingTable(error: { code?: string; message: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message.includes("grm_attention_seen")
  );
}

/** Opened reviews and escalations still waiting, plus bell items this person dismissed. */
export async function loadSeenAttention(
  workspaceId: string,
  userId: string | null,
  locationIds: string[] | null
): Promise<SeenAttention> {
  if (!userId) return emptySeen();
  const admin = createAdminClient();
  const seen = await admin
    .from("grm_attention_seen")
    .select("kind, entity_id, fingerprint")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (seen.error) {
    if (missingTable(seen.error)) return emptySeen();
    throw new Error(`Failed to load opened items: ${seen.error.message}`);
  }

  const reviewIds: string[] = [];
  const escalationIds: string[] = [];
  const dismissedAlerts: Array<{ id: string; title: string }> = [];
  for (const row of seen.data ?? []) {
    if (row.kind === "review" && UUID.test(row.entity_id)) reviewIds.push(row.entity_id);
    else if (row.kind === "escalation" && UUID.test(row.entity_id)) escalationIds.push(row.entity_id);
    else if (row.kind === "alert" && row.fingerprint) {
      dismissedAlerts.push({ id: row.entity_id, title: row.fingerprint });
    }
  }

  const reviews: Array<{ location_id: string | null }> = [];
  for (const ids of chunks(reviewIds)) {
    let query = admin
      .from("grm_reviews")
      .select("location_id")
      .eq("workspace_id", workspaceId)
      .eq("reply_status", "none")
      .is("missing_on_google_at", null)
      .in("id", ids);
    if (locationIds) query = query.in("location_id", locationIds);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load opened reviews: ${error.message}`);
    reviews.push(...(data ?? []));
  }

  const escalations: Array<{ location_id: string | null }> = [];
  for (const ids of chunks(escalationIds)) {
    let query = admin
      .from("grm_escalations")
      .select("location_id")
      .eq("workspace_id", workspaceId)
      .neq("status", "resolved")
      .in("id", ids);
    if (locationIds) query = query.in("location_id", locationIds);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load opened escalations: ${error.message}`);
    escalations.push(...(data ?? []));
  }

  const unrepliedByLocation = new Map<string, number>();
  const escalationsByLocation = new Map<string, number>();
  for (const review of reviews) bump(unrepliedByLocation, review.location_id);
  for (const escalation of escalations) bump(escalationsByLocation, escalation.location_id);
  return {
    unreplied: reviews.length,
    escalations: escalations.length,
    unrepliedByLocation,
    escalationsByLocation,
    dismissedAlerts,
  };
}

export async function markAttentionSeen(input: {
  workspaceId: string;
  userId: string;
  kind: AttentionKind;
  id: string;
  title?: string | null;
}): Promise<void> {
  if (input.kind === "alert" && input.id.startsWith("notice:")) {
    const noticeId = input.id.slice("notice:".length);
    if (!UUID.test(noticeId)) throw new Error("Invalid notification");
    await markNoticeRead(input.workspaceId, input.userId, noticeId);
    forgetPrefix(`shell:${input.userId}:`);
    return;
  }

  const admin = createAdminClient();
  if (input.kind === "review" || input.kind === "escalation") {
    if (!UUID.test(input.id)) throw new Error("Invalid item");
    const table = input.kind === "review" ? "grm_reviews" : "grm_escalations";
    const { data, error } = await admin
      .from(table)
      .select("id")
      .eq("id", input.id)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (error || !data) throw new Error("That item is not in this workspace.");
  } else if (!isAttentionAlertId(input.id)) {
    throw new Error("Invalid notification");
  }

  const { error } = await admin.from("grm_attention_seen").upsert(
    {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: input.kind,
      entity_id: input.id,
      fingerprint: input.title?.slice(0, 500) ?? null,
      seen_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id,kind,entity_id" }
  );
  if (error) throw new Error("Could not update that count.");
  forgetPrefix(`shell:${input.userId}:`);
}
