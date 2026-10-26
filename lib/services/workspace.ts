import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteExpiresAt, isInviteExpired } from "@/lib/onboarding";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { forget, forgetUserNavigation, peek, put } from "@/lib/ttl-cache";
import { AuditService } from "@/lib/services/audit";
import { logger } from "@/lib/logger";
import type { GrmMemberRole } from "@/lib/types";
import { allows, canAssignRole, roleScopeError, type ScopeIds } from "@/lib/access";
import { canManageMember } from "@/lib/roles";
import { assertScopeAssignment, getMemberAccess } from "@/lib/services/access";
import { loadAuthProfiles } from "@/lib/services/auth-profiles";
import {
  isPlatformInviteExpired,
  normalizeEmail,
  tenantGate,
  type TenantGateKind,
} from "@/lib/platform-admin";

export const TENANT_SETUP_REQUIRED = "TENANT_SETUP_REQUIRED";
export const PLATFORM_NOT_INVITED = "PLATFORM_NOT_INVITED";
export const WORKSPACE_SUSPENDED = "WORKSPACE_SUSPENDED";
export const WORKSPACE_DELETED = "WORKSPACE_DELETED";

const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export interface PersonalWorkspace {
  workspace_id: string;
}

interface MembershipRow {
  workspace_id: string;
  joined_at: string;
  active: boolean;
}

export interface WorkspaceRosterMember {
  userId: string;
  email: string;
  role: GrmMemberRole;
  joinedAt: string;
  accessEnabled: boolean;
  scopeLabel: string;
  scope: ScopeIds;
  alertEmail: boolean;
  alertInApp: boolean;
  twoStep: "on" | "off" | "unavailable";
  lastActive: string | null;
}

export interface WorkspaceRosterInvite {
  id: string;
  email: string;
  role: GrmMemberRole;
  createdAt: string;
  expiresAt: string | null;
  scope: ScopeIds;
  scopeLabel: string;
}

export interface AccessibleWorkspace {
  id: string;
  name: string;
}

/**
 * Stable slug for a user's personal workspace.
 * The suffix is derived from the user id, so two people never share a slug
 * and a double-click cannot create two workspaces.
 */
export function personalWorkspaceSlug(
  email: string | null | undefined,
  userId: string
): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32) || "user";
  const head = (base || "workspace").slice(0, Math.max(1, 63 - suffix.length - 1));
  const slug = `${head}-${suffix}`.replace(/^-+|-+$/g, "");
  if (WORKSPACE_SLUG.test(slug)) return slug;
  const fallback = `workspace-${suffix}`.slice(0, 63).replace(/-+$/g, "");
  return WORKSPACE_SLUG.test(fallback) ? fallback : "my-workspace";
}

export function personalWorkspaceName(email: string | null | undefined): string {
  const trimmed = email?.trim();
  if (trimmed) return trimmed.slice(0, 255);
  return "My workspace";
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function pickActiveWorkspace<T extends { workspace_id: string; active: boolean }>(
  rows: T[]
): T | null {
  if (rows.length === 0) return null;
  return rows.find((row) => row.active) ?? rows[0];
}

function isSchemaNotReady(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

/**
 * Request-memoised: the layout, gate and page all ask for memberships in one
 * render. React `cache` is per-request only, so this never serves stale data
 * across navigations — it just removes duplicate round-trips within a request.
 */
const listMemberships = cache(async (userId: string): Promise<MembershipRow[]> => {
  const admin = createAdminClient();
  const withActive = await admin
    .from("grm_workspace_members")
    .select("workspace_id, joined_at, active")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });

  if (!withActive.error) {
    return withActive.data ?? [];
  }

  if (!isSchemaNotReady(withActive.error)) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: withActive.error.message,
    });
  }

  const plain = await admin
    .from("grm_workspace_members")
    .select("workspace_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });

  if (plain.error) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: plain.error.message,
    });
  }

  return (plain.data ?? []).map((row) => ({ ...row, active: false }));
});

