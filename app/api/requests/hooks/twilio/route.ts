import { NextResponse } from "next/server";
import { readRequestEnv, verifyTwilioSignature } from "@/lib/review-requests";
import { applyProviderReceipt } from "@/lib/services/request-campaigns";

export async function POST(request: Request) {
  const env = readRequestEnv(process.env);
  if (!env.twilioToken) {
    return NextResponse.json({ error: "No SMS delivery receipt is configured." }, { status: 503 });
  }
  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!verifyTwilioSignature(request.url, params, signature, env.twilioToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const ref = params.MessageSid;
  const status = (params.MessageStatus ?? "").toLowerCase();
  if (!ref) return NextResponse.json({ ok: true });
  if (status === "delivered" || status === "read") await applyProviderReceipt(ref, "delivered", "The SMS provider confirmed delivery.");
  else if (status === "undelivered" || status === "failed") await applyProviderReceipt(ref, "failed", "The SMS provider could not deliver the message.");
  return NextResponse.json({ ok: true });
}
