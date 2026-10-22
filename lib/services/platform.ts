import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/supabase";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import {
  isPlatformInviteExpired,
  isSuperAdminEmail,
  normalizeEmail,
  platformInviteExpiresAt,
} from "@/lib/platform-admin";
import { readDeliveryEnv } from "@/lib/reporting";
import { AuditService } from "@/lib/services/audit";

export function isSuperAdmin(user: { email?: string | null } | null | undefined): boolean {
  return isSuperAdminEmail(user?.email);
}

export async function requireSuperAdmin(user: { id: string; email?: string | null }): Promise<void> {
  if (!isSuperAdmin(user)) throw new AuthorizationError("Platform access is restricted to super admins.");
}

export interface PlatformInviteRow {
  id: string;
  email: string;
  status: string;
  invitedBy: string | null;
  workspaceId: string | null;
  acceptedUserId: string | null;
  note: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  suspendedAt: string | null;
  deletedAt: string | null;
  ownerEmail: string | null;
  members: number;
  clients: number;
  locations: number;
  reviews: number;
  plan: string;
  planExpiresAt: string | null;
  aiBudgetUsd: number | null;
  aiSpentUsd: number;
}

export interface PlatformOverview {
  invites: PlatformInviteRow[];
  inviteTotal: number;
  invitePage: number;
  invitePageSize: number;
  tenants: TenantRow[];
  tenantTotal: number;
  page: number;
  pageSize: number;
  stats: { tenants: number; active: number; suspended: number; deleted: number; pendingInvites: number; members: number; reviews: number };
}

export const TENANT_PAGE_SIZE = 20;
export const INVITE_PAGE_SIZE = 10;

