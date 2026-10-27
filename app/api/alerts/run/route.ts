import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser, AlertService } from "@/lib/services/reporting";

/** Checks the saved rules against current reviews and connections. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const actor = await actingUser(user);
    if (!actor.manager) return NextResponse.json({ error: "Only an owner or admin can run alert checks." }, { status: 403 });
    const opened = await AlertService.evaluateWorkspace(actor.workspaceId);
    return NextResponse.json({ opened });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    }
    return NextResponse.json({ error: "Could not check the alerts." }, { status: 500 });
  }
}
