import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db/client";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canOpenPath } from "@/lib/shell";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AuditLogFilters } from "@/components/audit-log-filters";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { AuditLogTable, type AuditTableRow } from "@/components/audit-log-table";
import { Button } from "@/components/ui/button";
import { ClipboardList, Download } from "lucide-react";
import { parseDateRange } from "@/lib/date-range";
import { PaginationBar } from "@/components/pagination-bar";
import { validatePage } from "@/lib/validation";
import { formatFriendlyDateTime } from "@/lib/format-date";

const AUDIT_PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return formatFriendlyDateTime(iso, "2-digit");
}

type Tone = "good" | "bad" | "neutral" | "info";

const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  "google_connection.created": {
    label: "Connected a Google account",
    tone: "good",
  },
  "google_connection.failed": {
    label: "Google connection failed",
    tone: "bad",
  },
  "google_connection.revoked": {
    label: "Disconnected a Google account",
    tone: "neutral",
  },
  "google_sync.completed": { label: "Imported Google locations", tone: "info" },
  "client.created": { label: "Created a business", tone: "info" },
  "client.updated": { label: "Updated a business", tone: "info" },
  "location.connected": {
    label: "Assigned a location to a business",
    tone: "good",
  },
  "location.disconnected": {
    label: "Removed a location from a business",
    tone: "neutral",
  },
  "location.moved": { label: "Moved locations", tone: "info" },
  "location.tagged": { label: "Tagged a location", tone: "info" },
  "location.manager_set": { label: "Set a store manager", tone: "info" },
  "location.settings_updated": { label: "Changed reply rules", tone: "info" },
  "location.duplicate_reviewed": { label: "Reviewed a duplicate", tone: "neutral" },
  "location_group.created": { label: "Created a group", tone: "info" },
  "location_group.renamed": { label: "Renamed a group", tone: "info" },
  "location_group.merged": { label: "Merged groups", tone: "neutral" },
  "locations.reset_unassigned": {
    label: "Reset unassigned locations",
    tone: "neutral",
  },
  "review.sync_started": { label: "Started a review sync", tone: "info" },
  "review.synced": { label: "Synced reviews", tone: "good" },
  "review.sync_failed": { label: "Review sync failed", tone: "bad" },
  "reply.ai_generated": { label: "Generated an AI draft", tone: "info" },
  "reply.edited": { label: "Edited a reply", tone: "info" },
  "reply.approved": { label: "Approved a reply", tone: "good" },
  "reply.publish_attempted": {
    label: "Started publishing a reply",
    tone: "neutral",
  },
  "reply.published": { label: "Published a reply to Google", tone: "good" },
  "reply.publish_failed": { label: "Reply publish failed", tone: "bad" },
  "reply.deleted": { label: "Deleted a reply", tone: "neutral" },
  "reply.submitted": { label: "Submitted a reply for approval", tone: "info" },
  "reply.publish_uncertain": { label: "Publish outcome uncertain", tone: "neutral" },
  "reply.guardrail_blocked": { label: "Reply blocked by a guardrail", tone: "bad" },
  "escalation.opened": { label: "Opened an escalation", tone: "info" },
  "escalation.assigned": { label: "Assigned an escalation", tone: "info" },
  "escalation.commented": { label: "Commented on an escalation", tone: "info" },
  "escalation.resolved": { label: "Resolved an escalation", tone: "good" },
  "request.saved": { label: "Saved a review request", tone: "info" },
  "request.sent": { label: "Sent a review request", tone: "good" },
  "request.deleted": { label: "Deleted a review request", tone: "neutral" },
  "workspace.invite_created": { label: "Invited someone", tone: "info" },
  "workspace.invite_accepted": { label: "Joined from an invite", tone: "good" },
  "workspace.invite_revoked": { label: "Cancelled an invite", tone: "neutral" },
  "workspace.member_role_changed": {
    label: "Changed a member's role",
    tone: "info",
  },
  "workspace.member_removed": { label: "Removed a member", tone: "neutral" },
  "workspace.member_left": { label: "Left the workspace", tone: "neutral" },
  "workspace.member_scope_changed": { label: "Changed a member's scope", tone: "info" },
  "workspace.member_activated": { label: "Turned access on", tone: "good" },
  "workspace.member_deactivated": { label: "Turned access off", tone: "neutral" },
  "workspace.invite_resent": { label: "Resent an invite", tone: "info" },
  "workspace.notifications_updated": { label: "Changed alert settings", tone: "info" },
};

