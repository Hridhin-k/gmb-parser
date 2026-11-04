import { createAdminClient } from "@/lib/db/client";
import { inScope, type ResourceRef, type ScopeIds } from "@/lib/access";
import { logger } from "@/lib/logger";
import { getPool } from "@/lib/db/pool";

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

export async function listUnreadNotices(workspaceId: string, userId: string, locationIds: string[] | null = null): Promise<ProfileNotice[]> {
  if (locationIds?.length === 0) return [];
  try {
    const { rows } = await getPool().query<ProfileNotice & { kind: string; location_title: string; ticket_no: number | null; reviewer_display_name: string | null }>(`
      SELECT n.id,n.title,n.href,n.kind,l.location_title,e.ticket_no,r.reviewer_display_name FROM (
        SELECT * FROM (
          SELECT DISTINCT ON (kind,href) * FROM grm_notifications
          WHERE workspace_id=$1 AND user_id=$2 AND read_at IS NULL
            AND ($3::uuid[] IS NULL OR location_id=ANY($3))
          ORDER BY kind,href,created_at DESC,id DESC
        ) grouped ORDER BY created_at DESC,id DESC LIMIT 8
      ) n LEFT JOIN grm_google_locations l ON l.workspace_id=n.workspace_id AND l.id=n.location_id
      LEFT JOIN grm_escalations e ON e.workspace_id=n.workspace_id AND n.href='/escalations/'||e.id::text
      LEFT JOIN grm_reviews r ON r.workspace_id=e.workspace_id AND r.id=e.review_id
      ORDER BY n.created_at DESC,n.id DESC`, [workspaceId, userId, locationIds]);
    return rows.map((row) => ({ id: row.id, href: row.href,
      title: row.kind === "sla_reminder" && row.ticket_no
        ? `${row.location_title}: Follow-up #${row.ticket_no} · ${row.reviewer_display_name || "Customer review"}`
        : row.title }));
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
  try {
    const result = await getPool().query(`UPDATE grm_notifications n SET read_at=now()
      FROM grm_notifications target WHERE target.id=$1 AND target.workspace_id=$2 AND target.user_id=$3
        AND n.workspace_id=target.workspace_id AND n.user_id=target.user_id
        AND n.kind=target.kind AND n.href=target.href AND n.read_at IS NULL`, [noticeId, workspaceId, userId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    if (schemaMissing(error as { code?: string; message?: string })) return false;
    throw new Error("Could not update that notification.");
  }
}
