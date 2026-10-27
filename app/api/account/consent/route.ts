import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { AppError, toStatusCode, toUserMessage } from "@/lib/errors";
import { parseBody } from "@/lib/validation";
import { recordUserConsent } from "@/lib/services/consent";

const consentSchema = z.object({
  terms: z.literal(true),
  ai: z.literal(true),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await parseBody(request, consentSchema);
    await recordUserConsent(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: toUserMessage(error) },
      { status: toStatusCode(error) }
    );
  }
}
