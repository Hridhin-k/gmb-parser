import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { ASSIGNABLE_ROLES, coerceAssignableRole } from "@/lib/access";
import {
  changeMemberRole,
  ensurePersonalWorkspace,
  removeMember,
  updateMemberAccess,
} from "@/lib/services/workspace";

const changeRoleSchema = z.object({
  userId: z.string().uuid("That member is invalid."),
  role: z.preprocess(coerceAssignableRole, z.enum(ASSIGNABLE_ROLES).optional()),
  clientId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  accessEnabled: z.boolean().optional(),
  alertEmail: z.boolean().optional(),
  alertInApp: z.boolean().optional(),
});

const removeSchema = z.object({
  userId: z.string().uuid("That member is invalid."),
});

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** PATCH /api/workspace/members — change a member's role. */
export async function PATCH(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof changeRoleSchema>;
  try {
    body = await parseBody(request, changeRoleSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    if (body.role) {
      const scopeFields = ["clientId", "groupId", "locationId"] as const;
      const hasScope = scopeFields.some((key) => key in body);
      await changeMemberRole({
        workspaceId: membership.workspace_id,
        actorId: user.id,
        targetUserId: body.userId,
        role: body.role,
        scope: hasScope
          ? {
              clientId: body.clientId ?? null,
              groupId: body.groupId ?? null,
              locationId: body.locationId ?? null,
            }
          : undefined,
      });
    }
    const scopeFields = ["clientId", "groupId", "locationId"] as const;
    const hasScope = scopeFields.some((key) => key in body);
    if (!body.role && (hasScope || body.accessEnabled !== undefined || body.alertEmail !== undefined || body.alertInApp !== undefined)) {
      await updateMemberAccess({
        workspaceId: membership.workspace_id,
        actorId: user.id,
        targetUserId: body.userId,
        scope: hasScope
          ? {
              clientId: body.clientId ?? null,
              groupId: body.groupId ?? null,
              locationId: body.locationId ?? null,
            }
          : undefined,
        accessEnabled: body.accessEnabled,
        alertEmail: body.alertEmail,
        alertInApp: body.alertInApp,
      });
    } else if (body.accessEnabled !== undefined || body.alertEmail !== undefined || body.alertInApp !== undefined) {
      await updateMemberAccess({
        workspaceId: membership.workspace_id,
        actorId: user.id,
        targetUserId: body.userId,
        accessEnabled: body.accessEnabled,
        alertEmail: body.alertEmail,
        alertInApp: body.alertInApp,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Could not change the role.");
  }
}

/** DELETE /api/workspace/members — remove a member, or leave when it is your own id. */
export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof removeSchema>;
  try {
    body = await parseBody(request, removeSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await removeMember({
      workspaceId: membership.workspace_id,
      actorId: user.id,
      targetUserId: body.userId,
    });
    return NextResponse.json({ success: true, left: body.userId === user.id });
  } catch (error) {
    return errorResponse(error, "Could not remove that person.");
  }
}
