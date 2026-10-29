import { sendBrevoEmail } from "@/lib/mail";
import { providerOutcome, type ProviderOutcome, type RequestChannel, type RequestEnv } from "@/lib/review-requests";

export interface OutboundMessage {
  channel: Exclude<RequestChannel, "qr">;
  to: string;
  body: string;
  statusCallback?: string;
}

export interface OutboundResult extends ProviderOutcome {
  providerRef: string | null;
}

async function postJson(url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, json };
}

export async function sendRequestMessage(env: RequestEnv, message: OutboundMessage): Promise<OutboundResult> {
  try {
    if (message.channel === "email") return sendEmail(env, message);
    if (message.channel === "sms") return sendSms(env, message);
    return sendWhatsApp(env, message);
  } catch {
    return {
      state: "failed",
      delivered: false,
      retryable: true,
      detail: "The provider did not respond. This will be retried.",
      providerRef: null,
    };
  }
}

async function sendEmail(env: RequestEnv, message: OutboundMessage): Promise<OutboundResult> {
  if (!env.brevoApiKey || !env.fromEmail) {
    return {
      state: "failed",
      delivered: false,
      retryable: false,
      detail: "No email provider is configured.",
      providerRef: null,
    };
  }
  const result = await sendBrevoEmail({
    apiKey: env.brevoApiKey,
    from: env.fromEmail,
    to: message.to,
    subject: "How was your visit?",
    text: message.body,
  });
  const outcome = providerOutcome(result.status || (result.ok ? 200 : 500), null);
  return {
    ...outcome,
    detail: result.ok ? outcome.detail : result.detail,
    providerRef: result.messageId,
  };
}

async function sendSms(env: RequestEnv, message: OutboundMessage): Promise<OutboundResult> {
  const params = new URLSearchParams({ To: message.to, Body: message.body });
  if (env.twilioMessagingService) params.set("MessagingServiceSid", env.twilioMessagingService);
  else if (env.twilioFrom) params.set("From", env.twilioFrom);
  if (message.statusCallback) params.set("StatusCallback", message.statusCallback);
  const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json().catch(() => null)) as { sid?: string; status?: string } | null;
  const outcome = providerOutcome(response.status, json?.status ?? null);
  return { ...outcome, providerRef: json?.sid ?? null };
}

async function sendWhatsApp(env: RequestEnv, message: OutboundMessage): Promise<OutboundResult> {
  const { status, json } = await postJson(`https://graph.facebook.com/v21.0/${env.whatsappPhoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: message.to.replace(/\D/g, ""),
      type: "text",
      text: { body: message.body },
    }),
  });
  const messages = Array.isArray(json?.messages) ? json.messages : [];
  const first = messages[0] as { id?: string } | undefined;
  const outcome = providerOutcome(status, null);
  const detail =
    status >= 400 && status < 500
      ? "WhatsApp rejected the message. A business-initiated text needs an approved template outside an open conversation."
      : outcome.detail;
  return { ...outcome, detail, providerRef: first?.id ?? null };
}
