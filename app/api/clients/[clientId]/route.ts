import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { issueOnboardingLink, setClientApproval, updateAgencyClient } from "@/lib/services/agency-clients";
import { ensurePersonalWorkspace } from "@/lib/services/workspace";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { bustCatalogCache } from "@/lib/services/catalog-tables";

const saveSchema = z.object({
  action: z.literal("save"),
  name: z.string(),
  contactEmail: z.string().optional().default(""),
  website: z.string().optional().default(""),
  brandName: z.string().optional().default(""),
  logoUrl: z.string().optional().default(""),
  accountManagerUserId: z.string().uuid().nullable().optional().default(null),
});

const linkSchema = z.object({ action: z.literal("onboarding") });
const approvalSchema = z.object({
  action: z.literal("approval"),
  reviewId: z.string().uuid(),
  decision: z.enum(["requested", "approved", "none"]),
});

const schema = z.discriminatedUnion("action", [saveSchema, linkSchema, approvalSchema]);

export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { clientId } = await context.params;
  try {
    const body = await parseBody(request, schema);
    const membership = await ensurePersonalWorkspace(user);
    if (body.action === "onboarding") {
      const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
      const link = await issueOnboardingLink({
        workspaceId: membership.workspace_id,
        userId: user.id,
        clientId,
        origin,
      });
      return NextResponse.json({ ok: true, url: link.url, expiresAt: link.expiresAt, emailed: false });
    }
    if (body.action === "approval") {
      await setClientApproval({
        workspaceId: membership.workspace_id,
        userId: user.id,
        reviewId: body.reviewId,
        decision: body.decision,
      });
      bustCatalogCache();
      return NextResponse.json({ ok: true });
    }
    await updateAgencyClient({
      workspaceId: membership.workspace_id,
      userId: user.id,
      clientId,
      client: body,
    });
    bustCatalogCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
}
