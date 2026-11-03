import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertCanAssignReviews } from "@/lib/services/access";
import { assignInsightAction, isActionId, unassignInsightAction } from "@/lib/services/insight-assignments";
import { AppError, toErrorCode, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const bodySchema = z.object({
  actionId: z.string().refine(isActionId, "Unknown action"),
  title: z.string().trim().min(1).max(400),
  assigneeId: z.string().uuid().nullable(),
});

/**
 * POST /api/insights/assignments
 *
 * Gives a suggested action from Insights to a teammate, or takes it back
 * (`assigneeId: null`). Same rule as assigning a review: members cannot
 * assign, and the assignee must belong to this workspace.
 */
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
    const workspaceId = membership.workspace_id as string;
    await assertCanAssignReviews(user.id, workspaceId);
    if (body.assigneeId) {
      const member = await createAdminClient()
        .from("grm_workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", body.assigneeId)
        .maybeSingle();
      if (member.error || !member.data) {
        return NextResponse.json({ error: "That person is not in this workspace." }, { status: 400 });
      }
      await assignInsightAction(workspaceId, user.id, {
        actionId: body.actionId,
        title: body.title,
        assigneeId: body.assigneeId,
      });
    } else {
      await unassignInsightAction(workspaceId, body.actionId);
    }
    await AuditService.log({
      workspaceId,
      userId: user.id,
      action: body.assigneeId ? "insight.action_assigned" : "insight.action_unassigned",
      entityType: "grm_insight_assignments",
      entityId: body.actionId,
      metadata: { assigneeId: body.assigneeId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : toStatusCode(error);
    return NextResponse.json({ error: toUserMessage(error), code: toErrorCode(error) }, { status });
  }
}