async function acceptPendingInvites(user: {
  id: string;
  email?: string | null;
}): Promise<string[]> {
  const email = user.email ? normalizeInviteEmail(user.email) : "";
  if (!email) return [];

  const admin = createAdminClient();
  const { data: invites, error } = await admin
    .from("grm_workspace_invites")
    .select("id, workspace_id, role, invited_by, expires_at, scope_client_id, scope_group_id, scope_location_id")
    .eq("email", email)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    if (isSchemaNotReady(error)) return [];
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }

  if (!invites?.length) return [];

  const accepted: string[] = [];

  for (const invite of invites) {
    if (isInviteExpired(invite.expires_at)) {
      await admin
        .from("grm_workspace_invites")
        .update({ status: "expired" })
        .eq("id", invite.id)
        .eq("status", "pending");
      continue;
    }

    const { error: memberError } = await admin.from("grm_workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
      active: false,
      access_enabled: true,
      scope_client_id: invite.scope_client_id,
      scope_group_id: invite.scope_group_id,
      scope_location_id: invite.scope_location_id,
      alert_in_app: true,
    });

    if (memberError && memberError.code !== "23505" && !isSchemaNotReady(memberError)) {
      throw new AppError("Could not join the workspace you were invited to.", "DB_ERROR", 500, {
        dbError: memberError.message,
      });
    }

    if (memberError && isSchemaNotReady(memberError)) {
      const retry = await admin.from("grm_workspace_members").insert({
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: invite.role,
        invited_by: invite.invited_by,
      });
      if (retry.error && retry.error.code !== "23505") {
        throw new AppError("Could not join the workspace you were invited to.", "DB_ERROR", 500, {
          dbError: retry.error.message,
        });
      }
    }

    const { error: inviteError } = await admin
      .from("grm_workspace_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (inviteError && !isSchemaNotReady(inviteError)) {
      throw new AppError("Could not join the workspace you were invited to.", "DB_ERROR", 500, {
        dbError: inviteError.message,
      });
    }

    await AuditService.log({
      workspaceId: invite.workspace_id,
      userId: user.id,
      action: "workspace.invite_accepted",
      entityType: "grm_workspace_invites",
      entityId: invite.id,
      metadata: { email } as Record<string, unknown>,
    });

    accepted.push(invite.workspace_id);
  }

  return accepted;
}

async function findWorkspaceIdBySlug(slug: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error && !isSchemaNotReady(error)) {
    throw new AppError("Could not create your workspace.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
  return data?.id ?? null;
}

function nextWorkspaceSlug(base: string, attempt: number): string {
  const extra = `-${attempt}`;
  const slug = `${base.slice(0, Math.max(1, 63 - extra.length))}${extra}`
    .replace(/-+$/g, "")
    .slice(0, 63);
  return WORKSPACE_SLUG.test(slug) ? slug : `workspace-${attempt}`.slice(0, 63);
}

async function addOwnerMembership(workspaceId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const payload = {
    workspace_id: workspaceId,
    user_id: userId,
    role: "owner" as const,
  };

  const inserted = await admin.from("grm_workspace_members").insert({
    ...payload,
    active: false,
  });

  if (inserted.error && isSchemaNotReady(inserted.error)) {
    const retry = await admin.from("grm_workspace_members").insert(payload);
    if (retry.error && retry.error.code !== "23505") {
      throw new AppError("Could not create your workspace.", "DB_ERROR", 500, {
        dbError: retry.error.message,
      });
    }
    return;
  }

  if (inserted.error && inserted.error.code !== "23505") {
    throw new AppError("Could not create your workspace.", "DB_ERROR", 500, {
      dbError: inserted.error.message,
    });
  }
}

export interface LivePlatformInvite {
  id: string;
  email: string;
  expires_at: string;
}

/** A pending, unexpired platform (super-admin) invite for this exact email, or null. Expired rows are marked expired. */
export async function livePlatformInvite(
  email: string | null | undefined
): Promise<LivePlatformInvite | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_platform_invites")
    .select("id, email, expires_at, status")
    .eq("email", normalized)
    .eq("status", "pending")
    .maybeSingle();
  if (error) {
    if (isSchemaNotReady(error)) return null;
    throw new AppError("Could not check your invite.", "DB_ERROR", 500, { dbError: error.message });
  }
  if (!data) return null;
  if (isPlatformInviteExpired(data.expires_at)) {
    await admin.from("grm_platform_invites").update({ status: "expired" }).eq("id", data.id).eq("status", "pending");
    return null;
  }
  return { id: data.id, email: data.email, expires_at: data.expires_at };
}

interface WorkspaceGateRow { status: string; planExpiresAt: string | null }

export interface WorkspaceRow {
  id: string;
  name: string;
  status: string;
  planExpiresAt: string | null;
}

/**
 * One request-memoised read of the workspace rows for a set of ids. The gate,
 * the workspace switcher and the layout all need these rows; previously each
 * issued its own `grm_workspaces` round-trip per request.
 */
export const loadWorkspaceRows = cache(async (idsCsv: string): Promise<WorkspaceRow[]> => {
  const ids = idsCsv ? idsCsv.split(",").filter(Boolean) : [];
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  const withStatus = await admin
    .from("grm_workspaces")
    .select("id, name, status, plan_expires_at")
    .in("id", ids);
  if (!withStatus.error) {
    return (withStatus.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status ?? "active",
      planExpiresAt: row.plan_expires_at ?? null,
    }));
  }
  // Pre-migration database: no status/plan columns yet — treat every tenant as active.
  if (!isSchemaNotReady(withStatus.error)) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, { dbError: withStatus.error.message });
  }
  const plain = await admin.from("grm_workspaces").select("id, name").in("id", ids);
  if (plain.error) throw new AppError("Could not load your workspace.", "DB_ERROR", 500, { dbError: plain.error.message });
  return (plain.data ?? []).map((row) => ({ id: row.id, name: row.name, status: "active", planExpiresAt: null }));
});