function inviteRow(row: Record<string, unknown>): PlatformInviteRow {
  return {
    id: String(row.id),
    email: String(row.email),
    status: String(row.status),
    invitedBy: (row.invited_by as string | null) ?? null,
    workspaceId: (row.workspace_id as string | null) ?? null,
    acceptedUserId: (row.accepted_user_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    expiresAt: String(row.expires_at),
    acceptedAt: (row.accepted_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/** Best-effort invite email via the already-configured Resend env. Invite works without it. */
async function trySendInviteEmail(email: string): Promise<boolean> {
  const env = readDeliveryEnv(process.env);
  const from = process.env.PLATFORM_FROM_EMAIL?.trim() || env.reportFromEmail;
  if (!env.resendApiKey || !from) return false;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "You're invited to RevuPilot",
        text: `You've been invited to create your RevuPilot tenant.\n\nSign in with Google using this exact email (${email}):\n${appUrl}/login\n\nThis invite expires in 7 days. After signing in, you'll name your organization and can then invite your admins, managers, and members.`,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function createPlatformInvite(input: {
  inviter: { id: string; email?: string | null };
  email: string;
  note?: string | null;
}): Promise<{ invite: PlatformInviteRow; emailed: boolean }> {
  await requireSuperAdmin(input.inviter);
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length < 3 || email.length > 320) {
    throw new ValidationError("Enter a valid email address.");
  }
  if (isSuperAdminEmail(email)) throw new ValidationError("That email is a super admin, not a tenant owner.");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("grm_platform_invites")
    .select("id, status, expires_at")
    .eq("email", email)
    .in("status", ["pending", "accepted"])
    .maybeSingle();
  if (existing?.status === "accepted") throw new ValidationError("That email already created its tenant.");
  if (existing?.status === "pending" && !isPlatformInviteExpired(existing.expires_at)) {
    throw new ValidationError("That email already has a pending invite. Resend it instead.");
  }

  let row: Record<string, unknown> | null = null;
  if (existing) {
    const { data, error } = await admin
      .from("grm_platform_invites")
      .update({ status: "pending", expires_at: platformInviteExpiresAt(), invited_by: input.inviter.id, note: input.note?.trim().slice(0, 500) || null, workspace_id: null, accepted_user_id: null, accepted_at: null })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new AppError("Could not create the invite.", "DB_ERROR", 500, { dbError: error.message });
    row = data as unknown as Record<string, unknown>;
  } else {
    const { data, error } = await admin
      .from("grm_platform_invites")
      .insert({ email, invited_by: input.inviter.id, expires_at: platformInviteExpiresAt(), note: input.note?.trim().slice(0, 500) || null })
      .select("*")
      .single();
    if (error) throw new AppError("Could not create the invite.", "DB_ERROR", 500, { dbError: error.message });
    row = data as unknown as Record<string, unknown>;
  }
  const emailed = await trySendInviteEmail(email);
  return { invite: inviteRow(row!), emailed };
}

export async function resendPlatformInvite(input: {
  actor: { id: string; email?: string | null };
  inviteId: string;
}): Promise<{ emailed: boolean }> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_platform_invites")
    .update({ status: "pending", expires_at: platformInviteExpiresAt() })
    .eq("id", input.inviteId)
    .in("status", ["pending", "expired"])
    .select("id, email")
    .maybeSingle();
  if (error) throw new AppError("Could not resend the invite.", "DB_ERROR", 500, { dbError: error.message });
  if (!data) throw new ValidationError("That invite can no longer be resent.");
  return { emailed: await trySendInviteEmail(data.email) };
}

export async function revokePlatformInvite(input: {
  actor: { id: string; email?: string | null };
  inviteId: string;
}): Promise<void> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_platform_invites")
    .update({ status: "revoked" })
    .eq("id", input.inviteId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new AppError("Could not revoke the invite.", "DB_ERROR", 500, { dbError: error.message });
  if (!data) throw new ValidationError("That invite is no longer pending.");
}

/** Tenant feature flag check. Missing column/flag = enabled (flags only ever turn things off). */
export async function tenantFeatureEnabled(workspaceId: string, key: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_workspaces").select("feature_flags").eq("id", workspaceId).maybeSingle();
  if (error || !data) return true;
  const flags = (data.feature_flags && typeof data.feature_flags === "object" ? data.feature_flags : {}) as Record<string, unknown>;
  return flags[key] !== false;
}

export type TenantAction = "suspend" | "reactivate" | "delete" | "restore";

export async function actOnTenant(input: {
  actor: { id: string; email?: string | null };
  workspaceId: string;
  action: TenantAction;
}): Promise<void> {
  await requireSuperAdmin(input.actor);
  const now = new Date().toISOString();
  const patch =
    input.action === "suspend"
      ? { status: "suspended", suspended_at: now, deleted_at: null }
      : input.action === "delete"
        ? { status: "deleted", deleted_at: now }
        : { status: "active", suspended_at: null, deleted_at: null };
  const from =
    input.action === "suspend" ? ["active"] : input.action === "delete" ? ["active", "suspended"] : input.action === "restore" ? ["deleted"] : ["suspended"];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspaces")
    .update(patch)
    .eq("id", input.workspaceId)
    .in("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError("Could not update that tenant.", "DB_ERROR", 500, { dbError: error.message });
  if (!data) throw new ValidationError("That tenant is not in a state that allows this change.");
  const auditActions: Record<TenantAction, import("@/lib/types").AuditAction> = {
    suspend: "platform.tenant_suspend",
    reactivate: "platform.tenant_reactivate",
    delete: "platform.tenant_delete",
    restore: "platform.tenant_restore",
  };
  const auditAction = auditActions[input.action];
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.actor.id,
    action: auditAction,
    entityType: "grm_workspaces",
    entityId: input.workspaceId,
    metadata: {} as Record<string, unknown>,
  }).catch(() => undefined);
}

/**
 * Tenants and invites are paginated in the database (count + range), and the
 * search runs server-side too — the admin board used to receive up to 500
 * tenants and filter/render them in the browser. Per-tenant counts are exact
 * head-counts for the current page only, never full row downloads.
 */
export async function loadPlatformOverview(
  actor: { id: string; email?: string | null },
  options: { query?: string; page?: number; invitePage?: number } = {}
): Promise<PlatformOverview> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const q = (options.query ?? "").trim();
  const page = Math.max(1, options.page ?? 1);
  const invitePage = Math.max(1, options.invitePage ?? 1);
  const NIL = "00000000-0000-0000-0000-000000000000";

  // Owner-email search: resolve matching accepted invites to workspace ids.
  let ownerWorkspaceIds: string[] = [];
  if (q) {
    const { data } = await admin
      .from("grm_platform_invites")
      .select("workspace_id")
      .eq("status", "accepted")
      .ilike("email", `%${q}%`)
      .not("workspace_id", "is", null)
      .limit(100);
    ownerWorkspaceIds = [...new Set(((data ?? []) as Array<{ workspace_id: string | null }>).flatMap((r) => (r.workspace_id ? [r.workspace_id] : [])))];
  }

  let tenantQuery = admin
    .from("grm_workspaces")
    .select("id, name, slug, status, created_at, suspended_at, deleted_at, plan, plan_expires_at, ai_monthly_budget_usd", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * TENANT_PAGE_SIZE, page * TENANT_PAGE_SIZE - 1);
  if (q) {
    const like = `%${q.replace(/[%_(),]/g, "")}%`;
    const clauses = [`name.ilike.${like}`, `slug.ilike.${like}`];
    if (ownerWorkspaceIds.length > 0) clauses.push(`id.in.(${ownerWorkspaceIds.join(",")})`);
    tenantQuery = tenantQuery.or(clauses.join(","));
  }

  const headCount = (build: (query: ReturnType<typeof baseCount>) => PromiseLike<{ count: number | null }>) => build(baseCount());
  const baseCount = () => admin.from("grm_workspaces").select("id", { count: "exact", head: true });

  const [inviteResult, tenantResult, tenantTotal, activeTotal, suspendedTotal, deletedTotal, pendingTotal, memberTotal, reviewTotal] = await Promise.all([
    admin
      .from("grm_platform_invites")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((invitePage - 1) * INVITE_PAGE_SIZE, invitePage * INVITE_PAGE_SIZE - 1),
    tenantQuery,
    headCount((query) => query),
    headCount((query) => query.eq("status", "active")),
    headCount((query) => query.eq("status", "suspended")),
    headCount((query) => query.eq("status", "deleted")),
    admin.from("grm_platform_invites").select("id", { count: "exact", head: true }).eq("status", "pending").gt("expires_at", new Date().toISOString()),
    admin.from("grm_workspace_members").select("id", { count: "exact", head: true }),
    admin.from("grm_reviews").select("id", { count: "exact", head: true }),
  ]);
  if (inviteResult.error) throw new AppError("Platform invites are not available until the invite-only migration is applied.", "DB_ERROR", 500, { dbError: inviteResult.error.message });
  if (tenantResult.error) throw new AppError("Could not load tenants.", "DB_ERROR", 500, { dbError: tenantResult.error.message });

  const invites = ((inviteResult.data ?? []) as Array<Record<string, unknown>>).map(inviteRow);
  // Lazily expire stale pending invites in the view.
  const now = Date.now();
  for (const invite of invites) {
    if (invite.status === "pending" && isPlatformInviteExpired(invite.expiresAt, now)) invite.status = "expired";
  }

  const workspaces = (tenantResult.data ?? []) as Array<{ id: string; name: string; slug: string; status: string; created_at: string; suspended_at: string | null; deleted_at: string | null; plan: string; plan_expires_at: string | null; ai_monthly_budget_usd: number | null }>;
  const ids = workspaces.map((w) => w.id);
  const month = new Date().toISOString().slice(0, 7);

  const countFor = async (table: "grm_workspace_members" | "grm_clients" | "grm_google_locations" | "grm_reviews", workspaceId: string): Promise<number> => {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    return count ?? 0;
  };
  const [countMaps, owners, usageRows, acceptedInvites] = await Promise.all([
    (async () => {
      const maps = { members: new Map<string, number>(), clients: new Map<string, number>(), locations: new Map<string, number>(), reviews: new Map<string, number>() };
      await Promise.all(
        ids.flatMap((id) => [
          countFor("grm_workspace_members", id).then((n) => maps.members.set(id, n)),
          countFor("grm_clients", id).then((n) => maps.clients.set(id, n)),
          countFor("grm_google_locations", id).then((n) => maps.locations.set(id, n)),
          countFor("grm_reviews", id).then((n) => maps.reviews.set(id, n)),
        ])
      );
      return maps;
    })(),
    admin.from("grm_workspace_members").select("workspace_id, user_id").eq("role", "owner").in("workspace_id", ids.length ? ids : [NIL]),
    ids.length ? admin.from("grm_ai_usage_monthly").select("workspace_id, estimated_usd").eq("month", month).in("workspace_id", ids) : Promise.resolve({ data: [] as Array<{ workspace_id: string; estimated_usd: number }>, error: null }),
    ids.length ? admin.from("grm_platform_invites").select("workspace_id, email").eq("status", "accepted").in("workspace_id", ids) : Promise.resolve({ data: [] as Array<{ workspace_id: string | null; email: string }>, error: null }),
  ]);
  const aiSpent = new Map<string, number>();
  if (!usageRows.error) for (const row of (usageRows.data ?? []) as Array<{ workspace_id: string; estimated_usd: number }>) aiSpent.set(row.workspace_id, (aiSpent.get(row.workspace_id) ?? 0) + Number(row.estimated_usd ?? 0));
  const ownerEmail = new Map<string, string>();
  const ownerRows = owners.error ? [] : ((owners.data ?? []) as Array<{ workspace_id: string; user_id: string }>);
  if (ownerRows.length > 0) {
    const { loadAuthProfiles } = await import("@/lib/services/auth-profiles");
    const profiles = await loadAuthProfiles(ownerRows.map((r) => r.user_id));
    for (const row of ownerRows) ownerEmail.set(row.workspace_id, profiles.get(row.user_id)?.email ?? "Unknown");
  }
  // Accepted platform invite email is the most reliable owner label when profiles lag.
  if (!acceptedInvites.error) {
    for (const invite of (acceptedInvites.data ?? []) as Array<{ workspace_id: string | null; email: string }>) {
      if (invite.workspace_id) ownerEmail.set(invite.workspace_id, invite.email);
    }
  }

  const tenants: TenantRow[] = workspaces.map((w) => ({
    id: w.id, name: w.name, slug: w.slug, status: w.status ?? "active", createdAt: w.created_at,
    suspendedAt: w.suspended_at, deletedAt: w.deleted_at, ownerEmail: ownerEmail.get(w.id) ?? null,
    members: countMaps.members.get(w.id) ?? 0, clients: countMaps.clients.get(w.id) ?? 0, locations: countMaps.locations.get(w.id) ?? 0, reviews: countMaps.reviews.get(w.id) ?? 0,
    plan: w.plan ?? "trial", planExpiresAt: w.plan_expires_at ?? null,
    aiBudgetUsd: w.ai_monthly_budget_usd == null ? null : Number(w.ai_monthly_budget_usd),
    aiSpentUsd: aiSpent.get(w.id) ?? 0,
  }));
  return {
    invites,
    inviteTotal: inviteResult.count ?? invites.length,
    invitePage,
    invitePageSize: INVITE_PAGE_SIZE,
    tenants,
    tenantTotal: tenantResult.count ?? tenants.length,
    page,
    pageSize: TENANT_PAGE_SIZE,
    stats: {
      tenants: tenantTotal.count ?? 0,
      active: activeTotal.count ?? 0,
      suspended: suspendedTotal.count ?? 0,
      deleted: deletedTotal.count ?? 0,
      pendingInvites: pendingTotal.count ?? 0,
      members: memberTotal.count ?? 0,
      reviews: reviewTotal.count ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant 360, health, usage, users, settings — super-admin suite
// ---------------------------------------------------------------------------

export interface TenantDetail {
  tenant: {
    id: string; name: string; slug: string; status: string; createdAt: string;
    plan: string; planExpiresAt: string | null; aiBudgetUsd: number | null;
    maxLocations: number | null; maxMembers: number | null; adminNote: string | null;
    featureFlags: Record<string, boolean>;
  };
  ownerEmail: string | null;
  members: Array<{ userId: string; email: string; role: string; joinedAt: string; accessEnabled: boolean }>;
  pendingTeamInvites: Array<{ id: string; email: string; role: string; expiresAt: string | null }>;
  connections: Array<{ id: string; googleEmail: string; status: string; lastRefreshedAt: string | null }>;
  locations: Array<{ id: string; name: string; isActive: boolean; syncStatus: string | null; lastSyncedAt: string | null; syncError: string | null }>;
  counts: { clients: number; locations: number; reviews: number; escalationsOpen: number };
  onboarding: { started: boolean; completed: boolean; connections: number; locations: number } | null;
  aiUsage: Array<{ month: string; operation: string; calls: number; estimatedUsd: number }>;
  audit: Array<{ id: string; action: string; userId: string; createdAt: string; entityType: string }>;
  platformInvite: PlatformInviteRow | null;
}

export async function getTenantDetail(actor: { id: string; email?: string | null }, workspaceId: string): Promise<TenantDetail> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const { data: ws, error } = await admin.from("grm_workspaces")
    .select("id, name, slug, status, created_at, plan, plan_expires_at, ai_monthly_budget_usd, max_locations, max_members, admin_note, feature_flags")
    .eq("id", workspaceId).maybeSingle();
  if (error) throw new AppError("Could not load that tenant.", "DB_ERROR", 500, { dbError: error.message });
  if (!ws) throw new ValidationError("That tenant no longer exists.");

  const [memberRows, teamInvites, connections, locations, clientsCount, reviewsCount, escCount, usage, auditRows, inviteRows, onboardingGate] = await Promise.all([
    admin.from("grm_workspace_members").select("user_id, role, joined_at, access_enabled").eq("workspace_id", workspaceId).order("joined_at"),
    admin.from("grm_workspace_invites").select("id, email, role, expires_at").eq("workspace_id", workspaceId).eq("status", "pending"),
    admin.from("grm_google_connections").select("id, google_email, status, last_refreshed_at").eq("workspace_id", workspaceId),
    admin.from("grm_google_locations").select("id, location_title, is_active, sync_status, last_synced_at, sync_error").eq("workspace_id", workspaceId).order("last_synced_at", { ascending: false }).limit(50),
    admin.from("grm_clients").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("grm_reviews").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("grm_escalations").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("grm_ai_usage_monthly").select("month, operation, calls, estimated_usd").eq("workspace_id", workspaceId).order("month", { ascending: false }).limit(24),
    admin.from("grm_audit_logs").select("id, action, user_id, created_at, entity_type").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30),
    admin.from("grm_platform_invites").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1),
    import("@/lib/services/onboarding").then((m) => m.getOnboardingGate(workspaceId)).catch(() => null),
  ]);
  const { loadAuthProfiles } = await import("@/lib/services/auth-profiles");
  const memberData = (memberRows.data ?? []) as Array<{ user_id: string; role: string; joined_at: string; access_enabled: boolean }>;
  const profiles = await loadAuthProfiles(memberData.map((m) => m.user_id));
  const owner = memberData.find((m) => m.role === "owner");
  const flags = (ws.feature_flags && typeof ws.feature_flags === "object" ? ws.feature_flags : {}) as Record<string, unknown>;
  return {
    tenant: {
      id: ws.id, name: ws.name, slug: ws.slug, status: ws.status, createdAt: ws.created_at,
      plan: ws.plan ?? "trial", planExpiresAt: ws.plan_expires_at, aiBudgetUsd: ws.ai_monthly_budget_usd == null ? null : Number(ws.ai_monthly_budget_usd),
      maxLocations: ws.max_locations, maxMembers: ws.max_members, adminNote: ws.admin_note,
      featureFlags: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v === true])),
    },
    ownerEmail: owner ? profiles.get(owner.user_id)?.email ?? null : null,
    members: memberData.map((m) => ({ userId: m.user_id, email: profiles.get(m.user_id)?.email ?? "Unknown", role: m.role, joinedAt: m.joined_at, accessEnabled: m.access_enabled !== false })),
    pendingTeamInvites: ((teamInvites.data ?? []) as Array<{ id: string; email: string; role: string; expires_at: string | null }>).map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at })),
    connections: ((connections.data ?? []) as Array<{ id: string; google_email: string; status: string; last_refreshed_at: string | null }>).map((c) => ({ id: c.id, googleEmail: c.google_email, status: c.status, lastRefreshedAt: c.last_refreshed_at })),
    locations: ((locations.data ?? []) as Array<{ id: string; location_title: string; is_active: boolean; sync_status: string | null; last_synced_at: string | null; sync_error: string | null }>).map((l) => ({ id: l.id, name: l.location_title, isActive: l.is_active, syncStatus: l.sync_status, lastSyncedAt: l.last_synced_at, syncError: l.sync_error })),
    counts: { clients: clientsCount.count ?? 0, locations: (locations.data ?? []).length, reviews: reviewsCount.count ?? 0, escalationsOpen: escCount.error ? 0 : escCount.count ?? 0 },
    onboarding: onboardingGate,
    aiUsage: ((usage.data ?? []) as Array<{ month: string; operation: string; calls: number; estimated_usd: number }>).map((u) => ({ month: u.month, operation: u.operation, calls: u.calls, estimatedUsd: Number(u.estimated_usd ?? 0) })),
    audit: ((auditRows.data ?? []) as Array<{ id: string; action: string; user_id: string; created_at: string; entity_type: string }>).map((a) => ({ id: a.id, action: a.action, userId: a.user_id, createdAt: a.created_at, entityType: a.entity_type })),
    platformInvite: inviteRows.data?.[0] ? inviteRow(inviteRows.data[0] as unknown as Record<string, unknown>) : null,
  };
}

