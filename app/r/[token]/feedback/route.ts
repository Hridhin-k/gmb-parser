import { NextResponse } from "next/server";
import { savePublicFeedback } from "@/lib/services/request-campaigns";
import { feedbackBodySchema } from "@/lib/review-requests";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = new URL(`/r/${token}`, request.url);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.redirect(back);
  const form = await request.formData();
  const parsed = feedbackBodySchema.safeParse({ body: form.get("body") });
  if (!parsed.success) {
    back.searchParams.set("sent", "0");
    return NextResponse.redirect(back);
  }
  await savePublicFeedback(token, parsed.data.body);
  back.searchParams.set("sent", "1");
  return NextResponse.redirect(back);
}
