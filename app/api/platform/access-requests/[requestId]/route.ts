import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody, validateId } from "@/lib/validation";
import { decideAccessRequest } from "@/lib/services/platform";

interface RouteParams { params: Promise<{ requestId: string }> }
const schema = z.object({ approve: z.boolean() });

/** POST /api/platform/access-requests/[requestId] — approve (creates tenant invite) or deny. */
export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { requestId: raw } = await params;
  let requestId: string;
  try { requestId = validateId(raw, "requestId"); } catch { return NextResponse.json({ error: "Invalid request ID" }, { status: 400 }); }
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    const result = await decideAccessRequest({ actor: user, requestId, approve: body.approve });
    return NextResponse.json({ success: true, emailed: result.emailed });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not decide that request." }, { status: 500 });
  }
}
