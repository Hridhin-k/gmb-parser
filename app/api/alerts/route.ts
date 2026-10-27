import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { actingUser, AlertService, guardReport } from "@/lib/services/reporting";
import { alertBodySchema, assertChannels, normalizeRecipients, readDeliveryEnv, scopeFromBody } from "@/lib/reporting";
import { parseBody } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await parseBody(request, alertBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can save an alert." }, { status: 403 });
    const roster = await getWorkspaceRoster(actor.workspaceId);
    const scope = scopeFromBody(body.scope, body.scope === "workspace" ? null : body.scopeId);
    await guardReport(user.id, actor.workspaceId, scope);
    const id = await AlertService.save(actor.workspaceId, actor.userId, null, {
      name: body.name,
      kind: body.kind,
      ...scope,
      enabled: body.enabled,
      recipients: normalizeRecipients(body.recipients, roster.members.map((member) => member.email)),
      channels: assertChannels(body.channels, readDeliveryEnv(process.env)),
      threshold: body.threshold,
      windowDays: body.windowDays,
      minReviews: body.minReviews,
      dropPoints: body.dropPoints,
      multiplier: body.multiplier,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not save the alert." }, { status: 500 });
  }
}
