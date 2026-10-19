import { NextResponse } from "next/server";
import { readRequestEnv, verifyResendSignature } from "@/lib/review-requests";
import { applyProviderReceipt } from "@/lib/services/request-campaigns";

export async function POST(request: Request) {
  const env = readRequestEnv(process.env);
  if (!env.resendWebhookSecret) {
    return NextResponse.json({ error: "No email delivery receipt is configured." }, { status: 503 });
  }
  const body = await request.text();
  const ok = verifyResendSignature(
    body,
    request.headers.get("svix-id") ?? "",
    request.headers.get("svix-timestamp") ?? "",
    request.headers.get("svix-signature") ?? "",
    env.resendWebhookSecret
  );
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const payload = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  const ref = payload.data?.email_id;
  if (!ref) return NextResponse.json({ ok: true });
  if (payload.type === "email.delivered") await applyProviderReceipt(ref, "delivered", "The email provider confirmed delivery.");
  else if (payload.type === "email.opened") await applyProviderReceipt(ref, "opened", "The email provider reported an open.");
  else if (payload.type === "email.bounced" || payload.type === "email.failed") {
    await applyProviderReceipt(ref, "failed", "The email provider could not deliver the message.");
  }
  return NextResponse.json({ ok: true });
}