export async function updateTenantSettings(input: {
  actor: { id: string; email?: string | null };
  workspaceId: string;
  plan?: string; planExpiresAt?: string | null; aiBudgetUsd?: number | null;
  maxLocations?: number | null; maxMembers?: number | null; adminNote?: string | null;
  featureFlags?: Record<string, boolean>;
}): Promise<void> {
  await requireSuperAdmin(input.actor);
  const patch: Database["public"]["Tables"]["grm_workspaces"]["Update"] = {};
  if (input.plan !== undefined) {
    if (!["trial", "starter", "growth", "enterprise", "lifetime"].includes(input.plan)) throw new ValidationError("Unknown plan.");
    patch.plan = input.plan;
  }
  if (input.planExpiresAt !== undefined) patch.plan_expires_at = input.planExpiresAt;
  if (input.aiBudgetUsd !== undefined) patch.ai_monthly_budget_usd = input.aiBudgetUsd;
  if (input.maxLocations !== undefined) patch.max_locations = input.maxLocations;
  if (input.maxMembers !== undefined) patch.max_members = input.maxMembers;
  if (input.adminNote !== undefined) patch.admin_note = input.adminNote?.slice(0, 2000) ?? null;
  if (input.featureFlags !== undefined) patch.feature_flags = input.featureFlags;
  if (Object.keys(patch).length === 0) throw new ValidationError("Nothing to update.");
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_workspaces").update(patch).eq("id", input.workspaceId).select("id").maybeSingle();
  if (error) throw new AppError("Could not update that tenant.", "DB_ERROR", 500, { dbError: error.message });
  if (!data) throw new ValidationError("That tenant no longer exists.");
}

