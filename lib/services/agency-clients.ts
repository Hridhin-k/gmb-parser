import { createAdminClient } from "@/lib/supabase/admin";
import {
  contactEmailError,
  createOnboardingSecret,
  hashOnboardingToken,
  httpsUrlError,
  ONBOARDING_TTL_MS,
  onboardingLinkState,
} from "@/lib/agency-portal";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { AuditService } from "@/lib/services/audit";
import { assertReviewAction, assertScoped, getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { isOrgScope, workspaceGrant } from "@/lib/access";
import { getMemberRole } from "@/lib/services/workspace";
import { recordUsageEvent } from "@/lib/services/usage-events";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";

export interface ClientInput {
  name: string;
  contactEmail: string;
  website: string;
  brandName: string;
  logoUrl: string;
  accountManagerUserId: string | null;
}

function cleanClient(input: ClientInput, allowManager: boolean): {
  name: string;
  contact_email: string | null;
  website: string | null;
  brand_name: string | null;
  logo_url: string | null;
  account_manager_user_id?: string | null;
} {
  const name = input.name.trim();
  if (!name || name.length > 255) throw new ValidationError("Name the client in 255 characters or fewer.");
  const emailError = contactEmailError(input.contactEmail);
  if (emailError) throw new ValidationError(emailError);
  const websiteError = httpsUrlError(input.website, "Website");
  if (websiteError) throw new ValidationError(websiteError);
  const logoError = httpsUrlError(input.logoUrl, "Logo");
  if (logoError) throw new ValidationError(logoError);
  const brand = input.brandName.trim();
  if (brand.length > 80) throw new ValidationError("The client brand name has to be 80 characters or fewer.");
  return {
    name,
    contact_email: input.contactEmail.trim() || null,
    website: input.website.trim() || null,
    brand_name: brand || null,
    logo_url: input.logoUrl.trim() || null,
    ...(allowManager ? { account_manager_user_id: input.accountManagerUserId } : {}),
  };
}

async function assertCanCreate(userId: string, workspaceId: string): Promise<void> {
  const access = await getMemberAccess(userId, workspaceId);
  if (!access?.enabled || !isOrgScope(access.scope) || !workspaceGrant(access.role, "manage_locations")) {
    throw new AuthorizationError("You cannot add a client for the whole organization.");
  }
}

export async function createAgencyClient(input: {
  workspaceId: string;
  userId: string;
  client: ClientInput;
}): Promise<{ id: string }> {
  await assertCanCreate(input.userId, input.workspaceId);
  const admin = createAdminClient();
  if (input.client.accountManagerUserId) {
    const member = await admin
      .from("grm_workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.client.accountManagerUserId)
      .maybeSingle();
    if (!member.data) throw new ValidationError("Choose an account manager from this organization.");
  }
  const payload = cleanClient(input.client, true);
  const { data, error } = await admin
    .from("grm_clients")
    .insert({ ...payload, workspace_id: input.workspaceId, created_by: input.userId })
    .select("id")
    .single();
  if (error || !data) throw new AppError("Could not add the client.", "DB_ERROR", 500);
  await recordUsageEvent({
    workspaceId: input.workspaceId,
    clientId: data.id,
    kind: "client_created",
    sourceId: data.id,
  });
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "client.created",
    entityType: "grm_clients",
    entityId: data.id,
    metadata: { name: payload.name },
  });
  return { id: data.id };
}

export async function updateAgencyClient(input: {
  workspaceId: string;
  userId: string;
  clientId: string;
  client: ClientInput;
}): Promise<void> {
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: "manage_locations",
    target: { kind: "client", id: input.clientId },
  });
  const role = await getMemberRole(input.userId, input.workspaceId);
  const access = await getMemberAccess(input.userId, input.workspaceId);
  const allowManager = Boolean(access && isOrgScope(access.scope) && workspaceGrant(role, "manage_locations"));
  const admin = createAdminClient();
  const existing = await admin
    .from("grm_clients")
    .select("id, notes")
    .eq("id", input.clientId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!existing.data || existing.data.notes === UNASSIGNED_CLIENT_MARKER) {
    throw new AuthorizationError("That client is not in this organization.");
  }
  if (allowManager && input.client.accountManagerUserId) {
    const member = await admin
      .from("grm_workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspaceId)
      .eq("user_id", input.client.accountManagerUserId)
      .maybeSingle();
    if (!member.data) throw new ValidationError("Choose an account manager from this organization.");
  }
  const payload = cleanClient(input.client, allowManager);
  const { error } = await admin.from("grm_clients").update(payload).eq("id", input.clientId).eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not save the client.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "client.updated",
    entityType: "grm_clients",
    entityId: input.clientId,
    metadata: { name: payload.name },
  });
}

