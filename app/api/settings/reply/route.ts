import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import {
  deleteTemplate,
  loadReplySettings,
  previewReply,
  saveReplySettings,
  saveTemplate,
} from "@/lib/services/reply-settings";
import { flattenTone, WARMTH, REPLY_LENGTHS, REPLY_LANGUAGES } from "@/lib/automation";

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }),
  z.object({ kind: z.enum(["client", "group", "location"]), id: z.string().uuid() }),
]);

const spelling = z.object({
  term: z.string().trim().max(40),
  spelling: z.string().trim().max(40),
});

const toneSchema = z.object({
  greeting: z.string().trim().max(80).nullable(),
  signoff: z.string().trim().max(80).nullable(),
  warmth: z.enum(WARMTH).nullable(),
  length: z.enum(REPLY_LENGTHS).nullable(),
  languages: z.array(z.enum(REPLY_LANGUAGES.map((item) => item.id) as ["en", "ml", "hi", "ar"])).max(4).nullable(),
  neverSay: z.array(z.string().trim().min(1).max(80)).max(20).nullable(),
  spellings: z.array(spelling).max(20).nullable(),
});

const automationSchema = z.object({
  enabled: z.boolean().nullable(),
  minStars: z.number().int().min(4).max(5).nullable(),
  excludeQuestions: z.boolean().nullable(),
  dailyCap: z.number().int().min(1).max(100).nullable(),
  holdbackMinutes: z.number().int().min(0).max(10080).nullable(),
  windowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  windowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  shadowMode: z.boolean().nullable(),
  varyWording: z.boolean().nullable(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    target: targetSchema,
    tone: toneSchema,
    automation: automationSchema,
  }),
  z.object({ action: z.literal("clear"), target: targetSchema }),
  z.object({
    action: z.literal("template"),
    target: targetSchema,
    name: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal("delete-template"), templateId: z.string().uuid() }),
  z.object({
    action: z.literal("preview"),
    target: targetSchema,
    comment: z.string().trim().max(1000),
    reviewerName: z.string().trim().max(80).optional(),
    templateId: z.string().uuid().nullable().optional(),
  }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
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
    if (body.action === "save") {
      await saveReplySettings({
        workspaceId,
        userId: user.id,
        target: body.target,
        tone: body.tone,
        automation: body.automation,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "clear") {
      if (body.target.kind === "workspace") {
        return NextResponse.json({ error: "Organization settings can be changed, not cleared." }, { status: 400 });
      }
      await saveReplySettings({
        workspaceId,
        userId: user.id,
        target: body.target,
        tone: null,
        automation: null,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "template") {
      await saveTemplate({
        workspaceId,
        userId: user.id,
        target: body.target,
        name: body.name,
        body: body.body,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete-template") {
      await deleteTemplate({ workspaceId, userId: user.id, templateId: body.templateId });
      return NextResponse.json({ ok: true });
    }
    const loaded = await loadReplySettings(workspaceId, body.target);
    const template = loaded.templates.find((item) => item.id === body.templateId) ?? loaded.templates[0] ?? null;
    const preview = previewReply({
      tone: flattenTone(loaded.tone),
      template: template?.body ?? null,
      reviewerName: body.reviewerName?.trim() || "Anjali",
      locationName: loaded.label,
      comment: body.comment,
    });
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }
}
