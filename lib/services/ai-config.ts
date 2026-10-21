import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { AuditService } from "@/lib/services/audit";
import { assertScoped } from "@/lib/services/access";
import { getMemberRole } from "@/lib/services/workspace";
import { workspaceGrant } from "@/lib/access";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import type { Json } from "@/lib/types/supabase";
import {
  AI_KNOWLEDGE_KINDS,
  assertSameWorkspace,
  defaultSnapshot,
  insightLensFingerprint,
  insightLensFromMetadata,
  knowledgeInScope,
  parseInsightLens,
  parseSnapshot,
  resolveInsightLens,
  type AiConfigSnapshot,
  type AiConfigStatus,
  type AiKnowledgeKind,
  type AiKnowledgeRow,
  type InsightLens,
  type KnowledgeScope,
  type OrgContext,
} from "@/lib/ai-config";
import { flattenAutomation, flattenTone } from "@/lib/automation";
import { rulesHash } from "@/lib/intelligence/tenant-context";
import type { SettingsTarget } from "@/lib/services/reply-settings";

const KNOWLEDGE_SELECT =
  "id, workspace_id, client_id, group_id, location_id, kind, title, body, enabled, metadata";

export interface AiConfigRow {
  id: string;
  workspaceId: string;
  version: number;
  status: AiConfigStatus;
  label: string;
  snapshot: AiConfigSnapshot;
  createdAt: string;
  updatedAt: string;
}

async function assertCanEdit(userId: string, workspaceId: string, target: SettingsTarget): Promise<void> {
  if (target.kind === "workspace") {
    const role = await getMemberRole(userId, workspaceId);
    if (!workspaceGrant(role, "edit_rules")) {
      throw new AuthorizationError("You cannot change organization AI settings.");
    }
    return;
  }
  await assertScoped({
    userId,
    workspaceId,
    permission: "edit_rules",
    target,
  });
}

function mapConfig(row: {
  id: string;
  workspace_id: string;
  version: number;
  status: string;
  label: string;
  snapshot: Json;
  created_at: string;
  updated_at: string;
}): AiConfigRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    version: row.version,
    status: row.status as AiConfigStatus,
    label: row.label,
    snapshot: parseSnapshot(row.snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledge(row: {
  id: string;
  workspace_id: string;
  client_id: string | null;
  group_id: string | null;
  location_id: string | null;
  kind: string;
  title: string;
  body: string;
  enabled: boolean;
  metadata?: Json | null;
}): AiKnowledgeRow {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clientId: row.client_id,
    groupId: row.group_id,
    locationId: row.location_id,
    kind: row.kind as AiKnowledgeKind,
    title: row.title,
    body: row.body,
    enabled: row.enabled,
    metadata,
  };
}

