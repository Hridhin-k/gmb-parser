import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { getMemberRole } from "@/lib/services/workspace";
import {
  AppError,
  AuthorizationError,
  ConfirmRequiredError,
  ValidationError,
} from "@/lib/errors";
import { isManager } from "@/lib/shell";
import {
  holdReasons,
  matchCsvGroups,
  parseGroupCsv,
  suggestGroups,
  type GroupingMode,
  type HoldReason,
  type OnboardingStep,
  type SuggestedGroup,
  type ToneVoice,
} from "@/lib/onboarding";
import { remember } from "@/lib/ttl-cache";

const STEPS: readonly string[] = ["connect", "import", "groups", "tone", "invite", "done"];
const VOICES: readonly ToneVoice[] = ["warm", "professional", "brief"];
const GROUPINGS: readonly GroupingMode[] = ["state_city", "city", "account", "none", "csv"];

export interface OnboardingLocation {
  id: string;
  title: string;
  address: string | null;
  accountName: string;
  accountUnverified: boolean;
  placeId: string | null;
  voiceOfMerchant: boolean | null;
  holdReason: HoldReason | null;
  googleDuplicateOf: string | null;
  groupId: string | null;
  groupName: string | null;
  clientName: string | null;
}

export interface OnboardingGroup {
  id: string;
  name: string;
  source: string;
  locationCount: number;
}

export interface OnboardingConnection {
  id: string;
  google_email: string;
  status: string;
  created_at: string;
  last_refreshed_at: string | null;
}

export interface OnboardingInvite {
  id: string;
  email: string;
  role: "org_admin" | "admin" | "member";
  expiresAt: string;
}

export interface OnboardingView {
  step: OnboardingStep | "done";
  completed: boolean;
  grouping: GroupingMode | null;
  toneVoice: ToneVoice | null;
  toneNote: string;
  connections: OnboardingConnection[];
  locations: OnboardingLocation[];
  groups: OnboardingGroup[];
  invites: OnboardingInvite[];
}

