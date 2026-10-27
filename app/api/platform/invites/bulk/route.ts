import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { bulkCreatePlatformInvites } from "@/lib/services/platform";

const schema = z.object({ emails: z.array(z.string().trim().min(3).max(320)).min(1).max(100) });

/** POST /api/platform/invites/bulk — invite many tenant owners at once (paste or CSV-derived list). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    const results = await bulkCreatePlatformInvites({ inviter: user, emails: body.emails });
    return NextResponse.json({ success: true, results });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not create those invites." }, { status: 500 });
  }
}
