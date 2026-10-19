import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser, guardReport, ReportService } from "@/lib/services/reporting";
import { validateId } from "@/lib/validation";

export async function POST(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let reportId: string;
  try {
    reportId = validateId((await params).reportId, "reportId");
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  try {
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can send a test." }, { status: 403 });
    const report = await ReportService.load(actor.workspaceId, reportId);
    if (!report) return NextResponse.json({ error: "That report is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, report);
    await ReportService.sendTest(actor.workspaceId, actor.userId, reportId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not send the test." }, { status: 500 });
  }
}
