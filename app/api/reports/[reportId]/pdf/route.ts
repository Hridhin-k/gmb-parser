import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser, guardReport, ReportService } from "@/lib/services/reporting";
import { validateId } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
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
    const report = await ReportService.load(actor.workspaceId, reportId);
    if (!report) return NextResponse.json({ error: "That report is not in this workspace." }, { status: 404 });
    await guardReport(user.id, actor.workspaceId, report);
    const file = await ReportService.pdf(actor.workspaceId, reportId);
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not build the PDF." }, { status: 500 });
  }
}
