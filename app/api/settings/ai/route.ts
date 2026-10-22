import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AI_KNOWLEDGE_KINDS } from "@/lib/ai-config";
import {
  activateAiConfigVersion,
  createAiConfigVersion,
  deleteKnowledge,
  loadAiBoard,
  saveActiveAiSnapshot,
  upsertKnowledge,
} from "@/lib/services/ai-config";
import { previewAiDraft } from "@/lib/services/ai-preview";

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }),
  z.object({ kind: z.enum(["client", "group", "location"]), id: z.string().uuid() }),
]);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load") }),
  z.object({
    action: z.literal("save-org"),
    industry: z.string().max(200).optional(),
    positioning: z.string().max(800).optional(),
    priorities: z.string().max(800).optional(),
    policies: z.string().max(1200).optional(),
    legacyVoice: z.enum(["warm", "professional", "brief", ""]).optional(),
    legacyNote: z.string().max(500).optional(),
    label: z.string().max(80).optional(),
  }),
  z.object({
    action: z.literal("knowledge-save"),
    id: z.string().uuid().optional(),
    kind: z.enum(AI_KNOWLEDGE_KINDS),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(4000).optional().default(""),
    enabled: z.boolean().optional(),
    target: targetSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ action: z.literal("knowledge-delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("activate"), version: z.number().int().positive() }),
  z.object({
    action: z.literal("new-version"),
    label: z.string().max(80).optional(),
    activate: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("preview"),
    comment: z.string().trim().max(1000),
    reviewerName: z.string().trim().max(80).optional(),
    locationId: z.string().uuid().optional(),
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
    const membership = await ensurePersonalWorkspace(user);
    const workspaceId = membership.workspace_id;

    if (body.action === "load") {
      const board = await loadAiBoard(workspaceId, user.id);
      return NextResponse.json({ ok: true, ...board });
    }

    if (body.action === "save-org") {
      const active = await saveActiveAiSnapshot({
        workspaceId,
        userId: user.id,
        label: body.label,
        org: {
          industry: body.industry ?? "",
          positioning: body.positioning ?? "",
          priorities: body.priorities ?? "",
          policies: body.policies ?? "",
          legacyVoice: body.legacyVoice ?? "",
          legacyNote: body.legacyNote ?? "",
        },
      });
      return NextResponse.json({ ok: true, active });
    }

    if (body.action === "knowledge-save") {
      const row = await upsertKnowledge({
        workspaceId,
        userId: user.id,
        id: body.id,
        kind: body.kind,
        title: body.title,
        body: body.body ?? "",
        enabled: body.enabled,
        target: body.target,
        metadata: body.metadata,
      });
      return NextResponse.json({ ok: true, knowledge: row });
    }

    if (body.action === "knowledge-delete") {
      await deleteKnowledge({ workspaceId, userId: user.id, id: body.id });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "activate") {
      const active = await activateAiConfigVersion({
        workspaceId,
        userId: user.id,
        version: body.version,
      });
      return NextResponse.json({ ok: true, active });
    }

    if (body.action === "new-version") {
      const row = await createAiConfigVersion({
        workspaceId,
        userId: user.id,
        label: body.label,
        activate: body.activate,
      });
      return NextResponse.json({ ok: true, version: row });
    }

    const preview = await previewAiDraft({
      workspaceId,
      userId: user.id,
      comment: body.comment,
      reviewerName: body.reviewerName,
      locationId: body.locationId,
    });
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not update AI settings." }, { status: 500 });
  }
}
