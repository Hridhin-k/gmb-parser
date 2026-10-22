import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { submitAccessRequest } from "@/lib/services/platform";

const schema = z.object({ company: z.string().trim().max(255).optional().nullable(), message: z.string().trim().max(1000).optional().nullable() });

/** POST /api/platform/access-requests — signed-in uninvited user asks for a tenant invite. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await submitAccessRequest({ user, company: body.company ?? null, message: body.message ?? null });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not submit your request." }, { status: 500 });
  }
}
