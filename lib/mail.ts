/**
 * Outbound email via Brevo (Sendinblue) transactional API.
 * Config: BREVO_API_KEY + a verified from address (REPORT_FROM_EMAIL / PLATFORM_FROM_EMAIL / REQUEST_FROM_EMAIL).
 */

export interface MailEnv {
  brevoApiKey: string | null;
  fromEmail: string | null;
}

export interface MailAttachment {
  name: string;
  /** Base64-encoded file bytes. */
  content: string;
}

export interface SendMailInput {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  ok: boolean;
  status: number;
  messageId: string | null;
  detail: string;
}

function trimEnv(source: Record<string, string | undefined>, key: string): string | null {
  const raw = source[key]?.trim();
  return raw ? raw : null;
}

/** Parse `Name <email@x.com>` or bare `email@x.com` into Brevo sender fields. */
export function parseMailSender(from: string): { email: string; name?: string } {
  const angled = /^(.*?)\s*<([^>]+)>\s*$/.exec(from.trim());
  if (angled) {
    const name = angled[1]?.trim();
    const email = angled[2]?.trim() ?? "";
    return name ? { email, name } : { email };
  }
  return { email: from.trim() };
}

export function readMailEnv(
  source: Record<string, string | undefined> = process.env,
  fromKeys: string[] = ["REPORT_FROM_EMAIL"]
): MailEnv {
  let fromEmail: string | null = null;
  for (const key of fromKeys) {
    fromEmail = trimEnv(source, key);
    if (fromEmail) break;
  }
  return {
    brevoApiKey: trimEnv(source, "BREVO_API_KEY"),
    fromEmail,
  };
}

export function mailConfigured(env: MailEnv): boolean {
  return Boolean(env.brevoApiKey && env.fromEmail);
}

/** POST https://api.brevo.com/v3/smtp/email */
export async function sendBrevoEmail(input: SendMailInput): Promise<SendMailResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
  if (recipients.length === 0) {
    return { ok: false, status: 400, messageId: null, detail: "No recipient." };
  }
  const sender = parseMailSender(input.from);
  if (!sender.email.includes("@")) {
    return { ok: false, status: 400, messageId: null, detail: "From address is invalid." };
  }

  const body: Record<string, unknown> = {
    sender,
    to: recipients,
    subject: input.subject,
    textContent: input.text,
  };
  if (input.html) body.htmlContent = input.html;
  if (input.attachments?.length) {
    body.attachment = input.attachments.map((file) => ({
      name: file.name,
      content: file.content,
    }));
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": input.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as { messageId?: string; message?: string } | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        messageId: null,
        detail: json?.message ? `Brevo: ${json.message}` : `Email provider returned ${response.status}.`,
      };
    }
    return {
      ok: true,
      status: response.status,
      messageId: typeof json?.messageId === "string" ? json.messageId : null,
      detail: "Accepted by Brevo.",
    };
  } catch {
    return { ok: false, status: 0, messageId: null, detail: "The email provider did not respond." };
  }
}
