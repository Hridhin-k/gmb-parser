import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertScoped } from "@/lib/services/access";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.object({
  target: z.number().int().min(1).max(100).nullable(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = await parseBody(request, schema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await assertScoped({
      userId: user.id,
      workspaceId: membership.workspace_id,
      permission: "edit_rules",
      target: { kind: "workspace" },
    });
    const admin = createAdminClient();
    const { error } = await admin.from("grm_escalation_policies").upsert({
      workspace_id: membership.workspace_id,
      reply_rate_target: body.target === null ? null : body.target / 100,
      updated_at: new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: "Could not save the reply target." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
