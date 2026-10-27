import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { actingUser, guardReport, ReportService } from "@/lib/services/reporting";
import { assertChannels, normalizeRecipients, readDeliveryEnv, reportBodySchema, scopeFromBody } from "@/lib/reporting";
import { parseBody, validateId } from "@/lib/validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }

  try {
    const body = await parseBody(request, reportBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) {
      return NextResponse.json({ error: "Only an owner or admin can edit a report." }, { status: 403 });
    }
    const existing = await ReportService.load(actor.workspaceId, reportId);
    if (!existing) return NextResponse.json({ error: "That report is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, existing);
    const nextScope = scopeFromBody(body.scope, body.scope === "workspace" ? null : body.scopeId);
    await guardReport(user.id, actor.workspaceId, nextScope);
    const roster = await getWorkspaceRoster(actor.workspaceId);
    const id = await ReportService.save(actor.workspaceId, actor.userId, reportId, {
      name: body.name,
      ...nextScope,
      sections: body.sections,
      frequency: body.frequency,
      deliveryTime: body.deliveryTime,
      timezone: body.timezone,
      weekday: body.frequency === "weekly" ? body.weekday : null,
      dayOfMonth: body.frequency === "monthly" ? body.dayOfMonth : null,
      recipients: normalizeRecipients(body.recipients, roster.members.map((member) => member.email)),
      channels: assertChannels(body.channels, readDeliveryEnv(process.env)),
      enabled: body.enabled,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not save the report." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  try {
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can delete a report." }, { status: 403 });
    const existing = await ReportService.load(actor.workspaceId, reportId);
    if (!existing) return NextResponse.json({ error: "That report is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, existing);
    await ReportService.remove(actor.workspaceId, actor.userId, reportId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not delete the report." }, { status: 500 });
  }
}
