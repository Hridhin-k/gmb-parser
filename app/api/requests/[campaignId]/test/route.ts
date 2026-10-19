import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { sendRequestTest } from "@/lib/services/request-campaigns";
import { testBodySchema } from "@/lib/review-requests";
import { parseBody, validateId } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let campaignId: string;
  try {
    campaignId = validateId((await params).campaignId, "campaignId");
  } catch {
    return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
  }
  try {
    const body = await parseBody(request, testBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can send a test." }, { status: 403 });
    await sendRequestTest(actor.workspaceId, actor.userId, user.email ?? null, campaignId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not send the test." }, { status: 500 });
  }
}