async function migrateSnapshotFromLegacy(workspaceId: string): Promise<AiConfigSnapshot> {
  const admin = createAdminClient();
  const [settings, onboarding] = await Promise.all([
    admin.from("grm_reply_settings").select("tone, automation").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("grm_onboarding").select("tone_voice, tone_note").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const snapshot = defaultSnapshot();
  if (settings.data?.tone && typeof settings.data.tone === "object") {
    const parsed = parseSnapshot({ org: snapshot.org, tone: settings.data.tone, automation: settings.data.automation });
    snapshot.tone = parsed.tone;
    snapshot.automation = parsed.automation;
  }
  const voice = onboarding.data?.tone_voice;
  if (voice === "warm" || voice === "professional" || voice === "brief") {
    snapshot.org.legacyVoice = voice;
  }
  if (typeof onboarding.data?.tone_note === "string") {
    snapshot.org.legacyNote = onboarding.data.tone_note;
  }
  return snapshot;
}

/** Ensure one active config exists, migrating tone from reply settings / onboarding on first create. */
export async function ensureActiveAiConfig(
  workspaceId: string,
  userId?: string | null
): Promise<AiConfigRow> {
  const admin = createAdminClient();
  const existing = await admin
    .from("grm_ai_configs")
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();
  if (existing.data) return mapConfig(existing.data);

  const snapshot = await migrateSnapshotFromLegacy(workspaceId);
  const inserted = await admin
    .from("grm_ai_configs")
    .insert({
      workspace_id: workspaceId,
      version: 1,
      status: "active",
      label: "Initial configuration",
      snapshot: snapshot as unknown as Json,
      created_by: userId ?? null,
    })
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .single();
  if (inserted.error || !inserted.data) {
    const race = await admin
      .from("grm_ai_configs")
      .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .maybeSingle();
    if (race.data) return mapConfig(race.data);
    throw new AppError("Could not create AI configuration.", "DB_ERROR", 500);
  }
  return mapConfig(inserted.data);
}

export async function listAiConfigs(workspaceId: string): Promise<AiConfigRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_ai_configs")
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("version", { ascending: false });
  if (error) throw new AppError("Could not load AI configurations.", "DB_ERROR", 500);
  return (data ?? []).map(mapConfig);
}

export async function loadAiBoard(workspaceId: string, userId: string): Promise<{
  active: AiConfigRow;
  versions: AiConfigRow[];
  knowledge: AiKnowledgeRow[];
}> {
  const active = await ensureActiveAiConfig(workspaceId, userId);
  const admin = createAdminClient();
  const [versions, knowledge] = await Promise.all([
    listAiConfigs(workspaceId),
    admin
      .from("grm_ai_knowledge")
      .select(KNOWLEDGE_SELECT)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
  ]);
  if (knowledge.error) throw new AppError("Could not load saved instructions.", "DB_ERROR", 500);
  return {
    active,
    versions,
    knowledge: (knowledge.data ?? []).map(mapKnowledge),
  };
}

/** Persist organisation context (and optional label) on the active config snapshot. */
export async function saveActiveAiSnapshot(input: {
  workspaceId: string;
  userId: string;
  org?: Partial<OrgContext>;
  insights?: Partial<InsightLens>;
  label?: string;
}): Promise<AiConfigRow> {
  await assertCanEdit(input.userId, input.workspaceId, { kind: "workspace" });
  const active = await ensureActiveAiConfig(input.workspaceId, input.userId);
  const next = parseSnapshot(active.snapshot);
  if (input.org) {
    next.org = {
      industry: input.org.industry ?? next.org.industry,
      positioning: input.org.positioning ?? next.org.positioning,
      priorities: input.org.priorities ?? next.org.priorities,
      policies: input.org.policies ?? next.org.policies,
      legacyVoice: input.org.legacyVoice ?? next.org.legacyVoice,
      legacyNote: input.org.legacyNote ?? next.org.legacyNote,
    };
  }
  if (input.insights) {
    next.insights = parseInsightLens({
      vertical: input.insights.vertical ?? next.insights.vertical,
      watchThemes: input.insights.watchThemes ?? next.insights.watchThemes,
      focusQuestions: input.insights.focusQuestions ?? next.insights.focusQuestions,
      successSignals: input.insights.successSignals ?? next.insights.successSignals,
    });
  }

  const admin = createAdminClient();
  const label = input.label?.trim() || active.label;
  const { error } = await admin
    .from("grm_ai_configs")
    .update({
      snapshot: next as unknown as Json,
      label,
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id)
    .eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not save AI configuration.", "DB_ERROR", 500);

  const previousLens = insightLensFingerprint(parseSnapshot(active.snapshot).insights);
  const nextLens = insightLensFingerprint(next.insights);
  if (previousLens !== nextLens) {
    try {
      const { noteTenantRulesChange } = await import("@/lib/services/intelligence-freshness");
      await noteTenantRulesChange(admin, input.workspaceId, nextLens);
    } catch (rulesError) {
      logger.warn("intelligence.rules_invalidation_failed", {
        message: rulesError instanceof Error ? rulesError.message : "rules",
      });
    }
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "ai_config.saved",
    entityType: "grm_ai_configs",
    entityId: active.id,
    metadata: { version: active.version },
  });

  return { ...active, snapshot: next, label };
}

/** Sync workspace tone/automation into the active AI config after Settings save (no nested reply save). */
export async function syncActiveSnapshotFromReplySettings(input: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const active = await ensureActiveAiConfig(input.workspaceId, input.userId);
  const { loadReplySettings } = await import("@/lib/services/reply-settings");
  const loaded = await loadReplySettings(input.workspaceId, { kind: "workspace" });
  const next = parseSnapshot(active.snapshot);
  next.tone = flattenTone(loaded.tone);
  next.automation = flattenAutomation(loaded.automation);
  await admin
    .from("grm_ai_configs")
    .update({ snapshot: next as unknown as Json, updated_at: new Date().toISOString() })
    .eq("id", active.id)
    .eq("workspace_id", input.workspaceId);
}

export async function activateAiConfigVersion(input: {
  workspaceId: string;
  userId: string;
  version: number;
}): Promise<AiConfigRow> {
  await assertCanEdit(input.userId, input.workspaceId, { kind: "workspace" });
  const admin = createAdminClient();
  const target = await admin
    .from("grm_ai_configs")
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .eq("workspace_id", input.workspaceId)
    .eq("version", input.version)
    .maybeSingle();
  if (!target.data) throw new ValidationError("That configuration version was not found.");

  const current = await admin
    .from("grm_ai_configs")
    .select("id, version")
    .eq("workspace_id", input.workspaceId)
    .eq("status", "active")
    .maybeSingle();

  if (current.data && current.data.id !== target.data.id) {
    const archived = await admin
      .from("grm_ai_configs")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", current.data.id);
    if (archived.error) throw new AppError("Could not archive the active configuration.", "DB_ERROR", 500);
  }

  const activated = await admin
    .from("grm_ai_configs")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", target.data.id)
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .single();
  if (activated.error || !activated.data) {
    throw new AppError("Could not activate that configuration.", "DB_ERROR", 500);
  }

  const snap = parseSnapshot(activated.data.snapshot);
  const { saveReplySettings } = await import("@/lib/services/reply-settings");
  await saveReplySettings({
    workspaceId: input.workspaceId,
    userId: input.userId,
    target: { kind: "workspace" },
    tone: snap.tone,
    automation: snap.automation,
  });

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "ai_config.activated",
    entityType: "grm_ai_configs",
    entityId: activated.data.id,
    metadata: {
      from_version: current.data?.version ?? null,
      to_version: activated.data.version,
    },
  });

  return mapConfig(activated.data);
}

