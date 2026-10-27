import { createAdminClient } from "@/lib/db/client";
import { inScope, type ResourceRef, type ScopeIds } from "@/lib/access";
import { logger } from "@/lib/logger";

export const FRESH_REVIEW_MS = 7 * 24 * 60 * 60 * 1000;

export type ProfileNoticeKind = "new_reviews" | "escalation_assigned" | "sla_reminder" | "publish_failed";

export interface ProfileNotice {
  id: string;
  title: string;
  href: string;
}

export function isFreshReview(createTime: string, now = Date.now()): boolean {
  const created = Date.parse(createTime);
  return Number.isFinite(created) && created <= now + 60_000 && now - created <= FRESH_REVIEW_MS;
}

function schemaMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "PGRST204" || code === "PGRST205" || code === "42P01" || code === "42703" || message.includes("does not exist") || message.includes("schema cache");
}

/** Reviews that arrived in the last week, one notice per profile per day. */
export async function notifyProfileEvent(input: {
  workspaceId: string;
  locationId: string;
  kind: ProfileNoticeKind;
  detail: string;
  href: string;
  dedupeKey: string;
  /** When set, only these people. They still have to cover the profile and have in-app alerts on. */
  userIds?: string[];
}): Promise<void> {
  if (input.userIds && input.userIds.length === 0) return;
  try {
    const admin = createAdminClient();
    const { data: location, error: locationError } = await admin
      .from("grm_google_locations")
      .select("id, location_title, client_id, group_id, workspace_id")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.locationId)
      .maybeSingle();
    if (locationError || !location) return;

    let parentGroupId: string | null = null;
    if (location.group_id) {
      const { data: group } = await admin.from("grm_groups").select("parent_id").eq("id", location.group_id).maybeSingle();
      parentGroupId = group?.parent_id ?? null;
    }
    const resource: ResourceRef = {
      workspaceId: input.workspaceId,
      clientId: location.client_id,
      groupId: location.group_id,
      parentGroupId,
      locationId: location.id,
    };
    const { data: members, error: memberError } = await admin
      .from("grm_workspace_members")
      .select("user_id, access_enabled, scope_client_id, scope_group_id, scope_location_id, alert_in_app")
      .eq("workspace_id", input.workspaceId);
    if (memberError || !members) return;

    const wanted = input.userIds ? new Set(input.userIds) : null;
    const recipients = members.filter((member) => {
      if (member.access_enabled === false || member.alert_in_app === false) return false;
      if (wanted && !wanted.has(member.user_id)) return false;
      const scope: ScopeIds = {
        clientId: member.scope_client_id,
        groupId: member.scope_group_id,
        locationId: member.scope_location_id,
      };
      return inScope(scope, resource, input.workspaceId);
    });
    if (recipients.length === 0) return;

    const title = `${location.location_title}: ${input.detail}`.slice(0, 180);
    const rows = recipients.map((member) => ({
      workspace_id: input.workspaceId,
      user_id: member.user_id,
      location_id: location.id,
      kind: input.kind,
      title,
      href: input.href,
      dedupe_key: input.dedupeKey,
    }));
    const { error } = await admin.from("grm_notifications").upsert(rows, {
      onConflict: "workspace_id,user_id,dedupe_key",
      ignoreDuplicates: true,
    });
    if (error && !schemaMissing(error)) {
      logger.error("notifications.write_failed", { workspaceId: input.workspaceId, locationId: location.id, message: error.message });
    }
  } catch (error) {
    logger.error("notifications.write_failed", {
      workspaceId: input.workspaceId,
      locationId: input.locationId,
      message: error instanceof Error ? error.message : "Unknown",
    });
  }
}

export async function listUnreadNotices(workspaceId: string, userId: string): Promise<ProfileNotice[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_notifications")
      .select("id, title, href")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) {
      if (!schemaMissing(error)) {
        logger.error("notifications.read_failed", { workspaceId, userId, message: error.message });
      }
      return [];
    }
    return data ?? [];
  } catch (error) {
    logger.error("notifications.read_failed", {
      workspaceId,
      userId,
      message: error instanceof Error ? error.message : "Unknown",
    });
    return [];
  }
}

export async function markNoticeRead(workspaceId: string, userId: string, noticeId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", noticeId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) {
    if (schemaMissing(error)) return false;
    throw new Error("Could not update that notification.");
  }
  return (data ?? []).length > 0;
}
