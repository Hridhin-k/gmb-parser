import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShellProfileAttention } from "@/lib/shell";
import { mergeProfileAttention, parseShellProfileCounts } from "@/lib/shell-profile";
import { listUnreadNotices, type ProfileNotice } from "@/lib/services/notifications";

export interface ShellSummary {
  unreplied: number;
  /** Open escalation records, including those past the due time. */
  escalations: number;
  drafts: number;
  failed: number;
  expiredConnections: number;
  /** Profiles this person covers that currently need attention. Empty for an organisation-wide view. */
  profiles: ShellProfileAttention[];
  notices: ProfileNotice[];
}

const EMPTY: ShellSummary = {
  unreplied: 0,
  escalations: 0,
  drafts: 0,
  failed: 0,
  expiredConnections: 0,
  profiles: [],
  notices: [],
};

async function count(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
  return value ?? 0;
}

const CHUNK = 150;

/**
 * Per-location attention counts from Postgres (`grm_shell_profile_attention`).
 * This used to page every unreplied/draft/failed review row and every open
 * escalation row into the app just to count them — on every page render.
 */
async function profileAttention(workspaceId: string, locationIds: string[]): Promise<ShellProfileAttention[]> {
  if (locationIds.length === 0) return [];
  const admin = createAdminClient();
  const counts: ReturnType<typeof parseShellProfileCounts> = [];
  for (let index = 0; index < locationIds.length; index += CHUNK) {
    const chunk = locationIds.slice(index, index + CHUNK);
    const { data, error } = await admin.rpc("grm_shell_profile_attention", {
      p_workspace_id: workspaceId,
      p_location_ids: chunk,
    });
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    counts.push(...parseShellProfileCounts(data));
  }
  if (counts.length === 0) return [];

  const names = new Map<string, string>();
  for (let index = 0; index < counts.length; index += CHUNK) {
    const ids = counts.slice(index, index + CHUNK).map((count) => count.locationId);
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id, location_title")
      .eq("workspace_id", workspaceId)
      .in("id", ids);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    for (const location of data ?? []) names.set(location.id, location.location_title);
  }
  return mergeProfileAttention(counts, names);
}

/** Counts for the sidebar and the bell. A location list limits both to those profiles. */
export const getShellSummary = cache(async function getShellSummary(
  workspaceId: string,
  allowedClientIds: string[] | null = null,
  locationIds: string[] | null = null,
  userId: string | null = null
): Promise<ShellSummary> {
  const admin = createAdminClient();
  const notices = userId ? await listUnreadNotices(workspaceId, userId) : [];
  const connections = admin
    .from("grm_google_connections")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "expired");

  if (locationIds) {
    if (locationIds.length === 0) {
      return { ...EMPTY, notices };
    }
    const [profiles, expiredConnections] = await Promise.all([
      profileAttention(workspaceId, locationIds),
      count(allowedClientIds ? connections.in("client_id", allowedClientIds) : connections),
    ]);
    return {
      unreplied: profiles.reduce((sum, profile) => sum + profile.unreplied, 0),
      escalations: profiles.reduce((sum, profile) => sum + profile.escalations, 0),
      drafts: profiles.reduce((sum, profile) => sum + profile.drafts, 0),
      failed: profiles.reduce((sum, profile) => sum + profile.failed, 0),
      expiredConnections,
      profiles,
      notices,
    };
  }

  let scopedLocationIds: string[] | null = null;
  if (allowedClientIds) {
    if (allowedClientIds.length === 0) return { ...EMPTY, notices };
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("client_id", allowedClientIds);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    scopedLocationIds = (data ?? []).map((location) => location.id);
    if (scopedLocationIds.length === 0) return { ...EMPTY, notices };
  }

  const reviews = admin.from("grm_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("missing_on_google_at", null);
  const escalationsQuery = admin
    .from("grm_escalations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("status", "resolved");
  const draftQuery = admin
    .from("grm_reviews")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("missing_on_google_at", null)
    .eq("reply_status", "draft");
  const failedQuery = admin
    .from("grm_reviews")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("missing_on_google_at", null)
    .eq("reply_status", "failed");
  const [unreplied, escalations, drafts, failed, expiredConnections] = await Promise.all([
    count(
      scopedLocationIds
        ? reviews.eq("reply_status", "none").in("location_id", scopedLocationIds)
        : reviews.eq("reply_status", "none")
    ),
    count(scopedLocationIds ? escalationsQuery.in("location_id", scopedLocationIds) : escalationsQuery),
    count(scopedLocationIds ? draftQuery.in("location_id", scopedLocationIds) : draftQuery),
    count(scopedLocationIds ? failedQuery.in("location_id", scopedLocationIds) : failedQuery),
    count(allowedClientIds ? connections.in("client_id", allowedClientIds) : connections),
  ]);

  return { unreplied, escalations, drafts, failed, expiredConnections, profiles: [], notices };
});
