import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveWorkspace } from "@/lib/services/session";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AuditLogFilters } from "@/components/audit-log-filters";
import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const AUDIT_LIMIT = 200;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Tone = "good" | "bad" | "neutral" | "info";

const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  "google_connection.created": { label: "Connected a Google account", tone: "good" },
  "google_connection.failed": { label: "Google connection failed", tone: "bad" },
  "google_connection.revoked": { label: "Disconnected a Google account", tone: "neutral" },
  "google_sync.completed": { label: "Imported Google locations", tone: "info" },
  "client.created": { label: "Created a client", tone: "info" },
  "location.connected": { label: "Assigned a location to a client", tone: "good" },
  "location.disconnected": { label: "Removed a location from a client", tone: "neutral" },
  "locations.reset_unassigned": { label: "Reset unassigned locations", tone: "neutral" },
  "location_insight.generated": { label: "Generated a location insight", tone: "info" },
  "review.sync_started": { label: "Started a review sync", tone: "info" },
  "review.synced": { label: "Synced reviews", tone: "good" },
  "review.sync_failed": { label: "Review sync failed", tone: "bad" },
  "reply.ai_generated": { label: "Generated an AI draft", tone: "info" },
  "reply.edited": { label: "Edited a reply", tone: "info" },
  "reply.approved": { label: "Approved a reply", tone: "good" },
  "reply.publish_attempted": { label: "Started publishing a reply", tone: "neutral" },
  "reply.published": { label: "Published a reply to Google", tone: "good" },
  "reply.publish_failed": { label: "Reply publish failed", tone: "bad" },
  "reply.deleted": { label: "Deleted a reply", tone: "neutral" },
  "workspace.invite_created": { label: "Invited someone", tone: "info" },
  "workspace.invite_accepted": { label: "Joined from an invite", tone: "good" },
  "workspace.invite_revoked": { label: "Cancelled an invite", tone: "neutral" },
  "workspace.member_role_changed": { label: "Changed a member's role", tone: "info" },
  "workspace.member_removed": { label: "Removed a member", tone: "neutral" },
  "workspace.member_left": { label: "Left the workspace", tone: "neutral" },
};

const ENTITY_LABELS: Record<string, string> = {
  grm_clients: "Client",
  grm_google_connections: "Google account",
  grm_google_locations: "Location",
  grm_location_insights: "Insight",
  grm_review_ai_drafts: "AI draft",
  grm_review_replies: "Reply",
  grm_reviews: "Review",
  grm_workspace_invites: "Invite",
  grm_workspace_members: "Member",
};

const TONE_CLASSES: Record<Tone, string> = {
  good: "bg-green-50 text-green-700",
  bad: "bg-red-50 text-red-700",
  neutral: "bg-[#f3f2ef] text-[#5f6168]",
  info: "bg-[#ede9ff] text-[#4823ff]",
};

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

function MetadataLine({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(
    ([k, v]) => k in METADATA_LABELS && v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[#898b91]">
      {entries.map(([k, v]) => (
        <span key={k}>
          {METADATA_LABELS[k]}: <span className="text-[#18161a]">{String(v)}</span>
        </span>
      ))}
    </p>
  );
}

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const [params, { workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);
  const admin = createAdminClient();

  const actionFilter = typeof params.action === "string" ? params.action : "";
  const userFilter = typeof params.user === "string" ? params.user : "";
  const fromDate = typeof params.from === "string" ? params.from : "";
  const toDate = typeof params.to === "string" ? params.to : "";
  const entityFilter = typeof params.entity === "string" ? params.entity : "";

  let query = admin
    .from("grm_audit_logs")
    .select("id, action, entity_type, entity_id, metadata, user_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(AUDIT_LIMIT);

  if (actionFilter) query = query.eq("action", actionFilter);
  if (userFilter && /^[0-9a-f-]{36}$/i.test(userFilter)) {
    query = query.eq("user_id", userFilter);
  }
  if (entityFilter) query = query.eq("entity_type", entityFilter);
  if (fromDate && !Number.isNaN(Date.parse(fromDate))) {
    query = query.gte("created_at", new Date(fromDate).toISOString());
  }
  if (toDate && !Number.isNaN(Date.parse(toDate))) {
    const end = new Date(toDate);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  const [{ data: logs }, roster] = await Promise.all([
    query,
    getWorkspaceRoster(workspaceId),
  ]);

  const emailById = new Map(roster.members.map((m) => [m.userId, m.email]));
  const rows = logs ?? [];
  const hasFilters = !!(actionFilter || userFilter || entityFilter || fromDate || toDate);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every connection, sync, draft, approval, and publish in this workspace, with who did it."
      />

      <AuditLogFilters
        currentAction={actionFilter}
        currentUser={userFilter}
        currentEntity={entityFilter}
        currentFrom={fromDate}
        currentTo={toDate}
        actionOptions={Object.entries(ACTION_LABELS).map(([value, v]) => ({
          value,
          label: v.label,
        }))}
        entityOptions={Object.entries(ENTITY_LABELS).map(([value, label]) => ({
          value,
          label,
        }))}
        memberOptions={roster.members.map((m) => ({ value: m.userId, label: m.email }))}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasFilters ? "No entries match your filters" : "No activity yet"}
          description={
            hasFilters
              ? "Try a wider date range or clear the filters."
              : "Entries appear here as your team connects accounts, syncs, and replies."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-[#e6e4e1] bg-white">
          <ul className="divide-y divide-[#f0eeeb]">
            {rows.map((log) => {
              const action = readableAction(log.action);
              const actor = log.user_id
                ? (emailById.get(log.user_id) ?? "Former member")
                : "System";
              return (
                <li
                  key={log.id}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5"
                >
                  <time
                    dateTime={log.created_at}
                    className="shrink-0 text-xs tabular-nums text-[#898b91] sm:w-40 sm:pt-0.5"
                  >
                    {formatDate(log.created_at)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          TONE_CLASSES[action.tone]
                        )}
                      >
                        {action.label}
                      </span>
                      <span className="text-xs text-[#898b91]">
                        {ENTITY_LABELS[log.entity_type] ?? log.entity_type}
                      </span>
                    </div>
                    <MetadataLine
                      metadata={(log.metadata ?? {}) as Record<string, unknown>}
                    />
                  </div>
                  <p className="truncate text-sm text-[#18161a] sm:max-w-[220px] sm:text-right">
                    {actor}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[#f0eeeb] px-5 py-2.5 text-xs text-[#898b91]">
            Showing {rows.length} most recent entries
            {rows.length === AUDIT_LIMIT && ". Use the filters to narrow the list."}
          </div>
        </div>
      )}
    </div>
  );
}
