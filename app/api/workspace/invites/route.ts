import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import {
  ensurePersonalWorkspace,
  inviteToWorkspace,
  revokeWorkspaceInvite,
} from "@/lib/services/workspace";

const createInviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  role: z.enum(["admin", "member"]).default("member"),
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

  let body: { email: string; role: "admin" | "member" };
  try {
    body = await parseBody(request, createInviteSchema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await inviteToWorkspace({
      workspaceId: membership.workspace_id,
      inviterId: user.id,
      email: body.email,
      role: body.role,
    });
    return NextResponse.json({ success: true });
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
