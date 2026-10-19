import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { actingUser } from "@/lib/services/reporting";
import { qrDownload } from "@/lib/services/request-campaigns";
import { listReviewRequestLocations } from "@/lib/services/review-requests";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const actor = await actingUser(user);
    const url = new URL(request.url);
    const client = url.searchParams.get("client") ?? "";
    const locations = UUID.test(client) ? await listReviewRequestLocations(actor.workspaceId, client) : null;
    const file = await qrDownload(
      actor.workspaceId,
      "pdf",
      null,
      locations ? locations.map((location) => location.id) : null
    );
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
    return NextResponse.json({ error: "Could not build the QR cards." }, { status: 500 });
  }
}
