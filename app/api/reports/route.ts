import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { actingUser, guardReport, ReportService } from "@/lib/services/reporting";
import { assertChannels, normalizeRecipients, readDeliveryEnv, reportBodySchema, scopeFromBody } from "@/lib/reporting";
import { parseBody } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await parseBody(request, reportBodySchema);
    const actor = await actingUser(user);
    if (!actor.manager) {
      return NextResponse.json({ error: "Only an owner or admin can schedule a report." }, { status: 403 });
    }
    const roster = await getWorkspaceRoster(actor.workspaceId);
    const scope = scopeFromBody(body.scope, body.scope === "workspace" ? null : body.scopeId);
    await guardReport(user.id, actor.workspaceId, scope);
    const input = {
      name: body.name,
      ...scope,
      sections: body.sections,
      frequency: body.frequency,
      deliveryTime: body.deliveryTime,
      timezone: body.timezone,
      weekday: body.frequency === "weekly" ? body.weekday : null,
      dayOfMonth: body.frequency === "monthly" ? body.dayOfMonth : null,
      recipients: normalizeRecipients(body.recipients, roster.members.map((member) => member.email)),
      channels: assertChannels(body.channels, readDeliveryEnv(process.env)),
      enabled: body.enabled,
    };
    const id = await ReportService.save(actor.workspaceId, actor.userId, null, input);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not save the report." }, { status: 500 });
  }
}
