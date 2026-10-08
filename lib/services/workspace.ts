import { createAdminClient } from "@/lib/supabase/admin";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { AuditService } from "@/lib/services/audit";
import { logger } from "@/lib/logger";
import type { GrmMemberRole } from "@/lib/types";
import { canManageMember } from "@/lib/roles";

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
}

export interface WorkspaceRosterInvite {
  id: string;
  email: string;
  role: GrmMemberRole;
  createdAt: string;
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

async function listMemberships(userId: string): Promise<MembershipRow[]> {
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
}

async function acceptPendingInvites(user: {
  id: string;
  email?: string | null;
}): Promise<string[]> {
  const email = user.email ? normalizeInviteEmail(user.email) : "";
  if (!email) return [];

  const admin = createAdminClient();
  const { data: invites, error } = await admin
    .from("grm_workspace_invites")
    .select("id, workspace_id, role, invited_by")
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
    const { error: memberError } = await admin.from("grm_workspace_members").insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      invited_by: invite.invited_by,
      active: false,
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

async function createPersonalWorkspace(user: {
  id: string;
  email?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const name = personalWorkspaceName(user.email);
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
 * Returns the workspace this login should open.
 * A pending invite is accepted first, and that workspace is the one they see.
 * Someone with no invite gets a personal workspace on first use.
 */
export async function ensurePersonalWorkspace(user: {
  id: string;
  email?: string | null;
}): Promise<PersonalWorkspace> {
  const accepted = await acceptPendingInvites(user);

  if (accepted.length === 0) {
    const existing = await listMemberships(user.id);
    if (existing.length === 0) {
      const workspaceId = await createPersonalWorkspace(user);
      return { workspace_id: workspaceId };
    }
  }

  if (accepted.length > 0) {
    const workspaceId = accepted[accepted.length - 1];
    await setActiveWorkspace(user.id, workspaceId);
    return { workspace_id: workspaceId };
  }

  const memberships = await listMemberships(user.id);
  const chosen = pickActiveWorkspace(memberships);
  if (!chosen) {
    const workspaceId = await createPersonalWorkspace(user);
    return { workspace_id: workspaceId };
  }
  return { workspace_id: chosen.workspace_id };
}

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: member, error: lookupError } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
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
}

export async function listAccessibleWorkspaces(userId: string): Promise<AccessibleWorkspace[]> {
  const memberships = await listMemberships(userId);
  if (memberships.length === 0) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspaces")
    .select("id, name")
    .in(
      "id",
      memberships.map((row) => row.workspace_id)
    );

  if (error) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }

  const names = new Map((data ?? []).map((row) => [row.id, row.name]));
  return memberships.map((row) => ({
    id: row.workspace_id,
    name: names.get(row.workspace_id) ?? "Workspace",
  }));
}

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
  deniedMessage = "Only an owner or admin can invite people."
): Promise<GrmMemberRole> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new AppError("Could not load your workspace.", "DB_ERROR", 500, {
      dbError: error.message,
    });
  }
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new AuthorizationError(deniedMessage);
  }
  return data.role;
}

async function loadTargetMember(workspaceId: string, targetUserId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_workspace_members")
    .select("user_id, role")
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
  role: "admin" | "member";
}): Promise<void> {
  if (input.actorId === input.targetUserId) {
    throw new ValidationError("You cannot change your own role.");
  }
  const actorRole = await requireManager(
    input.actorId,
    input.workspaceId,
    "Only an owner or admin can change roles."
  );
  const target = await loadTargetMember(input.workspaceId, input.targetUserId);

  if (!canManageMember(actorRole, target.role)) {
    throw new AuthorizationError(
      target.role === "owner"
        ? "The workspace owner's role cannot be changed."
        : "Only the owner can change an admin's role."
    );
  }
  if (actorRole === "admin" && input.role === "admin") {
    throw new AuthorizationError("Only the owner can make someone an admin.");
  }
  if (target.role === input.role) return;

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
}

export async function inviteToWorkspace(input: {
  workspaceId: string;
  inviterId: string;
  email: string;
  role: "admin" | "member";
}): Promise<void> {
  const email = normalizeInviteEmail(input.email);
  if (!email.includes("@")) {
    throw new ValidationError("Enter a valid email address.");
  }

  const inviterRole = await requireManager(input.inviterId, input.workspaceId);
  if (input.role === "admin" && inviterRole !== "owner") {
    throw new AuthorizationError("Only the owner can invite an admin.");
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

export async function getWorkspaceRoster(workspaceId: string): Promise<{
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
        .select("user_id, role, joined_at")
        .eq("workspace_id", workspaceId)
        .order("joined_at", { ascending: true }),
      admin
        .from("grm_workspace_invites")
        .select("id, email, role, created_at")
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

  const invites = invitesResult.error
    ? []
    : (invitesResult.data ?? []).map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        createdAt: invite.created_at,
      }));

  const members = await Promise.all(
    (membersResult.data ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      return {
        userId: member.user_id,
        email: data.user?.email ?? "Unknown email",
        role: member.role,
        joinedAt: member.joined_at,
      };
    })
  );

  return { name: workspace.name, members, invites };
}

export async function getMemberRole(
  userId: string,
  workspaceId: string
): Promise<GrmMemberRole | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data?.role ?? null;
}

export function canApproveReplies(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Profile and review sync use the workspace Google connection. Only the owner may start them. */
export function canSyncWorkspace(role: string | null | undefined): boolean {
  return role === "owner";
}

export async function assertCanSyncWorkspace(
  userId: string,
  workspaceId: string
): Promise<void> {
  const role = await getMemberRole(userId, workspaceId);
  if (!canSyncWorkspace(role)) {
    throw new AuthorizationError("Only the workspace owner can sync Google profiles and reviews.");
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
