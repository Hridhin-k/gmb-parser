import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toErrorCode, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { bustCatalogCache } from "@/lib/services/catalog-tables";
import { advanceLocalDemo } from "@/lib/services/local-demo";
import {
  applyCsvGrouping,
  applyGrouping,
  completeOnboarding,
  createLocationGroup,
  mergeLocationGroups,
  moveLocationToGroup,
  renameLocationGroup,
  saveOnboardingStep,
  saveReplyTone,
} from "@/lib/services/onboarding";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("demo-connect") }),
  z.object({ action: z.literal("demo-import") }),
  z.object({
    action: z.literal("progress"),
    step: z.enum(["connect", "import", "groups", "tone", "invite"]),
  }),
  z.object({
    action: z.literal("grouping"),
    mode: z.enum(["state_city", "city", "account", "none"]),
    confirm: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("csv"),
    csv: z.string().max(200_000),
    confirm: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("create-group"),
    name: z.string().trim().min(1).max(120),
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
    action: z.literal("move-location"),
    locationId: z.string().uuid(),
    groupId: z.string().uuid().nullable(),
    confirmHold: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("tone"),
    voice: z.enum(["warm", "professional", "brief"]),
    note: z.string().trim().max(500),
  }),
  z.object({ action: z.literal("complete") }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    const workspaceId = membership.workspace_id;

    if (body.action === "demo-connect" || body.action === "demo-import") {
      await advanceLocalDemo(workspaceId, user.id, body.action);
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "progress") {
      await saveOnboardingStep(workspaceId, user.id, body.step);
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "grouping") {
      const result = await applyGrouping({
        workspaceId,
        userId: user.id,
        mode: body.mode,
        confirm: body.confirm === true,
      });
      return NextResponse.json(result);
    }
    if (body.action === "csv") {
      const result = await applyCsvGrouping({
        workspaceId,
        userId: user.id,
        csv: body.csv,
        confirm: body.confirm === true,
      });
      return NextResponse.json(result);
    }
    if (body.action === "create-group") {
      await createLocationGroup({ workspaceId, userId: user.id, name: body.name });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "rename-group") {
      await renameLocationGroup({
        workspaceId,
        userId: user.id,
        groupId: body.groupId,
        name: body.name,
      });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "merge-groups") {
      await mergeLocationGroups({
        workspaceId,
        userId: user.id,
        sourceId: body.sourceId,
        targetId: body.targetId,
      });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "move-location") {
      await moveLocationToGroup({
        workspaceId,
        userId: user.id,
        locationId: body.locationId,
        groupId: body.groupId,
        confirmHold: body.confirmHold === true,
      });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "tone") {
      await saveReplyTone({
        workspaceId,
        userId: user.id,
        voice: body.voice,
        note: body.note,
      });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    await completeOnboarding(workspaceId, user.id);
    bustCatalogCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : toStatusCode(error);
    return NextResponse.json(
      { error: toUserMessage(error), code: toErrorCode(error) },
      { status }
    );
  }
}
