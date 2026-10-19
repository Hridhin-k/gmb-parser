import { NextResponse } from "next/server";
import { readRequestEnv, verifyWhatsAppSignature } from "@/lib/review-requests";
import { applyProviderReceipt } from "@/lib/services/request-campaigns";

export async function GET(request: Request) {
  const env = readRequestEnv(process.env);
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!env.whatsappAppSecret || mode !== "subscribe" || token !== env.whatsappAppSecret) {
    return NextResponse.json({ error: "No WhatsApp delivery receipt is configured." }, { status: 503 });
  }
  return new NextResponse(challenge ?? "", { status: 200 });
}

export async function POST(request: Request) {
  const env = readRequestEnv(process.env);
  if (!env.whatsappAppSecret) {
    return NextResponse.json({ error: "No WhatsApp delivery receipt is configured." }, { status: 503 });
  }
  const body = await request.text();
  if (!verifyWhatsAppSignature(body, request.headers.get("x-hub-signature-256") ?? "", env.whatsappAppSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const payload = JSON.parse(body) as {
    entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string }> } }> }>;
  };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id) continue;
        const value = (status.status ?? "").toLowerCase();
        if (value === "delivered") await applyProviderReceipt(status.id, "delivered", "WhatsApp confirmed delivery.");
        else if (value === "read") await applyProviderReceipt(status.id, "opened", "WhatsApp confirmed the message was read.");
        else if (value === "failed") await applyProviderReceipt(status.id, "failed", "WhatsApp could not deliver the message.");
      }
    }
  }
  return NextResponse.json({ ok: true });
}
