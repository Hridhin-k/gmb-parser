import { createAdminClient } from "@/lib/supabase/admin";

export interface ShellSummary {
  unreplied: number;
  /** Open escalation records, including those past the due time. */
  escalations: number;
  drafts: number;
  expiredConnections: number;
}

async function count(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
  return value ?? 0;
}

/** Counts for the sidebar badges. A client list limits the counts to those clients. */
export async function getShellSummary(
  workspaceId: string,
  allowedClientIds: string[] | null = null
): Promise<ShellSummary> {
  const admin = createAdminClient();
  const empty = { unreplied: 0, escalations: 0, drafts: 0, expiredConnections: 0 };
  let locationIds: string[] | null = null;
  if (allowedClientIds) {
    if (allowedClientIds.length === 0) return empty;
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("client_id", allowedClientIds);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    locationIds = (data ?? []).map((location) => location.id);
    if (locationIds.length === 0) return empty;
  }
  const reviews = admin.from("grm_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  const escalationsQuery = admin
    .from("grm_escalations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("status", "resolved");
  const connections = admin
    .from("grm_google_connections")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "expired");
  const [unreplied, escalations, drafts, expiredConnections] = await Promise.all([
    count(
      locationIds
        ? reviews.eq("reply_status", "none").in("location_id", locationIds)
        : reviews.eq("reply_status", "none")
    ),
    count(locationIds ? escalationsQuery.in("location_id", locationIds) : escalationsQuery),
    count(
      locationIds
        ? admin
            .from("grm_reviews")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("reply_status", "draft")
            .in("location_id", locationIds)
        : admin
            .from("grm_reviews")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("reply_status", "draft")
    ),
    count(allowedClientIds ? connections.in("client_id", allowedClientIds) : connections),
  ]);

  return { unreplied, escalations, drafts, expiredConnections };
}
