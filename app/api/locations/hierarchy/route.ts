import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { actingUser } from "@/lib/services/reporting";
import {
  createHierarchyGroup,
  mergeHierarchyGroups,
  moveHierarchyLocations,
  removeEmptyGroup,
  renameHierarchyGroup,
  reviewDuplicate,
  saveScopeSettings,
  setLocationManager,
  setLocationTags,
} from "@/lib/services/hierarchy";
import type { SettingFields } from "@/lib/hierarchy";

const optionalText = z.string().trim().max(500).nullable().optional();

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-group"),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["region", "city"]),
    clientId: z.string().uuid().nullable(),
    parentId: z.string().uuid().nullable(),
    locationIds: z.array(z.string().uuid()).max(200).optional(),
    managerUserId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("rename-group"),
    groupId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("merge-groups"),
    sourceId: z.string().uuid(),
    targetId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("remove-group"),
    groupId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("move"),
    locationIds: z.array(z.string().uuid()).min(1).max(200),
    groupId: z.string().uuid().nullable(),
    confirmHold: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("tags"),
    locationId: z.string().uuid(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
  }),
  z.object({
    action: z.literal("manager"),
    locationId: z.string().uuid(),
    managerUserId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("settings"),
    scope: z.enum(["client", "group", "location"]),
    targetId: z.string().uuid(),
    toneVoice: z.enum(["warm", "professional", "brief"]).nullable(),
    toneNote: optionalText,
    slaHours: z.number().int().min(1).max(168).nullable(),
    routingLevel: z.enum(["store", "regional", "leadership"]).nullable(),
    draftsPaused: z.boolean().nullable(),
  }),
  z.object({
    action: z.literal("duplicate"),
    locationId: z.string().uuid(),
    duplicate: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const actor = await actingUser(user);
    const base = { workspaceId: actor.workspaceId, userId: actor.userId };
    if (body.action === "create-group") {
      const id = await createHierarchyGroup({
        ...base,
        name: body.name,
        kind: body.kind,
        clientId: body.clientId,
        parentId: body.parentId,
        locationIds: body.locationIds,
        managerUserId: body.managerUserId,
      });
      return NextResponse.json({ ok: true, id });
    } else if (body.action === "rename-group") {
      await renameHierarchyGroup({ ...base, groupId: body.groupId, name: body.name });
    } else if (body.action === "merge-groups") {
      await mergeHierarchyGroups({ ...base, sourceId: body.sourceId, targetId: body.targetId });
    } else if (body.action === "remove-group") {
      await removeEmptyGroup({ ...base, groupId: body.groupId });
    } else if (body.action === "move") {
      await moveHierarchyLocations({ ...base, locationIds: body.locationIds, groupId: body.groupId, confirmHold: Boolean(body.confirmHold) });
    } else if (body.action === "tags") {
      await setLocationTags({ ...base, locationId: body.locationId, tags: body.tags });
    } else if (body.action === "manager") {
      await setLocationManager({ ...base, locationId: body.locationId, managerUserId: body.managerUserId });
    } else if (body.action === "settings") {
      const fields: SettingFields = {
        toneVoice: body.toneVoice,
        toneNote: body.toneNote?.trim() ? body.toneNote.trim() : null,
        slaHours: body.slaHours,
        routingLevel: body.routingLevel,
        draftsPaused: body.draftsPaused,
      };
      await saveScopeSettings({ ...base, scope: body.scope, targetId: body.targetId, fields });
    } else {
      await reviewDuplicate({ ...base, locationId: body.locationId, duplicate: body.duplicate });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
