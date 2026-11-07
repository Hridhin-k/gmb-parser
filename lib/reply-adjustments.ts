export const REPLY_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ml", label: "Malayalam" },
  { id: "manglish", label: "Manglish" },
  { id: "hi", label: "Hindi" },
  { id: "hinglish", label: "Hinglish" },
  { id: "ar", label: "Arabic" },
] as const;

export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number]["id"];

export const REPLY_TEMPLATES = [
  {
    id: "thanks",
    label: "Thank them",
    text: "Thank you for taking the time to share this. We are glad you had a good experience with us.",
  },
  {
    id: "sorry",
    label: "Acknowledge a complaint",
    text: "We are sorry this did not meet your expectations. Please contact the business directly so we can understand what happened and put it right.",
  },
  {
    id: "short",
    label: "Short thanks",
    text: "Thank you for the review. We appreciate you choosing us.",
  },
] as const;

export type ReplyTemplateId = (typeof REPLY_TEMPLATES)[number]["id"];

export type DraftAdjustment =
  | { kind: "regenerate" }
  | { kind: "shorter" }
  | { kind: "thoughtful" }
  | { kind: "warmer" }
  | { kind: "formal" }
  | { kind: "apology" }
  | { kind: "language"; language: ReplyLanguage };

const LANGUAGE_LINES: Record<ReplyLanguage, string> = {
  en: "Write the public reply in English.",
  ml: "Write the public reply in Malayalam, using Malayalam script.",
  manglish: "Write the public reply in Manglish: Malayalam as people type it with English letters. Do not use Malayalam script.",
  hi: "Write the public reply in Hindi, using Devanagari.",
  hinglish: "Write the public reply in Hinglish: Hindi as people type it with English letters. Do not use Devanagari.",
  ar: "Write the public reply in Arabic, using Arabic script.",
};

export function adjustmentInstruction(
  adjustment: DraftAdjustment | null | undefined,
  currentDraft: string | null | undefined,
  hasApprovedContact = false
): string {
  if (!adjustment || adjustment.kind === "regenerate") return "";
  const current = currentDraft?.trim();
  const currentBlock = current
    ? `\nCURRENT DRAFT\n${current.slice(0, 4000)}\nRevise this draft. Keep facts supported by the review and supplied business context; the draft itself is not confirmation of business policies or actions. ${hasApprovedContact ? "Use the approved store contact supplied above; do not invent additional contact details, offers or claims." : "Do not add offers, contact details, or claims that were not in it."}\n`
    : "";
  if (adjustment.kind === "shorter") {
    return `${currentBlock}\nADJUSTMENT\nMake the reply shorter. One or two complete sentences. Keep every complaint acknowledged.\n`;
  }
  if (adjustment.kind === "thoughtful") {
    return `${currentBlock}\nADJUSTMENT: MORE THOUGHTFUL\nWrite a considered, personal response to the original review. Help the customer feel understood: acknowledge the emotional impact and why this experience mattered to them, as well as the main praise, concerns and questions. Recognise the effort behind detailed feedback naturally. Group related points and give each change of focus room to breathe, using blank lines between short, readable paragraphs. An acknowledgement, discussion of a concern, or helpful next step can have its own space when that suits the review; follow a natural conversation rather than a fixed sequence or template. Let the substance and emotional weight determine the length, without targeting a sentence or paragraph count. This requested depth overrides general brevity guidance. Preserve the current draft's language and script unless a language change was requested. Keep any selected contact naturally within the follow-up invitation. A customer's request for an investigation is not evidence that one is underway; retain only business policies and actions confirmed by supplied business context, even if the current draft claims otherwise. Do not pad a short or rating-only review, repeat thanks or apologies, echo the whole review, or invent details, actions, promises or compensation.\n`;
  }
  if (adjustment.kind === "warmer") {
    return `${currentBlock}\nADJUSTMENT\nMake the reply warmer and more human. Do not become effusive, and do not add compensation.\n`;
  }
  if (adjustment.kind === "formal") {
    return `${currentBlock}\nADJUSTMENT\nMake the reply more formal and restrained. No emoji. No slang.\n`;
  }
  if (adjustment.kind === "apology") {
    return `${currentBlock}\nADJUSTMENT\nOpen with a short, sincere apology for what went wrong. Do not admit fault beyond what the reviewer described, and do not add compensation.\n`;
  }
  return `${currentBlock}\nLANGUAGE\n${LANGUAGE_LINES[adjustment.language]} This is a new reply to the reviewer, not a translation of their review. Do not add a translation of the review.\n`;
}

export function templateById(id: string) {
  return REPLY_TEMPLATES.find((item) => item.id === id) ?? null;
}

export function normalizeReplyText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** matched = Google already has this exact reply. absent = no reply. different = do not overwrite. */
export function comparePublishedReply(
  sent: string,
  remote: string | null | undefined
): "matched" | "absent" | "different" {
  if (!remote?.trim()) return "absent";
  return normalizeReplyText(sent) === normalizeReplyText(remote) ? "matched" : "different";
}
