import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { createAnnouncement } from "@/lib/services/platform";

const schema = z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(2000), tone: z.enum(["info", "warning"]).default("info") });

/** POST /api/platform/announcements — publish a banner shown in every tenant. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: z.infer<typeof schema>;
  try { body = await parseBody(request, schema); } catch (error) {
    return NextResponse.json({ error: toUserMessage(error) }, { status: toStatusCode(error) });
  }
  try {
    await createAnnouncement({ actor: user, title: body.title, body: body.body, tone: body.tone });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: "Could not publish the announcement." }, { status: 500 });
  }
}