export interface PlatformHealth {
  connections: { active: number; expired: number; revoked: number; problemTenants: Array<{ workspaceId: string; tenantName: string; status: string; googleEmail: string }> };
  sync: { failedLocations: number; staleLocations: number; problems: Array<{ workspaceId: string; locationName: string; syncStatus: string | null; lastSyncedAt: string | null; syncError: string | null }> };
  invites: { pending: number; expiredPending: number };
  readiness: { platformInvitesTable: boolean; reviewIntelligence: boolean; aiUsageLedger: boolean; cronSecretConfigured: boolean; resendConfigured: boolean; superAdminsConfigured: number };
  tenantsByStatus: { active: number; suspended: number; deleted: number };
  plansExpiringSoon: Array<{ id: string; name: string; plan: string; planExpiresAt: string }>;
}

export async function loadPlatformHealth(actor: { id: string; email?: string | null }): Promise<PlatformHealth> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [connRows, locRows, inviteRows, wsRows, intelProbe, usageProbe] = await Promise.all([
    admin.from("grm_google_connections").select("workspace_id, google_email, status").limit(2000),
    admin.from("grm_google_locations").select("workspace_id, location_title, sync_status, last_synced_at, sync_error, is_active").eq("is_active", true).limit(2000),
    admin.from("grm_platform_invites").select("status, expires_at").eq("status", "pending").limit(500),
    admin.from("grm_workspaces").select("id, name, status, plan, plan_expires_at").limit(500),
    admin.from("grm_review_intelligence").select("id").limit(1).then((r) => !r.error, () => false),
    admin.from("grm_ai_usage_monthly").select("workspace_id").limit(1).then((r) => !r.error, () => false),
  ]);
  const tenantName = new Map(((wsRows.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));
  const conns = (connRows.data ?? []) as Array<{ workspace_id: string; google_email: string; status: string }>;
  const locs = (locRows.data ?? []) as Array<{ workspace_id: string; location_title: string; sync_status: string | null; last_synced_at: string | null; sync_error: string | null }>;
  const failed = locs.filter((l) => l.sync_status === "failed" || l.sync_status === "partial");
  const stale = locs.filter((l) => !l.last_synced_at || l.last_synced_at < staleBefore);
  const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return {
    connections: {
      active: conns.filter((c) => c.status === "active").length,
      expired: conns.filter((c) => c.status === "expired").length,
      revoked: conns.filter((c) => c.status === "revoked").length,
      problemTenants: conns.filter((c) => c.status !== "active").slice(0, 20).map((c) => ({ workspaceId: c.workspace_id, tenantName: tenantName.get(c.workspace_id) ?? "Tenant", status: c.status, googleEmail: c.google_email })),
    },
    sync: {
      failedLocations: failed.length,
      staleLocations: stale.length,
      problems: [...failed, ...stale.filter((s) => !failed.includes(s))].slice(0, 20).map((l) => ({ workspaceId: l.workspace_id, locationName: `${tenantName.get(l.workspace_id) ?? "Tenant"} · ${l.location_title}`, syncStatus: l.sync_status, lastSyncedAt: l.last_synced_at, syncError: l.sync_error })),
    },
    invites: {
      pending: (inviteRows.data ?? []).length,
      expiredPending: ((inviteRows.data ?? []) as Array<{ expires_at: string }>).filter((i) => isPlatformInviteExpired(i.expires_at)).length,
    },
    readiness: {
      platformInvitesTable: !inviteRows.error,
      reviewIntelligence: Boolean(intelProbe),
      aiUsageLedger: Boolean(usageProbe),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      resendConfigured: Boolean(process.env.RESEND_API_KEY && (process.env.REPORT_FROM_EMAIL || process.env.PLATFORM_FROM_EMAIL)),
      superAdminsConfigured: (process.env.SUPER_ADMIN_EMAILS ?? "").split(",").filter((p) => p.includes("@")).length,
    },
    tenantsByStatus: {
      active: ((wsRows.data ?? []) as Array<{ status: string }>).filter((w) => w.status === "active").length,
      suspended: ((wsRows.data ?? []) as Array<{ status: string }>).filter((w) => w.status === "suspended").length,
      deleted: ((wsRows.data ?? []) as Array<{ status: string }>).filter((w) => w.status === "deleted").length,
    },
    plansExpiringSoon: ((wsRows.data ?? []) as Array<{ id: string; name: string; plan: string; plan_expires_at: string | null; status: string }>)
      .filter((w) => w.status === "active" && w.plan_expires_at && w.plan_expires_at > new Date().toISOString() && w.plan_expires_at <= soon)
      .map((w) => ({ id: w.id, name: w.name, plan: w.plan, planExpiresAt: w.plan_expires_at! })),
  };
}

