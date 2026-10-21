import { NextResponse } from "next/server";
import { validateId } from "@/lib/validation";
import { getActiveWorkspace } from "@/lib/services/session";
import { markNoticeRead } from "@/lib/services/notifications";

interface RouteParams {
  params: Promise<{ noticeId: string }>;
}

/** POST /api/notifications/[noticeId]/read — the signed-in person marks their own notice read. */
export async function POST(_request: Request, { params }: RouteParams) {
  let workspaceId: string;
  let userId: string;
  try {
    const active = await getActiveWorkspace();
    workspaceId = active.workspaceId;
    userId = active.user.id;
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { noticeId: raw } = await params;
  let noticeId: string;
  try {
    noticeId = validateId(raw, "noticeId");
  } catch {
    return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
  }
  try {
    await markNoticeRead(workspaceId, userId, noticeId);
  } catch {
    return NextResponse.json({ error: "Could not update that notification." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
