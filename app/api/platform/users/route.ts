import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { setUserBlocked } from "@/lib/services/platform";

const schema = z.object({ email: z.string().trim().min(3).max(320), blocked: z.boolean(), reason: z.string().trim().max(500).optional().nullable() });

/** POST /api/platform/users — block or unblock a user platform-wide by email. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await setUserBlocked({ actor: user, email: body.email, blocked: body.blocked, reason: body.reason ?? null });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update that user." }, { status: 500 });
  }
}
