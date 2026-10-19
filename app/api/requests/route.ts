import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { saveRequestCampaign } from "@/lib/services/request-campaigns";
import { campaignBodySchema } from "@/lib/review-requests";
import { parseBody } from "@/lib/validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, campaignBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can create a request." }, { status: 403 });
    const id = await saveRequestCampaign(actor.workspaceId, actor.userId, {
      name: body.name,
      channel: body.channel,
      language: body.language,
      template: body.template,
      reminder: body.reminder,
      locationIds: body.locationIds,
      csv: body.csv,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not save the request." }, { status: 500 });
  }
}
