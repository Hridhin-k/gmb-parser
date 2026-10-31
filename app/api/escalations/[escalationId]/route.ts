import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { EscalationService } from "@/lib/services/escalations";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertEscalationAction } from "@/lib/services/access";
import { RESOLUTION_ACTIONS, FOLLOW_UP_OUTCOMES, ESCALATION_LEVELS, type ResolutionCode } from "@/lib/escalations";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    userId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    expectedUpdatedAt: z.string().min(10).max(40),
  }),
  z.object({
    action: z.literal("level"),
    level: z.enum(ESCALATION_LEVELS.map((item) => item.id) as ["store", "regional", "leadership"]),
  }),
  z.object({
    action: z.literal("resolve"),
    code: z.enum(FOLLOW_UP_OUTCOMES.map((item) => item.id) as [ResolutionCode, ...ResolutionCode[]]),
    note: z.string().trim().max(2000),
  }),
  z.object({
    action: z.literal("next"),
    code: z.enum(RESOLUTION_ACTIONS.map((item) => item.id) as [
      "apology_callback",
      "replacement_arranged",
      "store_visit_scheduled",
    ]),
  }),
  z.object({
    action: z.literal("start"),
  }),
  z.object({
    action: z.literal("comment"),
    body: z.string().trim().min(1).max(2000),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ escalationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let escalationId: string;
  try {
    escalationId = validateId((await params).escalationId, "escalationId");
  } catch {
    return NextResponse.json({ error: "Invalid escalation ID" }, { status: 400 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = await parseBody(request, schema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await assertEscalationAction({
      userId: user.id,
      workspaceId: membership.workspace_id,
      escalationId,
      permission: body.action === "level" ? "approve_negative" : "draft",
    });
    if (body.action === "assign") {
      await EscalationService.assign({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
        assigneeId: body.userId,
        reason: body.reason,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
    } else if (body.action === "level") {
      await EscalationService.changeLevel({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
        level: body.level,
      });
    } else if (body.action === "next") {
      await EscalationService.markNextStep({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
        code: body.code,
      });
    } else if (body.action === "start") {
      await EscalationService.start({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
      });
    } else if (body.action === "comment") {
      await EscalationService.comment({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
        body: body.body,
      });
    } else {
      await EscalationService.resolve({
        workspaceId: membership.workspace_id,
        escalationId,
        actorId: user.id,
        code: body.code,
        note: body.note,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
