import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { hasUserConsent } from "@/lib/services/consent";
import { createTenantWorkspace } from "@/lib/services/workspace";

const schema = z.object({ name: z.string().trim().min(1).max(255) });

/** POST /api/platform/tenant — platform-invited owner names & creates their one tenant. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await hasUserConsent(user.id))) {
    return NextResponse.json({ error: "Accept the terms first." }, { status: 403 });
  }
  let body: z.infer<typeof schema>;
  try {
    body = await parseBody(request, schema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    const workspace = await createTenantWorkspace(user, body.name);
    return NextResponse.json({ success: true, workspaceId: workspace.workspace_id }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not create your organization." }, { status: 500 });
  }
}