async function workspaceStatusById(workspaceIds: string[]): Promise<Map<string, WorkspaceGateRow>> {
  const rows = await loadWorkspaceRows([...new Set(workspaceIds)].sort().join(","));
  return new Map(rows.map((row) => [row.id, { status: row.status, planExpiresAt: row.planExpiresAt }]));
}

async function isPlatformBlocked(email: string | null | undefined): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_platform_blocked_users").select("email").eq("email", normalized).maybeSingle();
  if (error) {
    if (isSchemaNotReady(error)) return false;
    throw new AppError("Could not check your access.", "DB_ERROR", 500, { dbError: error.message });
  }
  return Boolean(data);
}

export interface TenantAccess {
  kind: TenantGateKind;
  workspaceId: string | null;
  platformInvite: LivePlatformInvite | null;
}

/**
 * Invite-only gate, without creating anything.
 * Existing memberships (grandfathered owners + accepted team invites) are
 * allowed. A brand-new user is allowed only with a live platform invite,
 * and then only to name & create their tenant — never auto-created here.
 */
export async function inspectTenantAccess(user: {
  id: string;
  email?: string | null;
}): Promise<TenantAccess> {
  const key = `tenant-access:${user.id}`;
  const cached = peek<TenantAccess>(key);
  if (cached?.kind === "allowed" && cached.workspaceId) return cached;
  const access = await resolveTenantAccess(user);
  if (access.kind === "allowed" && access.workspaceId) put(key, access, 20_000);
  return access;
}

async function resolveTenantAccess(user: {
  id: string;
  email?: string | null;
}): Promise<TenantAccess> {
  // Independent checks run together: one round-trip of latency, not two.
  const [blocked] = await Promise.all([isPlatformBlocked(user.email), acceptPendingInvites(user)]);
  if (blocked) {
    return { kind: "blocked", workspaceId: null, platformInvite: null };
  }
  const memberships = await listMemberships(user.id);
  const statuses = await workspaceStatusById(memberships.map((m) => m.workspace_id));
  const gateOf = (m: { workspace_id: string }) => statuses.get(m.workspace_id) ?? { status: "active", planExpiresAt: null };
  const now = Date.now();
  const usable = memberships.filter((m) => {
    const row = gateOf(m);
    return row.status === "active" && (!row.planExpiresAt || Date.parse(row.planExpiresAt) > now);
  });
  if (usable.length > 0) {
    const chosen = pickActiveWorkspace(usable) ?? usable[0]!;
    return { kind: "allowed", workspaceId: chosen.workspace_id, platformInvite: null };
  }
  if (memberships.length > 0 && memberships.every((m) => gateOf(m).status === "active")) {
    return { kind: "plan_expired", workspaceId: null, platformInvite: null };
  }
  const kind = tenantGate({
    workspaceStatuses: memberships.map((m) => gateOf(m).status),
    hasLivePlatformInvite: false,
  });
  if (kind === "suspended" || kind === "deleted") {
    return { kind, workspaceId: null, platformInvite: null };
  }
  const invite = await livePlatformInvite(user.email);
  return {
    kind: invite ? "setup" : "not_invited",
    workspaceId: null,
    platformInvite: invite,
  };
}

function gateError(kind: Exclude<TenantGateKind, "allowed">): AppError {
  switch (kind) {
    case "setup":
      return new AppError("Name your organization to finish setting up your tenant.", TENANT_SETUP_REQUIRED, 409);
    case "suspended":
      return new AppError("This workspace has been suspended. Contact support.", WORKSPACE_SUSPENDED, 403);
    case "deleted":
      return new AppError("This workspace is no longer available. Contact support.", WORKSPACE_DELETED, 403);
    case "blocked":
      return new AppError("This account has been blocked from the platform. Contact support.", "PLATFORM_BLOCKED", 403);
    case "plan_expired":
      return new AppError("Your plan has expired. Contact support to renew.", "PLAN_EXPIRED", 403);
    default:
      return new AppError(
        "RevuPilot is invite-only. Ask the platform team for an invite for this email.",
        PLATFORM_NOT_INVITED,
        403
      );
  }
}