export interface GlobalUserRow {
  userId: string; email: string; lastSignInAt: string | null; blocked: boolean;
  memberships: Array<{ workspaceId: string; tenantName: string; role: string; tenantStatus: string }>;
}
export interface BlockedUserRow { email: string; reason: string | null; createdAt: string }

export const USER_PAGE_SIZE = 25;

/**
 * Global users, paginated by the auth API itself (`page`/`perPage` + total).
 * Search stays server-side: with a needle we page through the filtered auth
 * list using GoTrue's `filter` parameter instead of downloading 200 users
 * and filtering in the browser.
 */
export async function listGlobalUsers(
  actor: { id: string; email?: string | null },
  query = "",
  page = 1
): Promise<{ users: GlobalUserRow[]; blocked: BlockedUserRow[]; total: number; page: number; pageSize: number }> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const needle = query.trim().toLowerCase();
  const currentPage = Math.max(1, page);

  let authUsers: Array<{ id: string; email: string; lastSignInAt: string | null }> = [];
  let total = 0;
  if (!needle) {
    const { data, error } = await admin.auth.admin.listUsers({ page: currentPage, perPage: USER_PAGE_SIZE });
    if (error) throw new AppError("Could not list users.", "DB_ERROR", 500, { dbError: error.message });
    total = data.total ?? (data.users ?? []).length;
    authUsers = (data.users ?? []).map((u) => ({ id: u.id, email: u.email ?? "Unknown", lastSignInAt: (u as { last_sign_in_at?: string | null }).last_sign_in_at ?? null }));
  } else {
    // GoTrue's admin list supports a `filter` term (email/name search) but
    // supabase-js does not expose it, so page the REST endpoint directly.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new AppError("Could not list users.", "DB_ERROR", 500);
    const response = await fetch(
      `${url}/auth/v1/admin/users?filter=${encodeURIComponent(needle)}&page=${currentPage}&per_page=${USER_PAGE_SIZE}`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key }, cache: "no-store" }
    );
    if (!response.ok) throw new AppError("Could not list users.", "DB_ERROR", 500);
    total = Number(response.headers.get("x-total-count") ?? 0) || 0;
    const body = (await response.json()) as { users?: Array<{ id: string; email?: string | null; last_sign_in_at?: string | null }> };
    authUsers = (body.users ?? [])
      .map((u) => ({ id: u.id, email: u.email ?? "Unknown", lastSignInAt: u.last_sign_in_at ?? null }))
      .filter((u) => u.email.toLowerCase().includes(needle));
  }

  const ids = authUsers.map((u) => u.id);
  const [memberRows, blockedRows] = await Promise.all([
    ids.length ? admin.from("grm_workspace_members").select("user_id, workspace_id, role").in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string; workspace_id: string; role: string }>, error: null }),
    admin.from("grm_platform_blocked_users").select("email, reason, created_at").order("created_at", { ascending: false }),
  ]);
  const workspaceIds = [...new Set(((memberRows.data ?? []) as Array<{ workspace_id: string }>).map((r) => r.workspace_id))];
  const wsRows = workspaceIds.length
    ? await admin.from("grm_workspaces").select("id, name, status").in("id", workspaceIds)
    : { data: [] as Array<{ id: string; name: string; status: string }> };
  const tenantById = new Map(((wsRows.data ?? []) as Array<{ id: string; name: string; status: string }>).map((w) => [w.id, w]));
  const blockedEmails = new Set(((blockedRows.data ?? []) as Array<{ email: string }>).map((b) => b.email));
  const byUser = new Map<string, GlobalUserRow["memberships"]>();
  for (const row of (memberRows.data ?? []) as Array<{ user_id: string; workspace_id: string; role: string }>) {
    const tenant = tenantById.get(row.workspace_id);
    const list = byUser.get(row.user_id) ?? [];
    list.push({ workspaceId: row.workspace_id, tenantName: tenant?.name ?? "Tenant", role: row.role, tenantStatus: tenant?.status ?? "active" });
    byUser.set(row.user_id, list);
  }
  const users = authUsers.map((u) => ({ userId: u.id, email: u.email, lastSignInAt: u.lastSignInAt, blocked: blockedEmails.has(u.email.toLowerCase()), memberships: byUser.get(u.id) ?? [] }));
  return {
    users,
    blocked: ((blockedRows.data ?? []) as Array<{ email: string; reason: string | null; created_at: string }>).map((b) => ({ email: b.email, reason: b.reason, createdAt: b.created_at })),
    total,
    page: currentPage,
    pageSize: USER_PAGE_SIZE,
  };
}

