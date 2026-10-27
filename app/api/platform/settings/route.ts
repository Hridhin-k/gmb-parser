import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { setMaintenance } from "@/lib/services/platform";

const schema = z.object({ enabled: z.boolean(), message: z.string().trim().max(500).optional().nullable() });

/** POST /api/platform/settings — maintenance mode for the tenant app (super admins unaffected). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await setMaintenance({ actor: user, enabled: body.enabled, message: body.message ?? null });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not update maintenance mode." }, { status: 500 });
  }
}
