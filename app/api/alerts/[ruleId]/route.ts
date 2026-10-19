import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { actingUser, AlertService, guardReport } from "@/lib/services/reporting";
import { alertBodySchema, assertChannels, normalizeRecipients, readDeliveryEnv, scopeFromBody } from "@/lib/reporting";
import { parseBody, validateId } from "@/lib/validation";

async function idFrom(params: Promise<{ ruleId: string }>): Promise<string> {
  return validateId((await params).ruleId, "ruleId");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let ruleId: string;
  try {
    ruleId = await idFrom(params);
  } catch {
    return NextResponse.json({ error: "Invalid alert" }, { status: 400 });
  }
  try {
    const body = await parseBody(request, alertBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can edit an alert." }, { status: 403 });
    const existing = (await AlertService.list(actor.workspaceId)).rules.find((rule) => rule.id === ruleId);
    if (!existing) return NextResponse.json({ error: "That alert is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, existing);
    const scope = scopeFromBody(body.scope, body.scope === "workspace" ? null : body.scopeId);
    await guardReport(user.id, actor.workspaceId, scope);
    const roster = await getWorkspaceRoster(actor.workspaceId);
    const id = await AlertService.save(actor.workspaceId, actor.userId, ruleId, {
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let ruleId: string;
  try {
    ruleId = await idFrom(params);
  } catch {
    return NextResponse.json({ error: "Invalid alert" }, { status: 400 });
  }
  try {
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can delete an alert." }, { status: 403 });
    const existing = (await AlertService.list(actor.workspaceId)).rules.find((rule) => rule.id === ruleId);
    if (!existing) return NextResponse.json({ error: "That alert is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, existing);
    await AlertService.remove(actor.workspaceId, actor.userId, ruleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not delete the alert." }, { status: 500 });
  }
}
