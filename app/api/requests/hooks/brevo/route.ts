import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readRequestEnv } from "@/lib/review-requests";
import { applyProviderReceipt } from "@/lib/services/request-campaigns";

/**
 * Brevo transactional webhook.
 * Configure the webhook URL to `/api/requests/hooks/brevo` and set BREVO_WEBHOOK_SECRET.
 * Auth: `X-Brevo-Signature` = hex HMAC-SHA256 of the raw body with the secret,
 * or `?secret=` matching BREVO_WEBHOOK_SECRET for simple setups.
 */
function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function signatureOk(body: string, header: string | null, secret: string, urlSecret: string | null): boolean {
  if (urlSecret && sameSecret(urlSecret, secret)) return true;
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return sameSecret(header, expected);
}

export async function POST(request: Request) {
  const env = readRequestEnv(process.env);
  if (!env.brevoWebhookSecret) {
    return NextResponse.json({ error: "No email delivery receipt is configured." }, { status: 503 });
  }
  const body = await request.text();
  const urlSecret = new URL(request.url).searchParams.get("secret");
  if (!signatureOk(body, request.headers.get("x-brevo-signature"), env.brevoWebhookSecret, urlSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body) as {
    event?: string;
    "message-id"?: string;
    messageId?: string;
  };
  const ref = payload["message-id"] ?? payload.messageId;
  if (!ref) return NextResponse.json({ ok: true });

  const event = (payload.event ?? "").toLowerCase();
  if (event === "delivered" || event === "request") {
    if (event === "delivered") await applyProviderReceipt(ref, "delivered", "Brevo confirmed delivery.");
  } else if (event === "unique_opened" || event === "opened") {
    await applyProviderReceipt(ref, "opened", "Brevo reported an open.");
  } else if (
    event === "hard_bounce" ||
    event === "soft_bounce" ||
    event === "invalid_email" ||
    event === "error" ||
    event === "blocked"
  ) {
    await applyProviderReceipt(ref, "failed", "Brevo could not deliver the message.");
  }
  return NextResponse.json({ ok: true });
}
