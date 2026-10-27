import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShellProfileAttention } from "@/lib/shell";
import { mergeProfileAttention, parseShellProfileCounts } from "@/lib/shell-profile";
import { listUnreadNotices, type ProfileNotice } from "@/lib/services/notifications";
import { remember } from "@/lib/ttl-cache";

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

function scopeKey(ids: string[] | null): string {
  if (!ids) return "*";
  return ids.length < 2 ? (ids[0] ?? "") : [...ids].sort().join(",");
}

/** Counts for the sidebar and the bell. A location list limits both to those profiles. */
export const getShellSummary = cache(async function getShellSummary(
  workspaceId: string,
  allowedClientIds: string[] | null = null,
  locationIds: string[] | null = null,
  userId: string | null = null
): Promise<ShellSummary> {
  const key = `shell:${userId ?? ""}:${workspaceId}:${scopeKey(allowedClientIds)}:${scopeKey(locationIds)}`;
  return remember(key, 60_000, () => loadShellSummary(workspaceId, allowedClientIds, locationIds, userId));
});

async function loadShellSummary(
  workspaceId: string,
  allowedClientIds: string[] | null,
  locationIds: string[] | null,
  userId: string | null
): Promise<ShellSummary> {
  const admin = createAdminClient();
  const noticesPromise = userId ? listUnreadNotices(workspaceId, userId) : Promise.resolve([] as ProfileNotice[]);
  const connections = admin
    .from("grm_google_connections")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "expired");

  if (locationIds) {
    if (locationIds.length === 0) {
      return { ...EMPTY, notices: await noticesPromise };
    }
    const [profiles, expiredConnections, notices] = await Promise.all([
      profileAttention(workspaceId, locationIds),
      count(allowedClientIds ? connections.in("client_id", allowedClientIds) : connections),
      noticesPromise,
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
    if (allowedClientIds.length === 0) return { ...EMPTY, notices: await noticesPromise };
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("client_id", allowedClientIds);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    scopedLocationIds = (data ?? []).map((location) => location.id);
    if (scopedLocationIds.length === 0) return { ...EMPTY, notices: await noticesPromise };
  }

  const reviewsPromise = admin.rpc("grm_location_review_stats", { p_workspace_id: workspaceId });
  const escalationsQuery = admin
    .from("grm_escalations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .neq("status", "resolved");
  const [statsResult, escalations, expiredConnections, notices] = await Promise.all([
    reviewsPromise,
    count(scopedLocationIds ? escalationsQuery.in("location_id", scopedLocationIds) : escalationsQuery),
    count(allowedClientIds ? connections.in("client_id", allowedClientIds) : connections),
    noticesPromise,
  ]);
  if (statsResult.error) throw new Error(`Failed to load navigation counts: ${statsResult.error.message}`);
  const allowed = scopedLocationIds ? new Set(scopedLocationIds) : null;
  let unreplied = 0;
  let drafts = 0;
  let failed = 0;
  for (const row of statsResult.data ?? []) {
    if (allowed && !allowed.has(row.location_id)) continue;
    unreplied += row.unanswered ?? 0;
    drafts += row.drafts ?? 0;
    failed += row.failed ?? 0;
  }

  return { unreplied, escalations, drafts, failed, expiredConnections, profiles: [], notices };
}