export interface OnboardingGate {
  completed: boolean;
  started: boolean;
  connections: number;
  locations: number;
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
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

function schemaError(): AppError {
  return new AppError(
    "Setup is not available until the onboarding migration is applied (supabase/migrations/20261016001_onboarding.sql).",
    "DB_ERROR",
    500
  );
}

function asStep(value: string | null | undefined): OnboardingStep | "done" {
  if (value && STEPS.includes(value)) return value as OnboardingStep | "done";
  return "connect";
}

function asGrouping(value: string | null | undefined): GroupingMode | null {
  if (value && (GROUPINGS as readonly string[]).includes(value)) return value as GroupingMode;
  return null;
}

function asVoice(value: string | null | undefined): ToneVoice | null {
  if (value && (VOICES as readonly string[]).includes(value)) return value as ToneVoice;
  return null;
}

function asHold(value: string | null | undefined): HoldReason | null {
  if (value === "duplicate" || value === "unverified") return value;
  return null;
}

async function assertManager(userId: string, workspaceId: string): Promise<void> {
  const role = await getMemberRole(userId, workspaceId);
  if (!isManager(role)) {
    throw new AuthorizationError("Only an owner or admin can change setup.");
  }
}

export async function getOnboardingGate(workspaceId: string): Promise<OnboardingGate> {
  return remember(`onboard-gate:${workspaceId}`, 60_000, () => loadOnboardingGate(workspaceId));
}

async function loadOnboardingGate(workspaceId: string): Promise<OnboardingGate> {
  const admin = createAdminClient();
  const [connections, locations, progress] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked"),
    admin
      .from("grm_google_locations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    admin
      .from("grm_onboarding")
      .select("completed_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  if (connections.error) {
    throw new AppError("Could not check Google connections.", "DB_ERROR", 500);
  }
  if (locations.error) {
    throw new AppError("Could not check locations.", "DB_ERROR", 500);
  }

  const started = !progress.error && Boolean(progress.data);
  const completed =
    !progress.error && !isMissingSchema(progress.error) && Boolean(progress.data?.completed_at);

  return {
    completed,
    started,
    connections: connections.count ?? 0,
    locations: locations.count ?? 0,
  };
}

export async function getWorkspaceTone(
  workspaceId: string
): Promise<{ voice: ToneVoice | null; note: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_onboarding")
    .select("tone_voice, tone_note")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    throw new AppError("Could not load the reply tone.", "DB_ERROR", 500);
  }
  if (!data) return null;
  return { voice: asVoice(data.tone_voice), note: data.tone_note };
}

export async function refreshLocationHolds(workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const [locations, accounts] = await Promise.all([
    admin
      .from("grm_google_locations")
      .select(
        "id, place_id, location_title, address_formatted, google_duplicate_of, voice_of_merchant, hold_reason, google_account_id"
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    admin
      .from("grm_google_accounts")
      .select("id, verification_state")
      .eq("workspace_id", workspaceId),
  ]);

  if (locations.error) {
    if (isMissingSchema(locations.error)) return;
    throw new AppError("Could not check location duplicates.", "DB_ERROR", 500);
  }
  if (accounts.error) {
    throw new AppError("Could not check Google account status.", "DB_ERROR", 500);
  }

  const unverifiedAccounts = new Set(
    (accounts.data ?? [])
      .filter((account) => account.verification_state === "UNVERIFIED")
      .map((account) => account.id)
  );
  const next = holdReasons(
    (locations.data ?? []).map((location) => ({
      id: location.id,
      placeId: location.place_id,
      title: location.location_title,
      address: location.address_formatted,
      googleDuplicateOf: location.google_duplicate_of,
      voiceOfMerchant: location.voice_of_merchant,
      accountUnverified: unverifiedAccounts.has(location.google_account_id),
    }))
  );

  const changes = (locations.data ?? []).filter(
    (location) => (asHold(location.hold_reason) ?? null) !== (next.get(location.id) ?? null)
  );
  await Promise.all(
    changes.map((location) =>
      admin
        .from("grm_google_locations")
        .update({ hold_reason: next.get(location.id) ?? null })
        .eq("id", location.id)
        .eq("workspace_id", workspaceId)
    )
  );
}

async function ensureRow(workspaceId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("grm_onboarding").upsert(
    { workspace_id: workspaceId },
    { onConflict: "workspace_id", ignoreDuplicates: true }
  );
  if (error) {
    if (isMissingSchema(error)) throw schemaError();
    throw new AppError("Could not save setup progress.", "DB_ERROR", 500);
  }
}

export async function getOnboardingView(workspaceId: string): Promise<OnboardingView> {
  await ensureRow(workspaceId);
  await refreshLocationHolds(workspaceId);
  const admin = createAdminClient();

  const [progress, connections, locations, groups, accounts, clients, invites] = await Promise.all([
    admin.from("grm_onboarding").select("step, grouping, tone_voice, tone_note, completed_at").eq("workspace_id", workspaceId).maybeSingle(),
    admin
      .from("grm_google_connections")
      .select("id, google_email, status, created_at, last_refreshed_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked")
      .order("created_at", { ascending: false }),
    admin
      .from("grm_google_locations")
      .select(
        "id, location_title, address_formatted, place_id, voice_of_merchant, google_duplicate_of, hold_reason, group_id, google_account_id, client_id"
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("location_title", { ascending: true }),
    admin
      .from("grm_location_groups")
      .select("id, name, source")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    admin.from("grm_google_accounts").select("id, account_display_name, verification_state").eq("workspace_id", workspaceId),
    admin.from("grm_clients").select("id, name").eq("workspace_id", workspaceId),
    admin
      .from("grm_workspace_invites")
      .select("id, email, role, status, expires_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  if (progress.error) {
    if (isMissingSchema(progress.error)) throw schemaError();
    throw new AppError("Could not load setup progress.", "DB_ERROR", 500);
  }
  for (const result of [connections, locations, groups, accounts, clients]) {
    if (result.error) throw new AppError("Could not load setup.", "DB_ERROR", 500);
  }

  const accountById = new Map((accounts.data ?? []).map((account) => [account.id, account]));
  const clientById = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const groupById = new Map((groups.data ?? []).map((group) => [group.id, group.name]));
  const counts = new Map<string, number>();
  for (const location of locations.data ?? []) {
    if (!location.group_id) continue;
    counts.set(location.group_id, (counts.get(location.group_id) ?? 0) + 1);
  }

  const pendingInvites: OnboardingInvite[] = [];
  if (!invites.error) {
    const now = Date.now();
    for (const invite of invites.data ?? []) {
      if (Date.parse(invite.expires_at) <= now) {
        await admin
          .from("grm_workspace_invites")
          .update({ status: "expired" })
          .eq("id", invite.id)
          .eq("status", "pending");
        continue;
      }
      if (invite.role !== "org_admin" && invite.role !== "admin" && invite.role !== "member") continue;
      pendingInvites.push({
        id: invite.id,
        email: invite.email,
        role: invite.role as OnboardingInvite["role"],
        expiresAt: invite.expires_at,
      });
    }
  }

  return {
    step: asStep(progress.data?.step),
    completed: Boolean(progress.data?.completed_at),
    grouping: asGrouping(progress.data?.grouping),
    toneVoice: asVoice(progress.data?.tone_voice),
    toneNote: progress.data?.tone_note ?? "",
    connections: connections.data ?? [],
    locations: (locations.data ?? []).map((location) => {
      const account = accountById.get(location.google_account_id);
      return {
        id: location.id,
        title: location.location_title,
        address: location.address_formatted,
        accountName: account?.account_display_name ?? "Google account",
        accountUnverified: account?.verification_state === "UNVERIFIED",
        placeId: location.place_id,
        voiceOfMerchant: location.voice_of_merchant,
        holdReason: asHold(location.hold_reason),
        googleDuplicateOf: location.google_duplicate_of,
        groupId: location.group_id,
        groupName: location.group_id ? groupById.get(location.group_id) ?? null : null,
        clientName: location.client_id ? clientById.get(location.client_id) ?? null : null,
      };
    }),
    groups: (groups.data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      source: group.source,
      locationCount: counts.get(group.id) ?? 0,
    })),
    invites: pendingInvites,
  };
}

async function touch(
  workspaceId: string,
  patch: {
    step?: OnboardingStep | "done";
    grouping?: GroupingMode | null;
    tone_voice?: ToneVoice | null;
    tone_note?: string | null;
    completed_at?: string | null;
  }
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("grm_onboarding").update(patch).eq("workspace_id", workspaceId);
  if (error) {
    if (isMissingSchema(error)) throw schemaError();
    throw new AppError("Could not save setup progress.", "DB_ERROR", 500);
  }
}

export async function saveOnboardingStep(
  workspaceId: string,
  userId: string,
  step: OnboardingStep
): Promise<void> {
  await assertManager(userId, workspaceId);
  await ensureRow(workspaceId);
  await touch(workspaceId, { step, completed_at: null });
  await AuditService.log({
    workspaceId,
    userId,
    action: "onboarding.updated",
    entityType: "grm_onboarding",
    entityId: workspaceId,
    metadata: { step },
  });
}

async function groupCount(workspaceId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("grm_location_groups")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (error) {
    if (isMissingSchema(error)) throw schemaError();
    throw new AppError("Could not load groups.", "DB_ERROR", 500);
  }
  return count ?? 0;
}

async function replaceGroups(
  workspaceId: string,
  grouping: GroupingMode,
  groups: SuggestedGroup[]
): Promise<void> {
  const admin = createAdminClient();
  const removed = await admin.from("grm_location_groups").delete().eq("workspace_id", workspaceId);
  if (removed.error) throw new AppError("Could not replace groups.", "DB_ERROR", 500);

  for (const group of groups) {
    const created = await admin
      .from("grm_location_groups")
      .insert({ workspace_id: workspaceId, name: group.name, source: group.source })
      .select("id")
      .single();
    if (created.error || !created.data) {
      throw new AppError("Could not create a group.", "DB_ERROR", 500);
    }
    for (let index = 0; index < group.locationIds.length; index += 80) {
      const slice = group.locationIds.slice(index, index + 80);
      const assigned = await admin
        .from("grm_google_locations")
        .update({ group_id: created.data.id })
        .eq("workspace_id", workspaceId)
        .in("id", slice);
      if (assigned.error) throw new AppError("Could not place locations into groups.", "DB_ERROR", 500);
    }
  }

  await touch(workspaceId, { grouping });
}

async function locationsForGrouping(workspaceId: string) {
  const admin = createAdminClient();
  const [locations, accounts] = await Promise.all([
    admin
      .from("grm_google_locations")
      .select("id, location_title, address_formatted, google_account_id, hold_reason")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    admin.from("grm_google_accounts").select("id, account_display_name").eq("workspace_id", workspaceId),
  ]);
  if (locations.error || accounts.error) throw new AppError("Could not load locations.", "DB_ERROR", 500);
  const names = new Map((accounts.data ?? []).map((account) => [account.id, account.account_display_name]));
  return (locations.data ?? []).map((location) => ({
    id: location.id,
    title: location.location_title,
    address: location.address_formatted,
    accountName: names.get(location.google_account_id) ?? null,
    holdReason: asHold(location.hold_reason),
  }));
}

export async function applyGrouping(input: {
  workspaceId: string;
  userId: string;
  mode: Exclude<GroupingMode, "csv">;
  confirm: boolean;
}): Promise<{ groupCount: number; unplaced: number }> {
  await assertManager(input.userId, input.workspaceId);
  await ensureRow(input.workspaceId);
  const existing = await groupCount(input.workspaceId);
  if (existing > 0 && !input.confirm) {
    throw new ConfirmRequiredError(
      input.mode === "none"
        ? "This removes every group. Locations stay on their current clients."
        : "This replaces every current group. Unverified and duplicate profiles stay ungrouped."
    );
  }

  if (input.mode === "none") {
    await replaceGroups(input.workspaceId, "none", []);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "location_group.updated",
      entityType: "grm_location_groups",
      metadata: { mode: "none" },
    });
    return { groupCount: 0, unplaced: 0 };
  }

  const locations = await locationsForGrouping(input.workspaceId);
  const suggestion = suggestGroups(input.mode, locations);
  await replaceGroups(input.workspaceId, input.mode, suggestion.groups);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.updated",
    entityType: "grm_location_groups",
    metadata: { mode: input.mode, groups: suggestion.groups.length },
  });
  return { groupCount: suggestion.groups.length, unplaced: suggestion.unplacedIds.length };
}

