import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { saveAgencyBranding, verifyAgencyDomain } from "@/lib/services/agency-branding";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    logoUrl: z.string().optional().default(""),
    hideProductName: z.boolean(),
    customDomain: z.string().optional().default(""),
    senderEmail: z.string().optional().default(""),
  }),
  z.object({ action: z.literal("verify-domain") }),
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, schema);
    const membership = await ensurePersonalWorkspace(user);
    if (body.action === "verify-domain") {
      const result = await verifyAgencyDomain(membership.workspace_id, user.id);
      if (!result.matched) {
        return NextResponse.json({ error: "The TXT record was not found yet." }, { status: 400 });
      }
      return NextResponse.json({ ok: true, matched: true });
    }
    await saveAgencyBranding({
      workspaceId: membership.workspace_id,
      userId: user.id,
      logoUrl: body.logoUrl,
      hideProductName: body.hideProductName,
      customDomain: body.customDomain,
      senderEmail: body.senderEmail,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
