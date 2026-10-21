import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { EscalationService } from "@/lib/services/escalations";
import { assertScoped } from "@/lib/services/access";
import { draftsPausedForLocation } from "@/lib/services/hierarchy";
import type { Json } from "@/lib/types/supabase";
import { AppError, AuthorizationError, ValidationError } from "@/lib/errors";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { workspaceGrant } from "@/lib/access";
import { getMemberRole } from "@/lib/services/workspace";
import {
  AUTOMATION_DEFAULTS,
  TONE_DEFAULTS,
  automationError,
  automationVerdict,
  flattenAutomation,
  flattenTone,
  localPreview,
  resolveAutomation,
  resolveTone,
  toneError,
  type AutomationFields,
  type AutomationValue,
  type ToneFields,
  type ToneValue,
} from "@/lib/automation";

export type SettingsTarget =
  | { kind: "workspace" }
  | { kind: "client" | "group" | "location"; id: string };

interface ScopeRow {
  client_id: string | null;
  group_id: string | null;
  location_id: string | null;
  tone: ToneFields | null;
  automation: AutomationFields | null;
}

function asTone(value: unknown): ToneFields | null {
  if (!value || typeof value !== "object") return null;
  return value as ToneFields;
}

function asAutomation(value: unknown): AutomationFields | null {
  if (!value || typeof value !== "object") return null;
  return value as AutomationFields;
}