export async function createAiConfigVersion(input: {
  workspaceId: string;
  userId: string;
  label?: string;
  activate?: boolean;
}): Promise<AiConfigRow> {
  await assertCanEdit(input.userId, input.workspaceId, { kind: "workspace" });
  const active = await ensureActiveAiConfig(input.workspaceId, input.userId);
  const admin = createAdminClient();
  const latest = await admin
    .from("grm_ai_configs")
    .select("version")
    .eq("workspace_id", input.workspaceId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest.data?.version ?? active.version) + 1;
  const activate = input.activate !== false;

  if (activate) {
    await admin
      .from("grm_ai_configs")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("status", "active");
  }

  const inserted = await admin
    .from("grm_ai_configs")
    .insert({
      workspace_id: input.workspaceId,
      version,
      status: activate ? "active" : "draft",
      label: input.label?.trim() || `Version ${version}`,
      snapshot: active.snapshot as unknown as Json,
      created_by: input.userId,
    })
    .select("id, workspace_id, version, status, label, snapshot, created_at, updated_at")
    .single();
  if (inserted.error || !inserted.data) {
    throw new AppError("Could not create a configuration version.", "DB_ERROR", 500);
  }

  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: activate ? "ai_config.activated" : "ai_config.saved",
    entityType: "grm_ai_configs",
    entityId: inserted.data.id,
    metadata: { from_version: active.version, to_version: version },
  });

  return mapConfig(inserted.data);
}

export async function listKnowledge(workspaceId: string): Promise<AiKnowledgeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_ai_knowledge")
    .select("id, workspace_id, client_id, group_id, location_id, kind, title, body, enabled, metadata")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new AppError("Could not load saved instructions.", "DB_ERROR", 500);
  return assertSameWorkspace((data ?? []).map(mapKnowledge), workspaceId);
}