export async function applyCsvGrouping(input: {
  workspaceId: string;
  userId: string;
  csv: string;
  confirm: boolean;
}): Promise<{ groupCount: number; held: number }> {
  await assertManager(input.userId, input.workspaceId);
  await ensureRow(input.workspaceId);
  const locations = await locationsForGrouping(input.workspaceId);
  const matched = matchCsvGroups(parseGroupCsv(input.csv), locations);
  if (matched.errors.length) {
    throw new ValidationError(matched.errors.slice(0, 8).join(" "));
  }
  if (!matched.groups.length) {
    throw new ValidationError("The file did not match any locations that can be grouped.");
  }
  const existing = await groupCount(input.workspaceId);
  if (existing > 0 && !input.confirm) {
    throw new ConfirmRequiredError(
      "This replaces every current group. Rows for unverified or duplicate profiles are left ungrouped."
    );
  }
  await replaceGroups(input.workspaceId, "csv", matched.groups);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.updated",
    entityType: "grm_location_groups",
    metadata: { mode: "csv", groups: matched.groups.length, held: matched.heldIds.length },
  });
  return { groupCount: matched.groups.length, held: matched.heldIds.length };
}

export async function createLocationGroup(input: {
  workspaceId: string;
  userId: string;
  name: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId);
  const admin = createAdminClient();
  const { error } = await admin.from("grm_location_groups").insert({
    workspace_id: input.workspaceId,
    name: input.name.trim(),
    source: "manual",
  });
  if (error) {
    if (error.code === "23505") throw new ValidationError("A group with that name already exists.");
    if (isMissingSchema(error)) throw schemaError();
    throw new AppError("Could not create the group.", "DB_ERROR", 500);
  }
}

