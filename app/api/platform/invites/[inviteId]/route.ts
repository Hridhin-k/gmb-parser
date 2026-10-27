import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";
import { resendPlatformInvite, revokePlatformInvite } from "@/lib/services/platform";

interface RouteParams { params: Promise<{ inviteId: string }> }
const schema = z.object({ action: z.enum(["resend", "revoke"]) });

/** POST /api/platform/invites/[inviteId] — resend (new 7 days) or revoke a tenant invite. */
export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { inviteId: raw } = await params;
  let inviteId: string;
  try { inviteId = validateId(raw, "inviteId"); } catch { return NextResponse.json({ error: "Invalid invite ID" }, { status: 400 }); }
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    if (body.action === "resend") {
      const result = await resendPlatformInvite({ actor: user, inviteId });
      return NextResponse.json({ success: true, emailed: result.emailed });
    }
    await revokePlatformInvite({ actor: user, inviteId });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update that invite." }, { status: 500 });
  }
}