const ENTITY_LABELS: Record<string, string> = {
  grm_clients: "Business",
  grm_google_connections: "Google account",
  grm_google_locations: "Location",
  grm_groups: "Group",
  grm_location_groups: "Group",
  grm_escalations: "Escalation",
  request_campaign: "Review request",
  grm_review_ai_drafts: "AI draft",
  grm_review_replies: "Reply",
  grm_reviews: "Review",
  grm_workspace_invites: "Invite",
  grm_workspace_members: "Member",
};

const TONE_VARIANT: Record<Tone, AuditTableRow["tone"]> = {
  good: "ok",
  bad: "bad",
  neutral: "default",
  info: "info",
};

/** Link an audit entry to its object when a page for it exists. */
function objectHref(entityType: string, entityId: string | null): string | null {
  if (!entityId || !/^[0-9a-f-]{36}$/i.test(entityId)) return null;
  switch (entityType) {
    case "grm_clients":
      return `/businesses/${entityId}`;
    case "grm_google_locations":
      return `/locations?location=${entityId}`;
    case "grm_groups":
    case "grm_location_groups":
      return `/locations?group=${entityId}`;
    case "grm_escalations":
      return `/escalations/${entityId}`;
    default:
      return null;
  }
}

const METADATA_LABELS: Record<string, string> = {
  reviewsSynced: "New reviews",
  reviewsUpdated: "Updated",
  pagesProcessed: "Pages",
  status: "Status",
  errorClass: "Error",
  publishedAt: "Published",
  model: "Model",
  googleEmail: "Google account",
  email: "Email",
  role: "Role",
  previousRole: "Previous role",
};

function readableAction(action: string) {
  return (
    ACTION_LABELS[action] ?? {
      label: action.replaceAll("_", " ").replace(".", ": "),
      tone: "neutral" as Tone,
    }
  );
}

