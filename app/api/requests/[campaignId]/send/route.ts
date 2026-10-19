import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { sendRequestCampaign } from "@/lib/services/request-campaigns";
import { validateId } from "@/lib/validation";

export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
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
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can send a request." }, { status: 403 });
    const result = await sendRequestCampaign(actor.workspaceId, actor.userId, campaignId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not send the request." }, { status: 500 });
  }
}