async function createPersonalWorkspace(
  user: { id: string; email?: string | null },
  nameOverride?: string
): Promise<string> {
  const admin = createAdminClient();
  const name = nameOverride?.trim().slice(0, 255) || personalWorkspaceName(user.email);
  const preferredSlug = personalWorkspaceSlug(user.email, user.id);

  let workspaceId: string | null = null;
  let slug = preferredSlug;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (attempt > 1) slug = nextWorkspaceSlug(preferredSlug, attempt);

    const existingId = await findWorkspaceIdBySlug(slug);
    if (existingId) {
      const { data: alreadyMember } = await admin
        .from("grm_workspace_members")
        .select("workspace_id")
        .eq("workspace_id", existingId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (alreadyMember?.workspace_id) {
        workspaceId = existingId;
        break;
      }
      continue;
    }

    const inserted = await admin
      .from("grm_workspaces")
      .insert({ name, slug })
      .select("id")
      .single();

    if (inserted.error?.code === "23505") {
      continue;
    }
    if (inserted.error || !inserted.data?.id) {
      throw new AppError("Could not create your workspace.", "DB_ERROR", 500, {
        dbError: inserted.error?.message,
      });
    }
    workspaceId = inserted.data.id;
    break;
  }

  if (!workspaceId) {
    throw new AppError("Could not create your workspace.", "DB_ERROR", 500, {
      dbError: "Could not allocate a unique workspace slug",
    });
  }

  await addOwnerMembership(workspaceId, user.id);
  try {
    await setActiveWorkspace(user.id, workspaceId);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    logger.warn("workspace.active_mark_skipped", {
      userId: user.id,
      workspaceId,
    });
  }

  logger.info("workspace.personal_ensured", {
    userId: user.id,
    workspaceId,
  });
  return workspaceId;
}

/**
 * Returns the workspace this login should open. Invite-only:
 * a pending team invite is accepted first; existing (grandfathered) members
 * open their active workspace; a platform-invited owner must first name the
 * tenant via createTenantWorkspace; everyone else is refused. Suspended and
 * soft-deleted tenants never open. Nothing is auto-created here.
 */
export async function ensurePersonalWorkspace(user: {
  id: string;
  email?: string | null;
}): Promise<PersonalWorkspace> {
  const access = await inspectTenantAccess(user);
  if (access.kind !== "allowed" || !access.workspaceId) {
    throw gateError(access.kind === "allowed" ? "not_invited" : access.kind);
  }
  // Memberships are request-memoised, so this check is free. Only persist
  // when the active workspace actually changes (a real switch), not on
  // every page load.
  const memberships = await listMemberships(user.id);
  const alreadyActive = memberships.some((m) => m.workspace_id === access.workspaceId && m.active);
  if (!alreadyActive) {
    await setActiveWorkspace(user.id, access.workspaceId).catch((error: unknown) => {
      if (!(error instanceof AuthorizationError)) throw error;
    });
  }
  return { workspace_id: access.workspaceId };
}

/**
 * Create the one tenant for a platform-invited owner. The owner names it.
 * Marks the invite accepted so the same email cannot create a second tenant.
 */
export async function createTenantWorkspace(user: {
  id: string;
  email?: string | null;
}, tenantName: string): Promise<PersonalWorkspace> {
  const name = tenantName.trim();
  if (name.length < 1 || name.length > 255) {
    throw new ValidationError("Enter an organization name (1–255 characters).");
  }
  const existing = await inspectTenantAccess(user);
  if (existing.kind === "allowed") {
    throw new ValidationError("You already have a workspace. Open it instead of creating another tenant.");
  }
  const invite = existing.platformInvite ?? (await livePlatformInvite(user.email));
  if (!invite) throw gateError("not_invited");
  const workspaceId = await createPersonalWorkspace(user, name);
  const admin = createAdminClient();
  const { error } = await admin
    .from("grm_platform_invites")
    .update({
      status: "accepted",
      workspace_id: workspaceId,
      accepted_user_id: user.id,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invite.id)
    .eq("status", "pending");
  if (error && !isSchemaNotReady(error)) {
    throw new AppError("Your workspace was created, but the invite could not be marked accepted. Contact support.", "DB_ERROR", 500, { dbError: error.message });
  }
  await AuditService.log({
    workspaceId,
    userId: user.id,
    action: "platform.tenant_created",
    entityType: "grm_platform_invites",
    entityId: invite.id,
    metadata: { email: normalizeEmail(user.email), name } as Record<string, unknown>,
  });
  return { workspace_id: workspaceId };
}

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: member, error: lookupError } = await admin
    .from("grm_workspace_members")
    .select("workspace_id, active")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (lookupError) {
    if (isSchemaNotReady(lookupError)) return;
    throw new AppError("Could not switch workspace.", "DB_ERROR", 500, {
      dbError: lookupError.message,
    });
  }
  if (!member?.workspace_id) {
    throw new AuthorizationError("You are not a member of that workspace.");
  }
  // Fast path: this runs on every request via ensurePersonalWorkspace. When
  // the workspace is already the active one there is nothing to persist —
  // previously every page load paid two UPDATE round-trips here.
  if (member.active) return;

  const cleared = await admin
    .from("grm_workspace_members")
    .update({ active: false })
    .eq("user_id", userId);

  if (cleared.error) {
    if (isSchemaNotReady(cleared.error)) return;
    throw new AppError("Could not switch workspace.", "DB_ERROR", 500, {
      dbError: cleared.error.message,
    });
  }

  const activated = await admin
    .from("grm_workspace_members")
    .update({ active: true })
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);

  if (activated.error && !isSchemaNotReady(activated.error)) {
    throw new AppError("Could not switch workspace.", "DB_ERROR", 500, {
      dbError: activated.error.message,
    });
  }
  forgetUserNavigation(userId);
  forget(`roster:${workspaceId}`);
}

