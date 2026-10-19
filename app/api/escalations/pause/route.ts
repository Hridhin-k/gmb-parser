import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { EscalationService } from "@/lib/services/escalations";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { assertScoped } from "@/lib/services/access";
import { toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.object({
  scope: z.enum(["workspace", "client", "location"]),
  clientId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  paused: z.boolean(),
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

  if (body.scope === "workspace" && (body.clientId || body.locationId)) {
    return NextResponse.json({ error: "A workspace pause has no client or location." }, { status: 400 });
  }
  if (body.scope === "client" && !body.clientId) {
    return NextResponse.json({ error: "Choose a client to pause." }, { status: 400 });
  }
  if (body.scope === "location" && !body.locationId) {
    return NextResponse.json({ error: "Choose a location to pause." }, { status: 400 });
  }

  try {
    const membership = await ensurePersonalWorkspace(user);
    await assertScoped({
      userId: user.id,
      workspaceId: membership.workspace_id,
      permission: "edit_rules",
      target:
        body.scope === "client"
          ? { kind: "client", id: body.clientId! }
          : body.scope === "location"
            ? { kind: "location", id: body.locationId! }
            : { kind: "workspace" },
    });
    await EscalationService.setPause({
      workspaceId: membership.workspace_id,
      userId: user.id,
      scope: body.scope,
      clientId: body.scope === "client" ? body.clientId : null,
      locationId: body.scope === "location" ? body.locationId : null,
      paused: body.paused,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
