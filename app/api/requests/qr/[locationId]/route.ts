import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { qrDownload } from "@/lib/services/request-campaigns";
import { validateId } from "@/lib/validation";

export async function GET(request: Request, { params }: { params: Promise<{ locationId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let locationId: string;
  try {
    locationId = validateId((await params).locationId, "locationId");
  } catch {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }
  const format = new URL(request.url).searchParams.get("format") === "pdf" ? "pdf" : "svg";
  try {
    const actor = await actingUser(user);
    const file = await qrDownload(actor.workspaceId, format, locationId);
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=300",
        ...(format === "pdf" ? { "Content-Disposition": `attachment; filename="${file.filename}"` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not build the QR code." }, { status: 500 });
  }
}