function metadataDetails(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .filter(([k, v]) => k in METADATA_LABELS && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({ label: METADATA_LABELS[k], value: String(v) }));
}

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const role = await getActiveRole();
  if (!canOpenPath("/audit", role)) redirect("/overview");

  const [params, { workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);
  const admin = createAdminClient();

  const actionFilter = typeof params.action === "string" ? params.action : "";
  const userFilter = typeof params.user === "string" ? params.user : "";
  const range = parseDateRange(params, "all");
  const entityFilter = typeof params.entity === "string" ? params.entity : "";
  const currentPage = validatePage(params.page);

  // Server-side pagination: exact count + one ranged page from Postgres.
  let query = admin
    .from("grm_audit_logs")
    .select("id, action, entity_type, entity_id, metadata, user_id, created_at", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .range((currentPage - 1) * AUDIT_PAGE_SIZE, currentPage * AUDIT_PAGE_SIZE - 1);

  if (actionFilter) query = query.eq("action", actionFilter);
  if (userFilter && /^[0-9a-f-]{36}$/i.test(userFilter)) {
    query = query.eq("user_id", userFilter);
  }
  if (entityFilter) query = query.eq("entity_type", entityFilter);
  if (range.start) query = query.gte("created_at", range.start.toISOString());
  if (range.end) query = query.lt("created_at", range.end.toISOString());

  const [{ data: logs, count: totalCount }, roster] = await Promise.all([
    query,
    getWorkspaceRoster(workspaceId),
  ]);

  const emailById = new Map(roster.members.map((m) => [m.userId, m.email]));
  const rows = logs ?? [];
  const totalEntries = totalCount ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / AUDIT_PAGE_SIZE));
  const paginationParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== "page") paginationParams.set(key, value);
  }
  const fromEntry = totalEntries === 0 ? 0 : (currentPage - 1) * AUDIT_PAGE_SIZE + 1;
  const toEntry = Math.min(currentPage * AUDIT_PAGE_SIZE, totalEntries);
  const hasFilters = !!(
    actionFilter ||
    userFilter ||
    entityFilter ||
    range.key !== "all"
  );

  const tableRows: AuditTableRow[] = rows.map((log) => {
    const action = readableAction(log.action);
    const actorEmail = log.user_id ? emailById.get(log.user_id) : null;
    return {
      id: log.id,
      time: log.created_at,
      timeLabel: formatDate(log.created_at),
      actor: log.user_id ? (actorEmail ?? "Former member") : "System",
      actorKind: log.user_id ? (actorEmail ? "person" : "former") : "system",
      action: log.action,
      actionLabel: action.label,
      tone: TONE_VARIANT[action.tone],
      objectLabel: ENTITY_LABELS[log.entity_type] ?? log.entity_type,
      objectId: log.entity_id ?? null,
      objectHref: objectHref(log.entity_type, log.entity_id ?? null),
      details: metadataDetails((log.metadata ?? {}) as Record<string, unknown>),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        description="Who did what, to which object, and when: every connection, sync, draft, approval and publish in this workspace. Read-only."
      >
        <Button variant="outline" disabled title="Exporting the audit log is not available yet">
          <Download aria-hidden />
          Export CSV
        </Button>
      </PageHeader>

      <TransitionScope>
        <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
          <div className="border-b border-line px-4 py-2.5">
            <AuditLogFilters
              currentAction={actionFilter}
              currentUser={userFilter}
              currentEntity={entityFilter}
              currentRange={{ key: range.key, from: range.from, to: range.to }}
              actionOptions={Object.entries(ACTION_LABELS).map(([value, v]) => ({
                value,
                label: v.label,
              }))}
              entityOptions={Object.entries(ENTITY_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              memberOptions={roster.members.map((m) => ({
                value: m.userId,
                label: m.email,
              }))}
            />
          </div>

          <PendingRegion label="Filtering activity…">
            {rows.length === 0 ? (
              <EmptyState
                bare
                icon={ClipboardList}
                title={hasFilters ? "No entries match your filters" : "No activity yet"}
                description={
                  hasFilters
                    ? "Try a wider date range or clear the filters."
                    : "Entries appear here as your team connects accounts, syncs, and replies."
                }
              />
            ) : (
              <>
                <AuditLogTable
                  rows={tableRows}
                  summary={`Showing ${fromEntry.toLocaleString("en-US")}–${toEntry.toLocaleString("en-US")} of ${totalEntries.toLocaleString("en-US")} entries · newest first`}
                />
                {totalPages > 1 ? (
                  <div className="border-t border-line px-3">
                    <PaginationBar
                      basePath="/audit"
                      currentPage={currentPage}
                      totalPages={totalPages}
                      searchParams={paginationParams}
                    />
                  </div>
                ) : null}
              </>
            )}
          </PendingRegion>
        </section>
      </TransitionScope>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Actors</h2>
          <p className="mt-1 text-xs text-ink-3">
            People are shown by email. Automatic work such as syncs appears as System; someone who has left shows as Former member.
          </p>
        </section>
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Objects</h2>
          <p className="mt-1 text-xs text-ink-3">
            Businesses, locations, groups and escalations link to their page. Other objects show their type and a short ID.
          </p>
        </section>
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold text-ink">Search</h2>
          <p className="mt-1 text-xs text-ink-3">
            The search box covers the entries on the current page. Use the action, item, person and date filters to narrow the whole log.
          </p>
        </section>
      </div>
    </div>
  );
}
