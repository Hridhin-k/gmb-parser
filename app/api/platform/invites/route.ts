import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { createPlatformInvite } from "@/lib/services/platform";

const schema = z.object({
  email: z.string().trim().min(3).max(320),
  note: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/platform/invites — super admin invites one tenant owner email (7-day, one tenant). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try {
    body = await parseBody(request, schema);
  } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    const result = await createPlatformInvite({ inviter: user, email: body.email, note: body.note ?? null });
    return NextResponse.json({ success: true, invite: result.invite, emailed: result.emailed }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not create the invite." }, { status: 500 });
  }
}
