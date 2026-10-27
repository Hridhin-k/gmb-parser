import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { saveRequestPolicy } from "@/lib/services/request-campaigns";
import { policyBodySchema } from "@/lib/review-requests";
import { parseBody } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, policyBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can change the request limit." }, { status: 403 });
    await saveRequestPolicy(actor.workspaceId, actor.userId, body.cooldownDays);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not save the request limit." }, { status: 500 });
  }
}