export async function upsertKnowledge(input: {
  workspaceId: string;
  userId: string;
  id?: string;
  kind: AiKnowledgeKind;
  title: string;
  body: string;
  enabled?: boolean;
  target?: SettingsTarget;
  metadata?: Record<string, unknown>;
}): Promise<AiKnowledgeRow> {
  if (!AI_KNOWLEDGE_KINDS.includes(input.kind)) {
    throw new ValidationError("Unknown knowledge kind.");
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 120) throw new ValidationError("Title must be 1–120 characters.");
  if (input.kind === "insight_lens") {
    if (body.length > 4000) throw new ValidationError("Notes must be at most 4,000 characters.");
  } else if (!body || body.length > 4000) {
    throw new ValidationError("Body must be 1–4,000 characters.");
  }
  const target = input.target ?? { kind: "workspace" as const };
  await assertCanEdit(input.userId, input.workspaceId, target);

  const admin = createAdminClient();
  const scope = {
    client_id: target.kind === "client" ? target.id : null,
    group_id: target.kind === "group" ? target.id : null,
    location_id: target.kind === "location" ? target.id : null,
  };
  const metadataPayload =
    input.kind === "insight_lens"
      ? ({
          lens: parseInsightLens(input.metadata?.lens ?? input.metadata ?? {}),
        } as unknown as Json)
      : ((input.metadata ?? {}) as unknown as Json);

  if (input.id) {
    const existing = await admin
      .from("grm_ai_knowledge")
      .select("id")
      .eq("id", input.id)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (!existing.data) throw new AuthorizationError("That instruction was not found.");
    const updated = await admin
      .from("grm_ai_knowledge")
      .update({
        kind: input.kind,
        title,
        body: body || (input.kind === "insight_lens" ? "Insight lens" : body),
        enabled: input.enabled ?? true,
        metadata: metadataPayload,
        ...scope,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("workspace_id", input.workspaceId)
      .select(KNOWLEDGE_SELECT)
      .single();
    if (updated.error || !updated.data) throw new AppError("Could not update the instruction.", "DB_ERROR", 500);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "ai_knowledge.updated",
      entityType: "grm_ai_knowledge",
      entityId: updated.data.id,
      metadata: { kind: input.kind },
    });
    await noteKnowledgeChange(admin, input.workspaceId, updated.data.id, body);
    return mapKnowledge(updated.data);
  }

  const inserted = await admin
    .from("grm_ai_knowledge")
    .insert({
      workspace_id: input.workspaceId,
      kind: input.kind,
      title,
      body: body || (input.kind === "insight_lens" ? "Insight lens" : body),
      enabled: input.enabled ?? true,
      metadata: metadataPayload,
      created_by: input.userId,
      ...scope,
    })
    .select(KNOWLEDGE_SELECT)
    .single();
  if (inserted.error || !inserted.data) throw new AppError("Could not save the instruction.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "ai_knowledge.created",
    entityType: "grm_ai_knowledge",
    entityId: inserted.data.id,
    metadata: { kind: input.kind },
  });
  await noteKnowledgeChange(admin, input.workspaceId, inserted.data.id, body);
  return mapKnowledge(inserted.data);
}

/** Workspace defaults, overridden by a client-scoped insight_lens knowledge row. */
export async function loadResolvedInsightLens(input: {
  workspaceId: string;
  clientId: string | null;
}): Promise<{ lens: InsightLens; notes: string }> {
  const [active, knowledge] = await Promise.all([
    ensureActiveAiConfig(input.workspaceId),
    listKnowledge(input.workspaceId),
  ]);
  const lens = resolveInsightLens({
    workspaceLens: active.snapshot.insights,
    knowledge,
    clientId: input.clientId,
  });
  const noteRow = knowledge.find(
    (row) =>
      row.enabled &&
      row.kind === "insight_lens" &&
      (input.clientId
        ? row.clientId === input.clientId && !row.groupId && !row.locationId
        : !row.clientId && !row.groupId && !row.locationId) &&
      insightLensFromMetadata(row.metadata)
  );
  return { lens, notes: noteRow?.body?.trim() && noteRow.body !== "Insight lens" ? noteRow.body : "" };
}

export async function deleteKnowledge(input: {
  workspaceId: string;
  userId: string;
  id: string;
}): Promise<void> {
  const admin = createAdminClient();
  const existing = await admin
    .from("grm_ai_knowledge")
    .select("id, client_id, group_id, location_id")
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!existing.data) throw new AuthorizationError("That instruction was not found.");
  const target: SettingsTarget = existing.data.location_id
    ? { kind: "location", id: existing.data.location_id }
    : existing.data.group_id
      ? { kind: "group", id: existing.data.group_id }
      : existing.data.client_id
        ? { kind: "client", id: existing.data.client_id }
        : { kind: "workspace" };
  await assertCanEdit(input.userId, input.workspaceId, target);
  const { error } = await admin
    .from("grm_ai_knowledge")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not delete the instruction.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "ai_knowledge.deleted",
    entityType: "grm_ai_knowledge",
    entityId: input.id,
    metadata: {},
  });
  await noteKnowledgeChange(admin, input.workspaceId, input.id, "deleted");
}