export async function setUserBlocked(input: { actor: { id: string; email?: string | null }; email: string; blocked: boolean; reason?: string | null }): Promise<void> {
  await requireSuperAdmin(input.actor);
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new ValidationError("Enter a valid email address.");
  if (isSuperAdminEmail(email)) throw new ValidationError("Super admins cannot be blocked.");
  const admin = createAdminClient();
  if (input.blocked) {
    const { error } = await admin.from("grm_platform_blocked_users").upsert({ email, blocked_by: input.actor.id, reason: input.reason?.trim().slice(0, 500) || null }, { onConflict: "email" });
    if (error) throw new AppError("Could not block that user.", "DB_ERROR", 500, { dbError: error.message });
  } else {
    const { error } = await admin.from("grm_platform_blocked_users").delete().eq("email", email);
    if (error) throw new AppError("Could not unblock that user.", "DB_ERROR", 500, { dbError: error.message });
  }
}

export interface PlatformAnnouncementRow { id: string; title: string; body: string; tone: string; active: boolean; createdAt: string }

export async function listAnnouncements(actor: { id: string; email?: string | null }): Promise<PlatformAnnouncementRow[]> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_platform_announcements").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new AppError("Could not load announcements.", "DB_ERROR", 500, { dbError: error.message });
  }
  return ((data ?? []) as Array<{ id: string; title: string; body: string; tone: string; active: boolean; created_at: string }>).map((a) => ({ id: a.id, title: a.title, body: a.body, tone: a.tone, active: a.active, createdAt: a.created_at }));
}

