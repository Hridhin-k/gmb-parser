import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { ASSIGNABLE_ROLES, coerceAssignableRole } from "@/lib/access";
import {
  ensurePersonalWorkspace,
  inviteToWorkspace,
  resendWorkspaceInvite,
  revokeWorkspaceInvite,
} from "@/lib/services/workspace";

const createInviteSchema = z.object({
  email: z.string().trim().min(3).max(320),
  role: z.preprocess(coerceAssignableRole, z.enum(ASSIGNABLE_ROLES)),
  clientId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
});

const revokeInviteSchema = z.object({
  inviteId: z.string().uuid("That invite is invalid."),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof createInviteSchema>;
  try {
    body = await parseBody(request, createInviteSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    const result = await inviteToWorkspace({
      workspaceId: membership.workspace_id,
      inviterId: user.id,
      email: body.email,
      role: body.role,
      scope: {
        clientId: body.clientId ?? null,
        groupId: body.groupId ?? null,
        locationId: body.locationId ?? null,
      },
    });
    return NextResponse.json({ success: true, emailed: result.emailed });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not create the invite." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { inviteId: string };
  try {
    body = await parseBody(request, revokeInviteSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await revokeWorkspaceInvite({
      workspaceId: membership.workspace_id,
      actorId: user.id,
      inviteId: body.inviteId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not cancel the invite." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { inviteId: string };
  try {
    body = await parseBody(request, revokeInviteSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    const result = await resendWorkspaceInvite({
      workspaceId: membership.workspace_id,
      actorId: user.id,
      inviteId: body.inviteId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Could not resend the invite." }, { status: 500 });
  }
}
