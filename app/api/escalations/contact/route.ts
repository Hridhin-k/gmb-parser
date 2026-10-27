import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { EscalationContactStore } from "@/lib/services/escalations";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertScoped } from "@/lib/services/access";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.object({
  phone: z.string().trim().max(40),
  email: z.string().trim().max(320),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
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
    const contact = await EscalationContactStore.save(membership.workspace_id, user.id, body);
    return NextResponse.json({ ok: true, phone: contact.phone, email: contact.email });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