export async function createAnnouncement(input: { actor: { id: string; email?: string | null }; title: string; body: string; tone: string }): Promise<void> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { error } = await admin.from("grm_platform_announcements").insert({ title: input.title.trim().slice(0, 200), body: input.body.trim().slice(0, 2000), tone: input.tone === "warning" ? "warning" : "info", created_by: input.actor.id });
  if (error) throw new AppError("Could not publish the announcement.", "DB_ERROR", 500, { dbError: error.message });
}

export async function setAnnouncementActive(input: { actor: { id: string; email?: string | null }; id: string; active: boolean }): Promise<void> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { error } = await admin.from("grm_platform_announcements").update({ active: input.active }).eq("id", input.id);
  if (error) throw new AppError("Could not update the announcement.", "DB_ERROR", 500, { dbError: error.message });
}

export async function getMaintenance(): Promise<{ enabled: boolean; message: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_platform_settings").select("value").eq("key", "maintenance").maybeSingle();
  if (error || !data) return { enabled: false, message: null };
  const value = (data.value ?? {}) as { enabled?: unknown; message?: unknown };
  return { enabled: value.enabled === true, message: typeof value.message === "string" ? value.message : null };
}

export async function setMaintenance(input: { actor: { id: string; email?: string | null }; enabled: boolean; message?: string | null }): Promise<void> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { error } = await admin.from("grm_platform_settings").upsert({ key: "maintenance", value: { enabled: input.enabled, message: input.message?.trim().slice(0, 500) || null }, updated_by: input.actor.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new AppError("Could not update maintenance mode.", "DB_ERROR", 500, { dbError: error.message });
}

export async function getActiveAnnouncement(): Promise<PlatformAnnouncementRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_platform_announcements").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, title: data.title, body: data.body, tone: data.tone, active: data.active, createdAt: data.created_at };
}