async function assertCanEdit(userId: string, workspaceId: string, target: SettingsTarget): Promise<void> {
  if (target.kind === "workspace") {
    const role = await getMemberRole(userId, workspaceId);
    if (!workspaceGrant(role, "edit_rules")) {
      throw new AuthorizationError("You cannot change organization settings.");
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

export async function loadReplySettings(workspaceId: string, target: SettingsTarget): Promise<{
  label: string;
  appliesTo: string;
  tone: ReturnType<typeof resolveTone>;
  automation: ReturnType<typeof resolveAutomation>;
  templates: Array<{ id: string; name: string; body: string; scopeLabel: string }>;
  overrides: number;
}> {
  const admin = createAdminClient();
  const [workspaceRow, scopeRows, templates, groups, clients, locations] = await Promise.all([
    admin.from("grm_reply_settings").select("tone, automation").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("grm_scope_settings").select("client_id, group_id, location_id, tone, automation").eq("workspace_id", workspaceId),
    admin.from("grm_reply_templates").select("id, name, body, client_id, group_id, location_id").eq("workspace_id", workspaceId).order("name"),
    admin.from("grm_groups").select("id, name, parent_id, client_id").eq("workspace_id", workspaceId),
    admin.from("grm_clients").select("id, name, notes").eq("workspace_id", workspaceId),
    admin.from("grm_google_locations").select("id, location_title, client_id, group_id").eq("workspace_id", workspaceId),
  ]);
  if (scopeRows.error) throw new AppError("Could not load settings.", "DB_ERROR", 500);
  const rows = (scopeRows.data ?? []) as ScopeRow[];
  const groupById = new Map((groups.data ?? []).map((group) => [group.id, group]));
  const clientName = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
  const layers: Array<{ label: string; fields: ToneFields | null; automation: AutomationFields | null }> = [];

  const pushScope = (row: ScopeRow | undefined, label: string) => {
    layers.push({ label, fields: row?.tone ?? null, automation: row?.automation ?? null });
  };

  let label = "the organization";
  let appliesTo = "every location, unless a brand, group, or location overrides it";
  if (target.kind === "client") {
    const client = (clients.data ?? []).find((item) => item.id === target.id);
    if (!client || client.notes === UNASSIGNED_CLIENT_MARKER) throw new ValidationError("That brand is not in this organization.");
    label = client.name;
    const count = (locations.data ?? []).filter((location) => location.client_id === client.id).length;
    appliesTo = `${count} location${count === 1 ? "" : "s"}, unless a group overrides it`;
    pushScope(rows.find((row) => row.client_id === client.id), client.name);
  } else if (target.kind === "group") {
    const group = groupById.get(target.id);
    if (!group) throw new ValidationError("That group is not in this organization.");
    label = group.name;
    appliesTo = "locations in this group, unless a location overrides it";
    pushScope(rows.find((row) => row.group_id === group.id), group.name);
    if (group.parent_id) {
      const parent = groupById.get(group.parent_id);
      if (parent) pushScope(rows.find((row) => row.group_id === parent.id), parent.name);
    }
    if (group.client_id) pushScope(rows.find((row) => row.client_id === group.client_id), clientName.get(group.client_id) ?? "Brand");
  } else if (target.kind === "location") {
    const location = (locations.data ?? []).find((item) => item.id === target.id);
    if (!location) throw new ValidationError("That location is not in this organization.");
    label = location.location_title ?? "Location";
    appliesTo = "this location";
    pushScope(rows.find((row) => row.location_id === location.id), label);
    const group = location.group_id ? groupById.get(location.group_id) : null;
    if (group) {
      pushScope(rows.find((row) => row.group_id === group.id), group.name);
      const parent = group.parent_id ? groupById.get(group.parent_id) : null;
      if (parent) pushScope(rows.find((row) => row.group_id === parent.id), parent.name);
    }
    if (location.client_id) {
      pushScope(rows.find((row) => row.client_id === location.client_id), clientName.get(location.client_id) ?? "Brand");
    }
  }
  layers.push({
    label: "the organization",
    fields: asTone(workspaceRow.data?.tone),
    automation: asAutomation(workspaceRow.data?.automation),
  });

  const toneLayers = layers.map((layer) => ({ label: layer.label, fields: layer.fields }));
  const automationLayers = layers.map((layer) => ({ label: layer.label, fields: layer.automation }));
  const tone = resolveTone(toneLayers);
  const automation = resolveAutomation(automationLayers);
  const overrides = rows.filter((row) => row.tone || row.automation).length;
  const templateRows = templates.data ?? [];
  return {
    label,
    appliesTo,
    tone,
    automation,
    overrides,
    templates: templateRows.map((template) => ({
      id: template.id,
      name: template.name,
      body: template.body,
      scopeLabel: template.location_id
        ? "Location"
        : template.group_id
          ? groupById.get(template.group_id)?.name ?? "Group"
          : template.client_id
            ? clientName.get(template.client_id) ?? "Brand"
            : "Organization",
    })),
  };
}

export async function saveReplySettings(input: {
  workspaceId: string;
  userId: string;
  target: SettingsTarget;
  tone?: ToneFields | null;
  automation?: AutomationFields | null;
}): Promise<void> {
  if (input.tone) {
    const error = toneError(input.tone);
    if (error) throw new ValidationError(error);
  }
  if (input.automation) {
    const error = automationError(input.automation);
    if (error) throw new ValidationError(error);
  }
  await assertCanEdit(input.userId, input.workspaceId, input.target);
  const admin = createAdminClient();
  if (input.target.kind === "workspace") {
    const existing = await admin.from("grm_reply_settings").select("workspace_id").eq("workspace_id", input.workspaceId).maybeSingle();
    const payload = {
      tone: (input.tone ?? {}) as Json,
      automation: (input.automation ?? {}) as Json,
      updated_at: new Date().toISOString(),
    };
    const saved = existing.data
      ? await admin.from("grm_reply_settings").update(payload).eq("workspace_id", input.workspaceId)
      : await admin.from("grm_reply_settings").insert({ workspace_id: input.workspaceId, ...payload });
    if (saved.error) throw new AppError("Could not save settings.", "DB_ERROR", 500);
  } else {
    const column = input.target.kind === "client" ? "client_id" : input.target.kind === "group" ? "group_id" : "location_id";
    const existing = await admin
      .from("grm_scope_settings")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq(column, input.target.id)
      .maybeSingle();
    const payload = {
      tone: (input.tone ?? null) as Json,
      automation: (input.automation ?? null) as Json,
    };
    const saved = existing.data
      ? await admin.from("grm_scope_settings").update(payload).eq("id", existing.data.id)
      : await admin.from("grm_scope_settings").insert({
          workspace_id: input.workspaceId,
          scope: input.target.kind,
          client_id: input.target.kind === "client" ? input.target.id : null,
          group_id: input.target.kind === "group" ? input.target.id : null,
          location_id: input.target.kind === "location" ? input.target.id : null,
          ...payload,
        });
    if (saved.error) throw new AppError("Could not save the override.", "DB_ERROR", 500);
  }
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "settings.reply_updated",
    entityType: "grm_reply_settings",
    metadata: { target: input.target.kind, id: input.target.kind === "workspace" ? input.workspaceId : input.target.id },
  });
  if (input.target.kind === "workspace") {
    try {
      const { syncActiveSnapshotFromReplySettings } = await import("@/lib/services/ai-config");
      await syncActiveSnapshotFromReplySettings({
        workspaceId: input.workspaceId,
        userId: input.userId,
      });
    } catch {
      // AI config tables may not be migrated yet; tone still saves to grm_reply_settings.
    }
  }
}

export async function saveTemplate(input: {
  workspaceId: string;
  userId: string;
  target: SettingsTarget;
  name: string;
  body: string;
}): Promise<void> {
  const name = input.name.trim();
  const body = input.body.trim();
  if (!name || name.length > 80) throw new ValidationError("Name the template in 80 characters or fewer.");
  if (!body || body.length > 1000) throw new ValidationError("The template has to be 1,000 characters or fewer.");
  await assertCanEdit(input.userId, input.workspaceId, input.target);
  const admin = createAdminClient();
  const { error } = await admin.from("grm_reply_templates").insert({
    workspace_id: input.workspaceId,
    name,
    body,
    client_id: input.target.kind === "client" ? input.target.id : null,
    group_id: input.target.kind === "group" ? input.target.id : null,
    location_id: input.target.kind === "location" ? input.target.id : null,
  });
  if (error) throw new AppError("Could not save the template.", "DB_ERROR", 500);
  await AuditService.log({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: "settings.template_saved",
    entityType: "grm_reply_templates",
    metadata: { name },
  });
}

export async function deleteTemplate(input: {
  workspaceId: string;
  userId: string;
  templateId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const existing = await admin
    .from("grm_reply_templates")
    .select("client_id, group_id, location_id")
    .eq("id", input.templateId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!existing.data) throw new AuthorizationError("You cannot delete that template.");
  const target: SettingsTarget = existing.data.location_id
    ? { kind: "location", id: existing.data.location_id }
    : existing.data.group_id
      ? { kind: "group", id: existing.data.group_id }
      : existing.data.client_id
        ? { kind: "client", id: existing.data.client_id }
        : { kind: "workspace" };
  await assertCanEdit(input.userId, input.workspaceId, target);
  const { error } = await admin
    .from("grm_reply_templates")
    .delete()
    .eq("id", input.templateId)
    .eq("workspace_id", input.workspaceId);
  if (error) throw new AppError("Could not delete the template.", "DB_ERROR", 500);
}

export async function resolvedForLocation(
  workspaceId: string,
  locationId: string
): Promise<{ tone: ToneValue; automation: AutomationValue }> {
  const loaded = await loadReplySettings(workspaceId, { kind: "location", id: locationId });
  return { tone: flattenTone(loaded.tone), automation: flattenAutomation(loaded.automation) };
}

/** Tone for one draft. Skips the full location and client lists the settings screen loads. */
export async function resolvedVoiceForDraft(
  workspaceId: string,
  location: { id: string; clientId: string | null; groupId: string | null; title: string }
): Promise<{ tone: ToneValue; automation: AutomationValue }> {
  const admin = createAdminClient();
  const [workspaceRow, scopeRows, groups] = await Promise.all([
    admin.from("grm_reply_settings").select("tone, automation").eq("workspace_id", workspaceId).maybeSingle(),
    admin
      .from("grm_scope_settings")
      .select("client_id, group_id, location_id, tone, automation")
      .eq("workspace_id", workspaceId),
    admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId),
  ]);
  if (scopeRows.error) throw new AppError("Could not load settings.", "DB_ERROR", 500);

  const rows = (scopeRows.data ?? []) as ScopeRow[];
  const groupById = new Map((groups.data ?? []).map((group) => [group.id, group]));
  const layers: Array<{ label: string; fields: ToneFields | null; automation: AutomationFields | null }> = [];
  const push = (row: ScopeRow | undefined, label: string) => {
    layers.push({ label, fields: row?.tone ?? null, automation: row?.automation ?? null });
  };
  push(rows.find((row) => row.location_id === location.id), location.title);
  const group = location.groupId ? groupById.get(location.groupId) : null;
  if (group) {
    push(rows.find((row) => row.group_id === group.id), "Group");
    const parent = group.parent_id ? groupById.get(group.parent_id) : null;
    if (parent) push(rows.find((row) => row.group_id === parent.id), "Parent group");
  }
  if (location.clientId) {
    push(rows.find((row) => row.client_id === location.clientId), "Brand");
  }
  layers.push({
    label: "the organization",
    fields: asTone(workspaceRow.data?.tone),
    automation: asAutomation(workspaceRow.data?.automation),
  });
  return {
    tone: flattenTone(resolveTone(layers.map((layer) => ({ label: layer.label, fields: layer.fields })))),
    automation: flattenAutomation(
      resolveAutomation(layers.map((layer) => ({ label: layer.label, fields: layer.automation })))
    ),
  };
}

export async function assertAutomationAllowsPublish(input: {
  workspaceId: string;
  locationId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  replyText: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const [{ automation }, policy] = await Promise.all([
    resolvedForLocation(input.workspaceId, input.locationId),
    EscalationService.policy(input.workspaceId),
  ]);
  const pauses = await EscalationService.pausedTargets(input.workspaceId);
  const place = await createAdminClient()
    .from("grm_google_locations")
    .select("client_id")
    .eq("id", input.locationId)
    .maybeSingle();
  const paused =
    pauses.workspace ||
    pauses.locationIds.includes(input.locationId) ||
    Boolean(place.data?.client_id && pauses.clientIds.includes(place.data.client_id)) ||
    (await draftsPausedForLocation(input.workspaceId, input.locationId));
  const verdict = automationVerdict({
    settings: automation,
    stars: input.stars,
    comment: input.comment,
    createdAt: new Date(input.createdAt),
    now,
    paused,
    publishedToday: await publishedToday(input.workspaceId, input.locationId, now),
    timeZone: policy.timezone || "Asia/Kolkata",
    replyText: input.replyText,
  });
  if (!verdict.publish) {
    throw new ValidationError(verdict.reasons[0] ?? "Automation cannot post this reply.");
  }
}

async function publishedToday(workspaceId: string, locationId: string, now: Date): Promise<number> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const admin = createAdminClient();
  const { count } = await admin
    .from("grm_review_replies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("published_at", start.toISOString());
  const { data: reviews } = await admin
    .from("grm_reviews")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("location_id", locationId);
  if (!reviews?.length) return 0;
  const { count: local } = await admin
    .from("grm_review_replies")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("published_at", start.toISOString())
    .in("review_id", reviews.map((review) => review.id));
  return local ?? count ?? 0;
}

export async function runAutomation(workspaceId: string, now = new Date()): Promise<{
  drafted: number;
  published: number;
  held: number;
}> {
  const admin = createAdminClient();
  const owner = await admin
    .from("grm_workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  const actorId = owner.data?.user_id;
  if (!actorId) return { drafted: 0, published: 0, held: 0 };
  const overrides = await admin
    .from("grm_scope_settings")
    .select("automation")
    .eq("workspace_id", workspaceId);
  const workspace = await admin.from("grm_reply_settings").select("automation").eq("workspace_id", workspaceId).maybeSingle();
  const workspaceOn = asAutomation(workspace.data?.automation)?.enabled === true;
  const overrideOn = (overrides.data ?? []).some((row) => asAutomation(row.automation)?.enabled === true);
  if (!workspaceOn && !overrideOn) return { drafted: 0, published: 0, held: 0 };

  const [reviewsResult, places, policy] = await Promise.all([
    admin
      .from("grm_reviews")
      .select("id, location_id, star_rating, comment, review_create_time, reply_status")
      .eq("workspace_id", workspaceId)
      .gte("star_rating", 4)
      .eq("reply_status", "none")
      .order("review_create_time", { ascending: true })
      .limit(20),
    admin.from("grm_google_locations").select("id, client_id").eq("workspace_id", workspaceId),
    EscalationService.policy(workspaceId),
  ]);
  const reviews = reviewsResult.data;
  const clientOf = new Map((places.data ?? []).map((place) => [place.id, place.client_id]));
  const timeZone = policy.timezone || "Asia/Kolkata";
  let drafted = 0;
  let published = 0;
  let held = 0;
  for (const review of reviews ?? []) {
    try {
    const { automation } = await resolvedForLocation(workspaceId, review.location_id);
    const pauses = await EscalationService.pausedTargets(workspaceId);
    const clientId = clientOf.get(review.location_id) ?? null;
    const paused =
      pauses.workspace ||
      pauses.locationIds.includes(review.location_id) ||
      Boolean(clientId && pauses.clientIds.includes(clientId)) ||
      (await draftsPausedForLocation(workspaceId, review.location_id));
    const verdict = automationVerdict({
      settings: automation,
      stars: review.star_rating,
      comment: review.comment,
      createdAt: new Date(review.review_create_time),
      now,
      paused,
      publishedToday: await publishedToday(workspaceId, review.location_id, now),
      timeZone,
    });
    await AuditService.log({
      workspaceId,
      userId: actorId,
      action: verdict.publish ? "automation.ready" : "automation.held",
      entityType: "grm_reviews",
      entityId: review.id,
      metadata: { reasons: verdict.reasons, shadow: automation.shadowMode, paused },
    });
    if (!verdict.draft) {
      held += 1;
      continue;
    }
    if (!process.env.GEMINI_API_KEY) {
      held += 1;
      continue;
    }
    const { AIReviewService } = await import("@/lib/services/ai-review");
    const draft = await AIReviewService.generateDraft({
      reviewId: review.id,
      workspaceId,
      userId: actorId,
      automated: true,
    });
    drafted += 1;
    if (!verdict.publish || automation.shadowMode) {
      held += 1;
      continue;
    }
    const reply = await admin
      .from("grm_review_replies")
      .update({ status: "approved", approved_at: now.toISOString() })
      .eq("id", draft.replyId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (!reply.data) {
      held += 1;
      continue;
    }
    const { ReplyPublishingService } = await import("@/lib/services/reply-publishing");
    try {
      await ReplyPublishingService.publishReply(draft.replyId, review.id, workspaceId, actorId, { automated: true });
      published += 1;
    } catch {
      await admin
        .from("grm_review_replies")
        .update({ status: "draft", approved_at: null })
        .eq("id", draft.replyId)
        .neq("status", "published");
      held += 1;
    }
    } catch {
      held += 1;
    }
  }
  return { drafted, published, held };
}

export function previewReply(input: {
  tone: ToneValue;
  template: string | null;
  reviewerName: string;
  locationName: string;
  comment: string;
}) {
  return localPreview(input);
}

export { TONE_DEFAULTS, AUTOMATION_DEFAULTS };
