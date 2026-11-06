import { ValidationError } from "@/lib/errors";

export interface ResolutionContact {
  phone: string | null;
  email: string | null;
}

/** A store override is one contact, never a mixture of two different teams. */
export function resolvedContact(store: ResolutionContact, workspace: ResolutionContact): ResolutionContact {
  return store.phone || store.email ? store : workspace;
}

/** Only offer a bulk option when every selected store has that detail. */
export function bulkContactAvailability(contacts: ResolutionContact[]): ResolutionContact {
  return {
    phone: contacts.length > 0 && contacts.every((item) => item.phone) ? "Each store’s saved phone" : null,
    email: contacts.length > 0 && contacts.every((item) => item.email) ? "Each store’s saved email" : null,
  };
}

export type ResolutionContactKind = "phone" | "email" | "both";

const PHONE = /^[+()\d][\d\s()+-]{5,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_LINE = /^You can reach us at .+ so we can resolve this with you\.$/;

export const RESOLUTION_CONTACT_KINDS: ResolutionContactKind[] = ["phone", "email", "both"];

export function isResolutionContactKind(value: unknown): value is ResolutionContactKind {
  return typeof value === "string" && (RESOLUTION_CONTACT_KINDS as string[]).includes(value);
}

export function replyContactValues(content: string): { emails: string[]; phones: string[] } {
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return {
    emails: content.match(emailPattern) ?? [],
    phones: (content.replace(emailPattern, "").match(/\+?\d[\d\s().-]{4,}\d/g) ?? [])
      .filter((phone) => phone.replace(/\D/g, "").length >= 6),
  };
}

/** The contact can appear naturally anywhere in the reply, including legacy footers. */
export function hasResolutionContact(content: string | null | undefined): boolean {
  if (!content) return false;
  const values = replyContactValues(content);
  return values.emails.length > 0 || values.phones.length > 0 || content.split("\n").some((line) => CONTACT_LINE.test(line.trim()));
}

export function selectedResolutionContact(kind: ResolutionContactKind, contact: ResolutionContact): ResolutionContact {
  return { phone: kind === "email" ? null : contact.phone, email: kind === "phone" ? null : contact.email };
}

/** Preserve only current saved details during a rewrite, never an invented or outdated contact. */
export function retainedResolutionContact(content: string, saved: ResolutionContact): ResolutionContact {
  const values = replyContactValues(content);
  return {
    phone: saved.phone && values.phones.some((value) => value.replace(/\D/g, "") === saved.phone!.replace(/\D/g, "")) ? saved.phone : null,
    email: saved.email && values.emails.some((value) => value.toLowerCase() === saved.email!.toLowerCase()) ? saved.email : null,
  };
}

/** Remove old details from model context; selected current contacts are supplied separately. */
export function redactContactDetails(content: string, dropLegacyLine = true): string {
  return (dropLegacyLine ? removeResolutionContact(content) : content)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted]")
    .replace(/\+?\d[\d\s().-]{4,}\d/g, (value) => value.replace(/\D/g, "").length >= 6 ? "[phone omitted]" : value);
}

/** Takes the contact line off a reply, leaving the rest as it was. */
export function removeResolutionContact(content: string): string {
  return content
    .split("\n")
    .filter((line) => !CONTACT_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Which contact details a kind needs. Missing details mean the option cannot be offered. */
export function contactKindAvailable(kind: ResolutionContactKind, contact: ResolutionContact): boolean {
  const phone = Boolean(contact.phone?.trim());
  const email = Boolean(contact.email?.trim());
  return kind === "phone" ? phone : kind === "email" ? email : phone && email;
}

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

/** The contact line already on a reply, so a rewrite can keep it without asking the AI to reproduce it. */
export function existingResolutionContactSentence(content: string): string | null {
  return content.split("\n").map((line) => line.trim()).find((line) => CONTACT_LINE.test(line)) ?? null;
}

/** Puts the contact sentence on the reply and replaces an earlier one. */
export function insertResolutionContact(content: string, sentence: string): string {
  const kept = removeResolutionContact(content);
  return kept ? `${kept}\n\n${sentence}` : sentence;
}
