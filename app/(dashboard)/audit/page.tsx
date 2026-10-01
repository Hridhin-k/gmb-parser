import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { AuditLogFilters } from "@/components/audit-log-filters";
import { ClipboardList } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Human-readable action labels — safe to display
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  "google_connection.created":  { label: "Google connected",       color: "bg-green-100 text-green-700" },
  "google_connection.failed":   { label: "Google connect failed",   color: "bg-red-100 text-red-700" },
  "google_connection.revoked":  { label: "Google disconnected",     color: "bg-gray-100 text-gray-700" },
  "google_sync.completed":      { label: "Locations synced",        color: "bg-blue-100 text-blue-700" },
  "client.created":             { label: "Client created",          color: "bg-blue-100 text-blue-700" },
  "location.connected":         { label: "Location connected",      color: "bg-green-100 text-green-700" },
  "location.disconnected":      { label: "Location disconnected",   color: "bg-gray-100 text-gray-700" },
  "review.sync_started":        { label: "Review sync started",     color: "bg-blue-100 text-blue-700" },
  "review.synced":              { label: "Reviews synced",          color: "bg-green-100 text-green-700" },
  "review.sync_failed":         { label: "Review sync failed",      color: "bg-red-100 text-red-700" },
  "reply.ai_generated":         { label: "AI draft generated",      color: "bg-purple-100 text-purple-700" },
  "reply.edited":               { label: "Reply edited",            color: "bg-blue-100 text-blue-700" },
  "reply.approved":             { label: "Reply approved",          color: "bg-green-100 text-green-700" },
  "reply.publish_attempted":    { label: "Publish started",         color: "bg-yellow-100 text-yellow-700" },
  "reply.published":            { label: "Reply published",         color: "bg-green-100 text-green-700" },
  "reply.publish_failed":       { label: "Publish failed",          color: "bg-red-100 text-red-700" },
  "reply.deleted":              { label: "Reply deleted",           color: "bg-gray-100 text-gray-700" },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_LABELS[action];
  if (!cfg) {
    return (
      <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100 font-mono text-[10px]">
        {action}
      </Badge>
    );
  }
  return (
    <Badge className={`${cfg.color} hover:${cfg.color}`}>
      {cfg.label}
    </Badge>
  );
}

// Safe subset of metadata to show — never expose tokens or keys
const SAFE_METADATA_KEYS = new Set([
  "reviewsSynced",
  "reviewsUpdated",
  "pagesProcessed",
  "status",
  "errorClass",
  "reviewId",
  "locationId",
  "clientId",
  "publishedAt",
  "model",
  "promptVersion",
  "googleEmail",
]);

function SafeMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(
    ([k, v]) => SAFE_METADATA_KEYS.has(k) && v !== null && v !== undefined
  );
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1 space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 text-[11px]">
          <dt className="text-gray-400">{k}:</dt>
          <dd className="truncate text-gray-600">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user!);

  const { workspace_id: workspaceId } = membership;

  // Parse filters
  const actionFilter  = typeof params.action   === "string" ? params.action   : "";
  const userFilter    = typeof params.user      === "string" ? params.user     : "";
  const fromDate      = typeof params.from      === "string" ? params.from     : "";
  const toDate        = typeof params.to        === "string" ? params.to       : "";
  const entityFilter  = typeof params.entity    === "string" ? params.entity   : "";

  // Build audit query
  let query = admin
    .from("grm_audit_logs")
    .select("id, action, entity_type, entity_id, metadata, user_id, created_at, ip_address")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }
  if (userFilter) {
    query = query.eq("user_id", userFilter);
  }
  if (entityFilter) {
    query = query.eq("entity_type", entityFilter);
  }
  if (fromDate) {
    query = query.gte("created_at", new Date(fromDate).toISOString());
  }
  if (toDate) {
    // Include the full to-date day
    const end = new Date(toDate);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  const { data: logs } = await query;

  // Distinct action values for the filter dropdown
  const { data: distinctActions } = await admin
    .from("grm_audit_logs")
    .select("action")
    .eq("workspace_id", workspaceId)
    .order("action");

  const actionOptions = [
    ...new Set((distinctActions ?? []).map((r) => r.action)),
  ];

  // Distinct entity types
  const { data: distinctEntities } = await admin
    .from("grm_audit_logs")
    .select("entity_type")
    .eq("workspace_id", workspaceId)
    .order("entity_type");

  const entityOptions = [
    ...new Set((distinctEntities ?? []).map((r) => r.entity_type)),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description="Immutable record of all important operations in your workspace."
      />

      {/* Filters */}
      <AuditLogFilters
        currentAction={actionFilter}
        currentUser={userFilter}
        currentEntity={entityFilter}
        currentFrom={fromDate}
        currentTo={toDate}
        actionOptions={actionOptions}
        entityOptions={entityOptions}
        actionLabels={Object.fromEntries(
          Object.entries(ACTION_LABELS).map(([k, v]) => [k, v.label])
        )}
      />

      {/* Table */}
      {(logs?.length ?? 0) === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={actionFilter || userFilter || entityFilter || fromDate || toDate
            ? "No log entries match your filters"
            : "No audit events yet"}
          description={
            actionFilter || userFilter || entityFilter || fromDate || toDate
              ? "Try adjusting the filters."
              : "Audit events are created as you use the platform."
          }
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Action
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Entity
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Details
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    User
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(logs ?? []).map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-gray-500">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="text-xs font-mono text-gray-600">
                        {log.entity_type}
                      </p>
                      {log.entity_id && (
                        <p className="text-[10px] font-mono text-gray-400 truncate max-w-[120px]">
                          {log.entity_id}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top max-w-xs">
                      <SafeMetadata
                        metadata={
                          (log.metadata ?? {}) as Record<string, unknown>
                        }
                      />
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <p className="text-[10px] font-mono text-gray-400 truncate max-w-[120px]">
                        {log.user_id}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-200 px-4 py-2.5 text-xs text-gray-400">
            Showing {(logs ?? []).length} most recent entries
            {(logs?.length ?? 0) === 200 && " (limited to 200 — use filters to narrow)"}
          </div>
        </div>
      )}
    </div>
  );
}