export async function renameLocationGroup(input: {
  workspaceId: string;
  userId: string;
  groupId: string;
  name: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_location_groups")
    .update({ name: input.name.trim() })
    .eq("id", input.groupId)
    .eq("workspace_id", input.workspaceId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") throw new ValidationError("A group with that name already exists.");
    throw new AppError("Could not rename the group.", "DB_ERROR", 500);
  }
  if (!data) throw new ValidationError("That group is no longer in this workspace.");
}

export async function mergeLocationGroups(input: {
  workspaceId: string;
  userId: string;
  sourceId: string;
  targetId: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId);
  if (input.sourceId === input.targetId) {
    throw new ValidationError("Choose two different groups to merge.");
  }
  const admin = createAdminClient();
  const target = await admin
    .from("grm_location_groups")
    .select("id")
    .eq("id", input.targetId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (target.error || !target.data) throw new ValidationError("The group you are merging into is missing.");

  const reparented = await admin
    .from("grm_location_groups")
    .update({ parent_id: input.targetId })
    .eq("workspace_id", input.workspaceId)
    .eq("parent_id", input.sourceId);
  if (reparented.error) throw new AppError("Could not move cities into the group.", "DB_ERROR", 500);

  const moved = await admin
    .from("grm_google_locations")
    .update({ group_id: input.targetId })
    .eq("workspace_id", input.workspaceId)
    .eq("group_id", input.sourceId);
  if (moved.error) throw new AppError("Could not move locations into the group.", "DB_ERROR", 500);

  const removed = await admin
    .from("grm_location_groups")
    .delete()
    .eq("id", input.sourceId)
    .eq("workspace_id", input.workspaceId);
  if (removed.error) throw new AppError("Could not remove the merged group.", "DB_ERROR", 500);

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "location_group.updated",
    entityType: "grm_location_groups",
    entityId: input.targetId,
    metadata: { merged: input.sourceId },
  });
}

