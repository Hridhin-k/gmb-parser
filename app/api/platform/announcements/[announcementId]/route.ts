import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";
import { setAnnouncementActive } from "@/lib/services/platform";

interface RouteParams { params: Promise<{ announcementId: string }> }
const schema = z.object({ active: z.boolean() });

export async function POST(request: Request, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { announcementId: raw } = await params;
  let id: string;
  try { id = validateId(raw, "announcementId"); } catch { return NextResponse.json({ error: "Invalid announcement ID" }, { status: 400 }); }
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await setAnnouncementActive({ actor: user, id, active: body.active });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update the announcement." }, { status: 500 });
  }
}
