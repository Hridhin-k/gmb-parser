import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { isAttentionAlertId, markAttentionSeen } from "@/lib/services/attention";
import { toStatusCode, toUserMessage } from "@/lib/errors";

const bodySchema = z.object({
  kind: z.enum(["review", "escalation", "alert"]),
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().max(500).nullable().optional(),
});

/** POST /api/attention/seen — this person opened a review, escalation, or bell item. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "That item is invalid." }, { status: 400 });
  }
  if (body.kind === "alert" && !isAttentionAlertId(body.id)) {
    return NextResponse.json({ error: "That notification is invalid." }, { status: 400 });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await markAttentionSeen({
      workspaceId: membership.workspace_id,
      userId: user.id,
      kind: body.kind,
      id: body.id,
      title: body.title,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that count.";
    return NextResponse.json({ error: toUserMessage(error) || message }, { status: toStatusCode(error) });
  }
}