export async function issueOnboardingLink(input: {
  workspaceId: string;
  userId: string;
  clientId: string;
  origin: string;
}): Promise<{ url: string; expiresAt: string }> {
  await assertScoped({
    userId: input.userId,
    workspaceId: input.workspaceId,
    permission: "manage_locations",
    target: { kind: "client", id: input.clientId },
  });
  const admin = createAdminClient();
  const client = await admin
    .from("grm_clients")
    .select("id, notes")
    .eq("id", input.clientId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!client.data || client.data.notes === UNASSIGNED_CLIENT_MARKER) {
    throw new AuthorizationError("That client is not in this organization.");
  }
  const now = new Date();
  await admin
    .from("grm_client_onboarding")
    .update({ expires_at: now.toISOString() })
    .eq("workspace_id", input.workspaceId)
    .eq("client_id", input.clientId)
    .is("used_at", null);
  const secret = createOnboardingSecret();
  const expiresAt = new Date(now.getTime() + ONBOARDING_TTL_MS).toISOString();
  const { error } = await admin.from("grm_client_onboarding").insert({
    workspace_id: input.workspaceId,
    client_id: input.clientId,
    token_hash: secret.hash,
    expires_at: expiresAt,
    created_by: input.userId,
  });
  if (error) throw new AppError("Could not create the onboarding link.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "client.onboarding_issued",
    entityType: "grm_clients",
    entityId: input.clientId,
  });
  const origin = input.origin.replace(/\/$/, "");
  return { url: `${origin}/c/${secret.token}`, expiresAt };
}

export async function readOnboardingLink(token: string): Promise<{
  state: ReturnType<typeof onboardingLinkState>;
  clientName: string | null;
  onboardingId: string | null;
  workspaceId: string | null;
  clientId: string | null;
  createdBy: string | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("grm_client_onboarding")
    .select("id, workspace_id, client_id, expires_at, used_at, created_by")
    .eq("token_hash", hashOnboardingToken(token))
    .maybeSingle();
  if (!data) return { state: "expired", clientName: null, onboardingId: null, workspaceId: null, clientId: null, createdBy: null };
  const client = await admin.from("grm_clients").select("name").eq("id", data.client_id).maybeSingle();
  return {
    state: onboardingLinkState({ expiresAt: data.expires_at, usedAt: data.used_at }),
    clientName: client.data?.name ?? null,
    onboardingId: data.id,
    workspaceId: data.workspace_id,
    clientId: data.client_id,
    createdBy: data.created_by,
  };
}

export async function completeOnboardingLink(onboardingId: string): Promise<void> {
  await createAdminClient()
    .from("grm_client_onboarding")
    .update({ used_at: new Date().toISOString() })
    .eq("id", onboardingId)
    .is("used_at", null);
}

export async function setClientApproval(input: {
  workspaceId: string;
  userId: string;
  reviewId: string;
  decision: "requested" | "approved" | "none";
}): Promise<void> {
  await assertReviewAction({
    userId: input.userId,
    workspaceId: input.workspaceId,
    reviewId: input.reviewId,
    action: "draft",
  });
  const admin = createAdminClient();
  const reply = await admin
    .from("grm_review_replies")
    .select("id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("review_id", input.reviewId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!reply.data || reply.data.status === "published") {
    throw new ValidationError("A published reply is not in the client queue.");
  }
  const { error } = await admin
    .from("grm_review_replies")
    .update({ client_approval: input.decision })
    .eq("id", reply.data.id);
  if (error) throw new AppError("Could not update the client queue.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "client.approval_updated",
    entityType: "grm_reviews",
    entityId: input.reviewId,
    metadata: { decision: input.decision },
  });
}

export async function assertClientVisible(userId: string, workspaceId: string, clientId: string): Promise<void> {
  const access = await getMemberAccess(userId, workspaceId);
  const allowed = await visibleClientIds(workspaceId, access?.scope);
  if (allowed && !allowed.includes(clientId)) {
    throw new AuthorizationError("That client is not in your scope.");
  }
}