export interface AccessRequestRow { id: string; email: string; company: string | null; message: string | null; status: string; createdAt: string }

export async function submitAccessRequest(input: { user: { id: string; email?: string | null }; company?: string | null; message?: string | null }): Promise<void> {
  const email = normalizeEmail(input.user.email);
  if (!email) throw new ValidationError("Your account has no email address.");
  const admin = createAdminClient();
  const { error } = await admin.from("grm_access_requests").insert({ email, user_id: input.user.id, company: input.company?.trim().slice(0, 255) || null, message: input.message?.trim().slice(0, 1000) || null });
  if (error) {
    if (error.code === "23505") throw new ValidationError("You already have a pending request. We'll review it soon.");
    throw new AppError("Could not submit your request.", "DB_ERROR", 500, { dbError: error.message });
  }
}

export async function listAccessRequests(actor: { id: string; email?: string | null }): Promise<AccessRequestRow[]> {
  await requireSuperAdmin(actor);
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_access_requests").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new AppError("Could not load access requests.", "DB_ERROR", 500, { dbError: error.message });
  }
  return ((data ?? []) as Array<{ id: string; email: string; company: string | null; message: string | null; status: string; created_at: string }>).map((r) => ({ id: r.id, email: r.email, company: r.company, message: r.message, status: r.status, createdAt: r.created_at }));
}

export async function decideAccessRequest(input: { actor: { id: string; email?: string | null }; requestId: string; approve: boolean }): Promise<{ emailed: boolean }> {
  await requireSuperAdmin(input.actor);
  const admin = createAdminClient();
  const { data: request, error } = await admin.from("grm_access_requests").select("id, email, status").eq("id", input.requestId).maybeSingle();
  if (error) throw new AppError("Could not load that request.", "DB_ERROR", 500, { dbError: error.message });
  if (!request || request.status !== "pending") throw new ValidationError("That request has already been decided.");
  let emailed = false;
  if (input.approve) {
    const result = await createPlatformInvite({ inviter: input.actor, email: request.email });
    emailed = result.emailed;
  }
  const { error: updateError } = await admin.from("grm_access_requests").update({ status: input.approve ? "approved" : "denied", decided_by: input.actor.id, decided_at: new Date().toISOString() }).eq("id", input.requestId).eq("status", "pending");
  if (updateError) throw new AppError("Could not save that decision.", "DB_ERROR", 500, { dbError: updateError.message });
  return { emailed };
}

export async function bulkCreatePlatformInvites(input: {
  inviter: { id: string; email?: string | null };
  emails: string[];
}): Promise<Array<{ email: string; ok: boolean; detail: string; emailed: boolean }>> {
  await requireSuperAdmin(input.inviter);
  const unique = [...new Set(input.emails.map((e) => normalizeEmail(e)).filter((e) => e.includes("@")))].slice(0, 100);
  const results: Array<{ email: string; ok: boolean; detail: string; emailed: boolean }> = [];
  for (const email of unique) {
    try {
      const result = await createPlatformInvite({ inviter: input.inviter, email });
      results.push({ email, ok: true, detail: "Invited", emailed: result.emailed });
    } catch (error) {
      results.push({ email, ok: false, detail: error instanceof Error ? error.message : "Failed", emailed: false });
    }
  }
  return results;
}