export const listAccessibleWorkspaces = cache(async (userId: string): Promise<AccessibleWorkspace[]> => {
  const memberships = await listMemberships(userId);
  if (memberships.length === 0) return [];

  const rows = await loadWorkspaceRows([...new Set(memberships.map((row) => row.workspace_id))].sort().join(","));
  // Suspended / soft-deleted tenants are not switchable into.
  const visible = new Set(rows.filter((r) => r.status === "active").map((r) => r.id));
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return memberships
    .filter((row) => visible.has(row.workspace_id))
    .map((row) => ({ id: row.workspace_id, name: names.get(row.workspace_id) ?? "Workspace" }));
});

async function findUserIdByEmail(email: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const response = await fetch(
    `${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) return null;

  const body = (await response.json()) as {
    users?: Array<{ id: string; email?: string | null }>;
  };
  const match = body.users?.find((user) => user.email?.toLowerCase() === email);
  return match?.id ?? null;
}

async function requireManager(
  userId: string,
  workspaceId: string,
  deniedMessage = "Only an organization admin can invite people."
): Promise<GrmMemberRole> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_members")
    .select("role, access_enabled")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
  if (!data) throw new AuthorizationError(deniedMessage);
  if (!data.access_enabled) {
    throw new AuthorizationError("Your access to this organization is turned off.");
  }
  if (!allows(data.role, "manage_people") && data.role !== "admin") {
    throw new AuthorizationError(deniedMessage);
  }
  return data.role;
}

async function loadTargetMember(workspaceId: string, targetUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_members")
    .select("user_id, role, scope_client_id, scope_group_id, scope_location_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) {
    throw new AppError("Could not load workspace members.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
  if (!data) {
    throw new ValidationError("That person is no longer in this workspace.");
  }
  return data;
}

export async function changeMemberRole(input: {
  workspaceId: string;
  actorId: string;
  targetUserId: string;
  role: GrmMemberRole;
}): Promise<void> {
  if (input.actorId === input.targetUserId) {
    throw new ValidationError("You cannot change your own role.");
  }
  const actorRole = await requireManager(
    input.actorId,
    input.workspaceId,
    "Only an organization admin can change roles."
  );
  const target = await loadTargetMember(input.workspaceId, input.targetUserId);

  if (!canManageMember(actorRole, target.role) || !canAssignRole(actorRole, input.role)) {
    throw new AuthorizationError(
      target.role === "owner"
        ? "The organization owner's role cannot be changed."
        : "You cannot assign that role."
    );
  }
  if (target.role === input.role) return;
  const nextScope = {
    clientId: target.scope_client_id,
    groupId: target.scope_group_id,
    locationId: target.scope_location_id,
  };
  const scopeError = roleScopeError(input.role, nextScope);
  if (scopeError) throw new ValidationError(scopeError);

  const admin = createAdminClient();
  const { error } = await admin
    .from("grm_workspace_members")
    .update({ role: input.role })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.targetUserId);
  if (error) {
    throw new AppError("Could not change the role.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.actorId,
    action: "workspace.member_role_changed",
    entityType: "grm_workspace_members",
    entityId: input.targetUserId,
    metadata: { role: input.role, previousRole: target.role } as Record<string, unknown>,
  });
  forgetUserNavigation(input.targetUserId);
  forget(`roster:${input.workspaceId}`);
}

export async function removeMember(input: {
  workspaceId: string;
  actorId: string;
  targetUserId: string;
}): Promise<void> {
  const leaving = input.actorId === input.targetUserId;
  const target = await loadTargetMember(input.workspaceId, input.targetUserId);

  if (leaving) {
    if (target.role === "owner") {
      throw new ValidationError("The owner cannot leave their own workspace.");
    }
  } else {
    const actorRole = await requireManager(
      input.actorId,
      input.workspaceId,
      "Only an owner or admin can remove people."
    );
    if (!canManageMember(actorRole, target.role)) {
      throw new AuthorizationError(
        target.role === "owner"
          ? "The workspace owner cannot be removed."
          : "Only the owner can remove an admin."
      );
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("grm_workspace_members")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.targetUserId);
  if (error) {
    throw new AppError(
      leaving ? "Could not leave the workspace." : "Could not remove that person.",
      "DB_ERROR",
      500,
      { dbError: error.message }
    );
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.actorId,
    action: leaving ? "workspace.member_left" : "workspace.member_removed",
    entityType: "grm_workspace_members",
    entityId: input.targetUserId,
    metadata: { role: target.role } as Record<string, unknown>,
  });
  forgetUserNavigation(input.targetUserId);
  forget(`roster:${input.workspaceId}`);
}

export async function inviteToWorkspace(input: {
  workspaceId: string;
  inviterId: string;
  email: string;
  role: GrmMemberRole;
  scope?: ScopeIds;
}): Promise<void> {
  const raw = input.email.trim();
  if (!raw.includes("@") && /\d/.test(raw)) {
    throw new ValidationError(
      "Mobile invites need a messaging provider, which is not configured. Use an email address."
    );
  }
  const email = normalizeInviteEmail(input.email);
  if (!email.includes("@")) {
    throw new ValidationError("Enter a valid email address.");
  }
  const scope = input.scope ?? { clientId: null, groupId: null, locationId: null };
  const scopeError = roleScopeError(input.role, scope);
  if (scopeError) throw new ValidationError(scopeError);

  const inviterRole = await requireManager(input.inviterId, input.workspaceId);
  if (!canAssignRole(inviterRole, input.role)) {
    throw new AuthorizationError("You cannot invite someone into that role.");
  }
  const actor = await getMemberAccess(input.inviterId, input.workspaceId);
  if (!actor) throw new AuthorizationError("You do not have access to this organization.");
  await assertScopeAssignment({ actor, scope });

  // Super-admin per-tenant member cap, when set.
  {
    const adminCap = createAdminClient();
    const { data: wsCap } = await adminCap.from("grm_workspaces").select("max_members").eq("id", input.workspaceId).maybeSingle();
    if (wsCap?.max_members) {
      const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
        adminCap.from("grm_workspace_members").select("user_id", { count: "exact", head: true }).eq("workspace_id", input.workspaceId),
        adminCap.from("grm_workspace_invites").select("id", { count: "exact", head: true }).eq("workspace_id", input.workspaceId).eq("status", "pending"),
      ]);
      if ((memberCount ?? 0) + (inviteCount ?? 0) >= wsCap.max_members) {
        throw new ValidationError(`This workspace is at its member limit (${wsCap.max_members}). Ask the platform team to raise it.`);
      }
    }
  }

  const admin = createAdminClient();
  const { data: inviter } = await admin.auth.admin.getUserById(input.inviterId);
  if (inviter.user?.email && normalizeInviteEmail(inviter.user.email) === email) {
    throw new ValidationError("You are already in this workspace.");
  }

  const existingUserId = await findUserIdByEmail(email);
  if (existingUserId) {
    const { data: already } = await admin
      .from("grm_workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", existingUserId)
      .maybeSingle();
    if (already) {
      throw new ValidationError("That person is already in this workspace.");
    }
  }

  const { error } = await admin.from("grm_workspace_invites").upsert(
    {
      workspace_id: input.workspaceId,
      email,
      role: input.role,
      invited_by: input.inviterId,
      status: "pending",
      accepted_at: null,
      expires_at: inviteExpiresAt(),
      scope_client_id: scope.clientId,
      scope_group_id: scope.groupId,
      scope_location_id: scope.locationId,
    },
    { onConflict: "workspace_id,email" }
  );

  if (error) {
    if (isSchemaNotReady(error)) {
      throw new AppError(
        "Workspace invites are not available until the latest database migration is applied.",
        "DB_ERROR",
        500
      );
    }
    throw new AppError("Could not create the invite.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.inviterId,
    action: "workspace.invite_created",
    entityType: "grm_workspace_invites",
    metadata: { email, role: input.role } as Record<string, unknown>,
  });
}

export async function revokeWorkspaceInvite(input: {
  workspaceId: string;
  actorId: string;
  inviteId: string;
}): Promise<void> {
  await requireManager(input.actorId, input.workspaceId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_invites")
    .update({ status: "revoked" })
    .eq("id", input.inviteId)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new AppError("Could not cancel the invite.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
  if (!data) {
    throw new ValidationError("That invite is no longer pending.");
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.actorId,
    action: "workspace.invite_revoked",
    entityType: "grm_workspace_invites",
    entityId: input.inviteId,
  });
}

export async function resendWorkspaceInvite(input: {
  workspaceId: string;
  actorId: string;
  inviteId: string;
}): Promise<{ emailed: false }> {
  await requireManager(input.actorId, input.workspaceId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_invites")
    .update({ expires_at: inviteExpiresAt(), status: "pending" })
    .eq("id", input.inviteId)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new AppError("Could not resend the invite.", "DB_ERROR", 500, { dbError: error.message });
  if (!data) throw new ValidationError("That invite is no longer pending.");
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.actorId,
    action: "workspace.invite_resent",
    entityType: "grm_workspace_invites",
    entityId: input.inviteId,
    metadata: { emailed: false },
  });
  return { emailed: false };
}

export async function updateMemberAccess(input: {
  workspaceId: string;
  actorId: string;
  targetUserId: string;
  scope?: ScopeIds;
  accessEnabled?: boolean;
  alertEmail?: boolean;
  alertInApp?: boolean;
}): Promise<void> {
  const self = input.actorId === input.targetUserId;
  if (self && (input.accessEnabled !== undefined || input.scope)) {
    throw new ValidationError("You cannot change your own role or access.");
  }
  const target = await loadTargetMember(input.workspaceId, input.targetUserId);
  const actor = await getMemberAccess(input.actorId, input.workspaceId);
  if (!actor?.enabled) throw new AuthorizationError("Your access to this organization is turned off.");
  if (!self) {
    const actorRole = await requireManager(
      input.actorId,
      input.workspaceId,
      "Only an organization admin can change access."
    );
    if (!canManageMember(actorRole, target.role)) {
      throw new AuthorizationError("The organization owner's access cannot be changed.");
    }
  }
  if (input.scope) {
    const scopeError = roleScopeError(target.role, input.scope);
    if (scopeError) throw new ValidationError(scopeError);
    await assertScopeAssignment({ actor, scope: input.scope });
  }
  const patch: {
    scope_client_id?: string | null;
    scope_group_id?: string | null;
    scope_location_id?: string | null;
    access_enabled?: boolean;
    alert_email?: boolean;
    alert_in_app?: boolean;
  } = {};
  if (input.scope) {
    patch.scope_client_id = input.scope.clientId;
    patch.scope_group_id = input.scope.groupId;
    patch.scope_location_id = input.scope.locationId;
  }
  if (input.accessEnabled !== undefined) patch.access_enabled = input.accessEnabled;
  if (input.alertEmail !== undefined) patch.alert_email = input.alertEmail;
  if (input.alertInApp !== undefined) patch.alert_in_app = input.alertInApp;
  const admin = createAdminClient();
  const { error } = await admin
    .from("grm_workspace_members")
    .update(patch)
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.targetUserId);
  if (error) throw new AppError("Could not update that person.", "DB_ERROR", 500, { dbError: error.message });
  forgetUserNavigation(input.targetUserId);
  forget(`roster:${input.workspaceId}`);
  if (input.scope) {
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "workspace.member_scope_changed",
      entityType: "grm_workspace_members",
      entityId: input.targetUserId,
      metadata: { ...input.scope },
    });
  }
  if (input.accessEnabled !== undefined) {
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: input.accessEnabled ? "workspace.member_activated" : "workspace.member_deactivated",
      entityType: "grm_workspace_members",
      entityId: input.targetUserId,
    });
  }
  if (input.alertEmail !== undefined || input.alertInApp !== undefined) {
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "workspace.notifications_updated",
      entityType: "grm_workspace_members",
      entityId: input.targetUserId,
      metadata: { alertEmail: input.alertEmail ?? null, alertInApp: input.alertInApp ?? null },
    });
  }
}

export async function getWorkspaceRoster(workspaceId: string): Promise<{
  name: string;
  members: WorkspaceRosterMember[];
  invites: WorkspaceRosterInvite[];
}> {
  const { remember } = await import("@/lib/ttl-cache");
  return remember(`roster:${workspaceId}`, 60_000, () => loadWorkspaceRoster(workspaceId));
}

async function loadWorkspaceRoster(workspaceId: string): Promise<{
  name: string;
  members: WorkspaceRosterMember[];
  invites: WorkspaceRosterInvite[];
}> {
  const admin = createAdminClient();
  const [{ data: workspace, error: workspaceError }, membersResult, invitesResult] =
    await Promise.all([
      admin.from("grm_workspaces").select("name").eq("id", workspaceId).single(),
      admin
        .from("grm_workspace_members")
        .select("user_id, role, joined_at, access_enabled, scope_client_id, scope_group_id, scope_location_id, alert_email, alert_in_app")
        .eq("workspace_id", workspaceId)
        .order("joined_at", { ascending: true }),
      admin
        .from("grm_workspace_invites")
        .select("id, email, role, created_at, expires_at, scope_client_id, scope_group_id, scope_location_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);

  if (workspaceError || !workspace) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: workspaceError?.message,
    });
  }
  if (membersResult.error) {
    throw new AppError("Could not load workspace members.", "DB_ERROR", 500, {
      dbError: membersResult.error.message,
    });
  }

  if (invitesResult.error && !isSchemaNotReady(invitesResult.error)) {
    throw new AppError("Could not load workspace invites.", "DB_ERROR", 500, {
      dbError: invitesResult.error.message,
    });
  }

  const pendingInvites = invitesResult.error ? [] : (invitesResult.data ?? []);
  const expiredInvites = pendingInvites.filter((invite) => isInviteExpired(invite.expires_at));
  if (expiredInvites.length) {
    await Promise.all(
      expiredInvites.map((invite) =>
        admin
          .from("grm_workspace_invites")
          .update({ status: "expired" })
          .eq("id", invite.id)
          .eq("status", "pending")
      )
    );
  }
  const memberRows = membersResult.data ?? [];
  const scopeIds = {
    clients: [...new Set([...memberRows, ...pendingInvites].map((row) => row.scope_client_id).filter(Boolean))] as string[],
    groups: [...new Set([...memberRows, ...pendingInvites].map((row) => row.scope_group_id).filter(Boolean))] as string[],
    locations: [...new Set([...memberRows, ...pendingInvites].map((row) => row.scope_location_id).filter(Boolean))] as string[],
  };
  const [clientNames, groupNames, locationNames] = await Promise.all([
    scopeIds.clients.length
      ? admin.from("grm_clients").select("id, name").in("id", scopeIds.clients)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    scopeIds.groups.length
      ? admin.from("grm_groups").select("id, name").in("id", scopeIds.groups)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    scopeIds.locations.length
      ? admin.from("grm_google_locations").select("id, location_title").in("id", scopeIds.locations)
      : Promise.resolve({ data: [] as Array<{ id: string; location_title: string | null }> }),
  ]);
  const names = new Map<string, string>();
  for (const row of clientNames.data ?? []) names.set(row.id, row.name);
  for (const row of groupNames.data ?? []) names.set(row.id, row.name);
  for (const row of locationNames.data ?? []) names.set(row.id, row.location_title ?? "Location");
  const scopeOf = (row: { scope_client_id: string | null; scope_group_id: string | null; scope_location_id: string | null }) => ({
    clientId: row.scope_client_id,
    groupId: row.scope_group_id,
    locationId: row.scope_location_id,
  });
  const scopeLabel = (scope: ScopeIds) => {
    if (scope.locationId) return names.get(scope.locationId) ?? "Location";
    if (scope.groupId) return names.get(scope.groupId) ?? "Group";
    if (scope.clientId) return names.get(scope.clientId) ?? "Brand";
    return "Whole organization";
  };

  const invites = pendingInvites
    .filter((invite) => !isInviteExpired(invite.expires_at))
    .map((invite) => {
      const scope = scopeOf(invite);
      return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
        scope,
        scopeLabel: scopeLabel(scope),
      };
    });

  const profiles = await loadAuthProfiles(memberRows.map((member) => member.user_id));
  const members = memberRows.map((member) => {
    const profile = profiles.get(member.user_id);
    const scope = scopeOf(member);
    return {
      userId: member.user_id,
      email: profile?.email ?? "Unknown email",
      role: member.role,
      joinedAt: member.joined_at,
      accessEnabled: member.access_enabled,
      scope,
      scopeLabel: scopeLabel(scope),
      alertEmail: member.alert_email,
      alertInApp: member.alert_in_app,
      twoStep: profile?.twoStep ?? ("unavailable" as const),
      lastActive: profile?.lastActive ?? null,
    };
  });

  return { name: workspace.name, members, invites };
}

export async function getMemberRole(
  userId: string,
  workspaceId: string
): Promise<GrmMemberRole | null> {
  const access = await getMemberAccess(userId, workspaceId);
  return (access?.role as GrmMemberRole | undefined) ?? null;
}

export function canApproveReplies(role: string | null | undefined): boolean {
  return allows(role, "approve_negative");
}

/** Profile and review sync use the workspace Google connection. The owner and an admin may start them. */
export function canSyncWorkspace(role: string | null | undefined): boolean {
  return role === "owner" || role === "org_admin" || role === "admin";
}

export async function assertCanSyncWorkspace(
  userId: string,
  workspaceId: string
): Promise<void> {
  const role = await getMemberRole(userId, workspaceId);
  if (!canSyncWorkspace(role)) {
    throw new AuthorizationError("Only the workspace owner or an admin can sync Google profiles and reviews.");
  }
}

export async function assertCanApproveReplies(
  userId: string,
  workspaceId: string
): Promise<void> {
  const role = await getMemberRole(userId, workspaceId);
  if (!canApproveReplies(role)) {
    throw new AuthorizationError("Only an owner or admin can approve replies.");
  }
}
