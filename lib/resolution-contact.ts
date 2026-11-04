import { ValidationError } from "@/lib/errors";

export interface ResolutionContact {
  phone: string | null;
  email: string | null;
}

export type ResolutionContactKind = "phone" | "email" | "both";

export interface ResolutionContactSelection {
  phone: boolean;
  email: boolean;
}

const PHONE = /^[+()\d][\d\s()+-]{5,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_LINE = /^You can reach us at .+ so we can resolve this with you\.$/;

export function normalizeResolutionContact(input: { phone: string; email: string }): ResolutionContact {
  const phone = input.phone.trim();
  const email = input.email.trim();
  if (phone && (!PHONE.test(phone) || phone.replace(/\D/g, "").length < 6)) {
    throw new ValidationError("Enter a phone number with at least 6 digits.");
  }
  if (email && (!EMAIL.test(email) || email.length > 320)) {
    throw new ValidationError("Enter a valid email address.");
  }
  return {
    phone: phone || null,
    email: email ? email.toLowerCase() : null,
  };
}

/** The sentence a person inserts into an escalation reply. */
export function resolutionContactSentence(kind: ResolutionContactKind, contact: ResolutionContact): string | null {
  const phone = contact.phone?.trim() || null;
  const email = contact.email?.trim() || null;
  const parts = kind === "phone" ? [phone] : kind === "email" ? [email] : [phone, email];
  const reach = parts.filter((part): part is string => Boolean(part));
  if (kind === "both" && reach.length < 2) return null;
  if (reach.length === 0) return null;
  return `You can reach us at ${reach.join(" or ")} so we can resolve this with you.`;
}

/** Resolve explicit choices against the saved business details, never browser-supplied values. */
export function selectedResolutionContactSentence(selection: ResolutionContactSelection, contact: ResolutionContact): string | null {
  if (selection.phone && !contact.phone?.trim()) {
    throw new ValidationError("Add a phone number in Settings → Follow-ups before drafting with it.");
  }
  if (selection.email && !contact.email?.trim()) {
    throw new ValidationError("Add an email address in Settings → Follow-ups before drafting with it.");
  }
  if (!selection.phone && !selection.email) return null;
  return resolutionContactSentence(selection.phone && selection.email ? "both" : selection.phone ? "phone" : "email", contact);
}

export function removeResolutionContact(content: string): string {
  return content.split("\n").filter((line) => !CONTACT_LINE.test(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function existingResolutionContactSentence(content: string): string | null {
  return content.split("\n").map((line) => line.trim()).find((line) => CONTACT_LINE.test(line)) ?? null;
}

/** Puts the contact sentence on the reply and replaces an earlier one. */
export function insertResolutionContact(content: string, sentence: string): string {
  const kept = removeResolutionContact(content);
  return kept ? `${kept}\n\n${sentence}` : sentence;
}
