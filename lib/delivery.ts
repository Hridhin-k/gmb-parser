import { channelOptions, type DeliveryChannel, type DeliveryEnv } from "@/lib/reporting";
import { sendBrevoEmail } from "@/lib/mail";

export interface DeliveryResult {
  status: "recorded" | "sent" | "failed" | "unavailable";
  detail: string;
}

export async function deliverMessage(input: {
  env: DeliveryEnv;
  channel: DeliveryChannel;
  recipient: string;
  subject: string;
  body: string;
  pdf?: Uint8Array;
}): Promise<DeliveryResult> {
  const option = channelOptions(input.env).find((item) => item.id === input.channel);
  if (!option?.available) {
    return { status: "unavailable", detail: option?.reason ?? "This channel is not available." };
  }

  if (input.channel === "in_app") {
    return { status: "recorded", detail: "Stored in GRM. No outside message was sent." };
  }

  if (input.channel === "email") {
    return sendEmail(input.env, input.recipient, input.subject, input.body, input.pdf);
  }

  if (input.channel === "slack") {
    return sendSlack(input.env.slackWebhookUrl, input.subject, input.body);
  }

  return {
    status: "unavailable",
    detail: "Recipients are email addresses. No phone number is stored for them.",
  };
}

async function sendEmail(
  env: DeliveryEnv,
  recipient: string,
  subject: string,
  body: string,
  pdf?: Uint8Array
): Promise<DeliveryResult> {
  if (!env.brevoApiKey || !env.reportFromEmail) {
    return { status: "unavailable", detail: "No email provider is configured." };
  }
  const result = await sendBrevoEmail({
    apiKey: env.brevoApiKey,
    from: env.reportFromEmail,
    to: recipient,
    subject,
    text: body,
    attachments: pdf
      ? [{ name: "report.pdf", content: Buffer.from(pdf).toString("base64") }]
      : undefined,
  });
  if (!result.ok) return { status: "failed", detail: result.detail };
  return { status: "sent", detail: "Accepted by the email provider." };
}

async function sendSlack(webhook: string | null, subject: string, body: string): Promise<DeliveryResult> {
  if (!webhook) return { status: "unavailable", detail: "No Slack webhook is configured." };
  const text = `${subject}\n${body}`.slice(0, 3000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: "failed", detail: `Slack returned ${response.status}.` };
    return { status: "sent", detail: "Posted to the Slack webhook." };
  } catch {
    return { status: "failed", detail: "Slack did not respond." };
  }
}
