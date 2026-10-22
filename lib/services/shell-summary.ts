import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShellProfileAttention } from "@/lib/shell";
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
const PAGE = 1000;

async function pagesOf<T>(
  load: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (from < 20_000) {
    const { data, error } = await load(from);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function profileAttention(workspaceId: string, locationIds: string[]): Promise<ShellProfileAttention[]> {
  if (locationIds.length === 0) return [];
  const admin = createAdminClient();
  const names = new Map<string, string>();
  const buckets = new Map<string, ShellProfileAttention>();
  for (let index = 0; index < locationIds.length; index += CHUNK) {
    const chunk = locationIds.slice(index, index + CHUNK);
    const { data, error } = await admin
      .from("grm_google_locations")
      .select("id, location_title")
      .eq("workspace_id", workspaceId)
      .in("id", chunk);
    if (error) throw new Error(`Failed to load navigation counts: ${error.message}`);
    for (const location of data ?? []) names.set(location.id, location.location_title);
  }
  for (const id of locationIds) {
    buckets.set(id, {
      id,
      name: names.get(id) || "Profile",
      unreplied: 0,
      escalations: 0,
      drafts: 0,
      failed: 0,
    });
  }

  for (let index = 0; index < locationIds.length; index += CHUNK) {
    const chunk = locationIds.slice(index, index + CHUNK);
    const [reviews, escalations] = await Promise.all([
      pagesOf<{ location_id: string; reply_status: string }>((from) =>
        admin
          .from("grm_reviews")
          .select("location_id, reply_status")
          .eq("workspace_id", workspaceId)
          .is("missing_on_google_at", null)
          .in("location_id", chunk)
          .in("reply_status", ["none", "draft", "failed"])
          .range(from, from + PAGE - 1)
      ),
      pagesOf<{ location_id: string }>((from) =>
        admin
          .from("grm_escalations")
          .select("location_id")
          .eq("workspace_id", workspaceId)
          .in("location_id", chunk)
          .neq("status", "resolved")
          .range(from, from + PAGE - 1)
      ),
    ]);
    for (const review of reviews) {
      const bucket = buckets.get(review.location_id);
      if (!bucket) continue;
      if (review.reply_status === "none") bucket.unreplied += 1;
      else if (review.reply_status === "draft") bucket.drafts += 1;
      else if (review.reply_status === "failed") bucket.failed += 1;
    }
    for (const escalation of escalations) {
      const bucket = buckets.get(escalation.location_id);
      if (bucket) bucket.escalations += 1;
    }
  }

  return [...buckets.values()].filter(
    (profile) => profile.unreplied + profile.escalations + profile.drafts + profile.failed > 0
  );
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