export async function moveLocationToGroup(input: {
  workspaceId: string;
  userId: string;
  locationId: string;
  groupId: string | null;
  confirmHold: boolean;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId);
  const admin = createAdminClient();
  const location = await admin
    .from("grm_google_locations")
    .select("id, hold_reason, workspace_id, client_id")
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (location.error || !location.data) throw new ValidationError("That location is not in this workspace.");

  if (input.groupId && location.data.hold_reason && !input.confirmHold) {
    throw new ConfirmRequiredError(
      "This profile is unverified or a suspected duplicate. Confirm to place it in a group. Automatic drafts stay off."
    );
  }

  if (input.groupId) {
    const group = await admin
      .from("grm_location_groups")
      .select("id, workspace_id, client_id")
      .eq("id", input.groupId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (group.error || !group.data) throw new ValidationError("That group is not in this workspace.");
    const { locationMoveError } = await import("@/lib/hierarchy");
    const problem = locationMoveError({
      locationWorkspaceId: location.data.workspace_id,
      groupWorkspaceId: group.data.workspace_id,
      locationClientId: location.data.client_id,
      groupClientId: group.data.client_id,
    });
    if (problem) throw new ValidationError(problem);
  }

  const { error } = await admin
    .from("grm_google_locations")
    .update({ group_id: input.groupId })
    .eq("id", input.locationId)
    .eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not move the location.", "DB_ERROR", 500);
}

export async function saveReplyTone(input: {
  workspaceId: string;
  userId: string;
  voice: ToneVoice;
  note: string;
}): Promise<void> {
  await assertManager(input.userId, input.workspaceId);
  await ensureRow(input.workspaceId);
  await touch(input.workspaceId, {
    tone_voice: input.voice,
    tone_note: input.note.trim() || null,
  });
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "onboarding.updated",
    entityType: "grm_onboarding",
    entityId: input.workspaceId,
    metadata: { tone: input.voice },
  });
}

export async function completeOnboarding(workspaceId: string, userId: string): Promise<void> {
  await assertManager(userId, workspaceId);
  await ensureRow(workspaceId);
  await touch(workspaceId, { step: "done", completed_at: new Date().toISOString() });
  await AuditService.log({
    workspaceId,
    userId,
    action: "onboarding.updated",
    entityType: "grm_onboarding",
    entityId: workspaceId,
    metadata: { step: "done" },
  });
}
