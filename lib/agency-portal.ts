import { createHash, randomBytes } from "node:crypto";

export const ONBOARDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OnboardingLinkState = "open" | "used" | "expired";

export function createOnboardingSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashOnboardingToken(token) };
}

export function hashOnboardingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function onboardingLinkState(
  link: { expiresAt: string; usedAt: string | null },
  now = new Date()
): OnboardingLinkState {
  if (link.usedAt) return "used";
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "open";
}

export function contactEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return null;
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function httpsUrlError(value: string, label: string): string | null {
  const url = value.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return `${label} has to start with https://.`;
    if (url.length > 500) return `${label} is too long.`;
    return null;
  } catch {
    return `Enter a full ${label.toLowerCase()} starting with https://.`;
  }
}

export function domainError(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("://") || host.includes("/") || host.length > 253) {
    return "Enter the domain only, such as reviews.example.com.";
  }
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    return "Enter a domain name.";
  }
  return null;
}

export function domainStatus(input: { domain: string | null; verifiedAt: string | null }): {
  active: boolean;
  label: string;
} {
  if (!input.domain) return { active: false, label: "No domain saved." };
  if (!input.verifiedAt) {
    return { active: false, label: "Not verified. Add the TXT record, then check it." };
  }
  return {
    active: true,
    label: "DNS matches. The app is still opened at its current address until hosting is attached to this domain.",
  };
}

export function senderStatus(input: {
  email: string | null;
  mailConfigured: boolean;
  configuredFrom: string | null;
}): { active: boolean; label: string } {
  if (!input.email) return { active: false, label: "No sender saved." };
  if (!input.mailConfigured || !input.configuredFrom) {
    return { active: false, label: "Saved. Mail is not delivered until a mail provider is configured." };
  }
  if (input.email.toLowerCase() === input.configuredFrom.toLowerCase()) {
    return { active: true, label: "This is the sender configured for mail." };
  }
  return { active: false, label: "Saved. This address is not the configured sender." };
}

export function createDomainToken(): string {
  return `revupilot-verify=${randomBytes(16).toString("hex")}`;
}

export interface UsageExportRow {
  name: string;
  locations: number;
  reviews: number;
  publishedReplies: number;
  recordedEvents: number;
}

/** Counts only. There is no price column. */
export function usageExportLines(rows: UsageExportRow[], heading: string): string[][] {
  return [
    ["Client", "Locations", "Reviews stored", "Replies published", "Recorded events", "Period"],
    ...rows.map((row) => [
      row.name,
      String(row.locations),
      String(row.reviews),
      String(row.publishedReplies),
      String(row.recordedEvents),
      heading,
    ]),
  ];
}