async function noteKnowledgeChange(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  id: string,
  body: string
): Promise<void> {
  try {
    const { noteTenantRulesChange } = await import("@/lib/services/intelligence-freshness");
    await noteTenantRulesChange(admin, workspaceId, rulesHash({ version: 0, lensFingerprint: id, knowledge: [{ id, body }] }));
  } catch (error) {
    logger.warn("intelligence.rules_invalidation_failed", {
      message: error instanceof Error ? error.message : "knowledge",
    });
  }
}

/** Active configuration for this workspace, plus knowledge for the already authorised scope. */
export async function loadAuthorisedTenantBundle(
  workspaceId: string,
  scope: KnowledgeScope
): Promise<{ version: number; rulesHash: string; lensFingerprint: string; knowledge: AiKnowledgeRow[] }> {
  if (scope.workspaceId && scope.workspaceId !== workspaceId) {
    throw new AuthorizationError("That configuration belongs to another workspace.");
  }
  const admin = createAdminClient();
  const [config, knowledge] = await Promise.all([
    ensureActiveAiConfig(workspaceId),
    admin.from("grm_ai_knowledge").select(KNOWLEDGE_SELECT).eq("workspace_id", workspaceId).eq("enabled", true),
  ]);
  if (knowledge.error) throw new AppError("Could not load saved instructions.", "DB_ERROR", 500);
  const scoped = knowledgeInScope(assertSameWorkspace((knowledge.data ?? []).map(mapKnowledge), workspaceId), {
    ...scope,
    workspaceId,
  });
  const lensFingerprint = insightLensFingerprint(config.snapshot.insights);
  return {
    version: config.version,
    lensFingerprint,
    rulesHash: rulesHash({
      version: config.version,
      lensFingerprint,
      knowledge: scoped.map((row) => ({ id: row.id, body: row.body })),
    }),
    knowledge: scoped,
  };
}

export async function loadPromptContextForLocation(
  workspaceId: string,
  locationId: string
): Promise<{
  config: AiConfigRow;
  knowledge: AiKnowledgeRow[];
  templates: Array<{ name: string; body: string }>;
  scope: KnowledgeScope;
}> {
  const admin = createAdminClient();
  const [config, location, knowledge, templates, groups] = await Promise.all([
    ensureActiveAiConfig(workspaceId),
    admin
      .from("grm_google_locations")
      .select("id, client_id, group_id")
      .eq("id", locationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("grm_ai_knowledge")
      .select(KNOWLEDGE_SELECT)
      .eq("workspace_id", workspaceId)
      .eq("enabled", true),
    admin
      .from("grm_reply_templates")
      .select("name, body, client_id, group_id, location_id")
      .eq("workspace_id", workspaceId),
    admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId),
  ]);

  if (!location.data) throw new AppError("Location not found", "NOT_FOUND", 404);

  const group = location.data.group_id
    ? (groups.data ?? []).find((row) => row.id === location.data!.group_id)
    : null;
  const scope: KnowledgeScope = {
    workspaceId,
    clientId: location.data.client_id,
    groupId: location.data.group_id,
    parentGroupId: group?.parent_id ?? null,
    locationId,
  };

  const scopedKnowledge = knowledgeInScope(
    assertSameWorkspace((knowledge.data ?? []).map(mapKnowledge), workspaceId),
    scope
  );

  const scopedTemplates = (templates.data ?? []).filter((row) => {
    if (!row.client_id && !row.group_id && !row.location_id) return true;
    if (row.location_id) return row.location_id === locationId;
    if (row.group_id) return row.group_id === scope.groupId || row.group_id === scope.parentGroupId;
    if (row.client_id) return row.client_id === scope.clientId;
    return false;
  });

  return {
    config,
    knowledge: scopedKnowledge,
    templates: scopedTemplates.map((row) => ({ name: row.name, body: row.body })),
    scope,
  };
}

export async function saveInsightFeedback(input: {
  workspaceId: string;
  userId: string;
  insightKind: "location" | "scope" | "page";
  scopeId: string;
  rating: "useful" | "not_useful";
  note?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("grm_insight_feedback").insert({
    workspace_id: input.workspaceId,
    insight_kind: input.insightKind,
    scope_id: input.scopeId,
    rating: input.rating,
    note: input.note?.trim().slice(0, 500) || null,
    user_id: input.userId,
  });
  if (error) throw new AppError("Could not save feedback.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "insight.feedback",
    entityType: "grm_insight_feedback",
    entityId: input.scopeId,
    metadata: { insight_kind: input.insightKind, rating: input.rating },
  });
}
