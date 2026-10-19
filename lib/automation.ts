import { checkReplyGuardrails } from "@/lib/reply-guardrails";

export const WARMTH = ["formal", "friendly"] as const;
export const REPLY_LENGTHS = ["brief", "standard", "detailed"] as const;
export const REPLY_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ml", label: "Malayalam and Manglish" },
  { id: "hi", label: "Hindi and Hinglish" },
  { id: "ar", label: "Arabic" },
] as const;

export type Warmth = (typeof WARMTH)[number];
export type ReplyLength = (typeof REPLY_LENGTHS)[number];

export interface SpellingRule {
  term: string;
  spelling: string;
}

export interface ToneFields {
  greeting: string | null;
  signoff: string | null;
  warmth: Warmth | null;
  length: ReplyLength | null;
  languages: string[] | null;
  neverSay: string[] | null;
  spellings: SpellingRule[] | null;
}

export interface AutomationFields {
  enabled: boolean | null;
  minStars: number | null;
  excludeQuestions: boolean | null;
  dailyCap: number | null;
  holdbackMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  shadowMode: boolean | null;
  varyWording: boolean | null;
}

export interface ToneValue {
  greeting: string;
  signoff: string;
  warmth: Warmth;
  length: ReplyLength;
  languages: string[];
  neverSay: string[];
  spellings: SpellingRule[];
}

export interface AutomationValue {
  enabled: boolean;
  minStars: number;
  excludeQuestions: boolean;
  dailyCap: number;
  holdbackMinutes: number;
  windowStart: string | null;
  windowEnd: string | null;
  shadowMode: boolean;
  varyWording: boolean;
}

export const TONE_DEFAULTS: ToneValue = {
  greeting: "",
  signoff: "",
  warmth: "friendly",
  length: "standard",
  languages: ["en", "ml", "hi", "ar"],
  neverSay: [],
  spellings: [],
};

/** Automatic posting stays off until someone turns it on. Shadow mode still blocks posting. */
export const AUTOMATION_DEFAULTS: AutomationValue = {
  enabled: false,
  minStars: 4,
  excludeQuestions: true,
  dailyCap: 10,
  holdbackMinutes: 60,
  windowStart: null,
  windowEnd: null,
  shadowMode: true,
  varyWording: true,
};

export interface ResolvedField<T> {
  value: T;
  source: string;
  overridden: boolean;
}

type Layer<T> = { label: string; fields: Partial<T> | null };

function pick<T>(layers: Layer<T>[], key: keyof T, fallback: T[keyof T]): ResolvedField<T[keyof T]> {
  const here = layers[0];
  const own = here?.fields?.[key];
  if (here && own !== null && own !== undefined) {
    return { value: own as T[keyof T], source: here.label, overridden: true };
  }
  for (const layer of layers.slice(1)) {
    const value = layer.fields?.[key];
    if (value !== null && value !== undefined) {
      return { value: value as T[keyof T], source: layer.label, overridden: false };
    }
  }
  return { value: fallback, source: "the workspace defaults", overridden: false };
}

export function resolveTone(layers: Layer<ToneFields>[]): { [K in keyof ToneValue]: ResolvedField<ToneValue[K]> } {
  return {
    greeting: pick(layers, "greeting", TONE_DEFAULTS.greeting) as ResolvedField<string>,
    signoff: pick(layers, "signoff", TONE_DEFAULTS.signoff) as ResolvedField<string>,
    warmth: pick(layers, "warmth", TONE_DEFAULTS.warmth) as ResolvedField<Warmth>,
    length: pick(layers, "length", TONE_DEFAULTS.length) as ResolvedField<ReplyLength>,
    languages: pick(layers, "languages", TONE_DEFAULTS.languages) as ResolvedField<string[]>,
    neverSay: pick(layers, "neverSay", TONE_DEFAULTS.neverSay) as ResolvedField<string[]>,
    spellings: pick(layers, "spellings", TONE_DEFAULTS.spellings) as ResolvedField<SpellingRule[]>,
  };
}

export function resolveAutomation(layers: Layer<AutomationFields>[]): {
  [K in keyof AutomationValue]: ResolvedField<AutomationValue[K]>;
} {
  return {
    enabled: pick(layers, "enabled", AUTOMATION_DEFAULTS.enabled) as ResolvedField<boolean>,
    minStars: pick(layers, "minStars", AUTOMATION_DEFAULTS.minStars) as ResolvedField<number>,
    excludeQuestions: pick(layers, "excludeQuestions", AUTOMATION_DEFAULTS.excludeQuestions) as ResolvedField<boolean>,
    dailyCap: pick(layers, "dailyCap", AUTOMATION_DEFAULTS.dailyCap) as ResolvedField<number>,
    holdbackMinutes: pick(layers, "holdbackMinutes", AUTOMATION_DEFAULTS.holdbackMinutes) as ResolvedField<number>,
    windowStart: pick(layers, "windowStart", AUTOMATION_DEFAULTS.windowStart) as ResolvedField<string | null>,
    windowEnd: pick(layers, "windowEnd", AUTOMATION_DEFAULTS.windowEnd) as ResolvedField<string | null>,
    shadowMode: pick(layers, "shadowMode", AUTOMATION_DEFAULTS.shadowMode) as ResolvedField<boolean>,
    varyWording: pick(layers, "varyWording", AUTOMATION_DEFAULTS.varyWording) as ResolvedField<boolean>,
  };
}

export function flattenTone(resolved: ReturnType<typeof resolveTone>): ToneValue {
  return {
    greeting: resolved.greeting.value,
    signoff: resolved.signoff.value,
    warmth: resolved.warmth.value,
    length: resolved.length.value,
    languages: resolved.languages.value,
    neverSay: resolved.neverSay.value,
    spellings: resolved.spellings.value,
  };
}

export function flattenAutomation(resolved: ReturnType<typeof resolveAutomation>): AutomationValue {
  return {
    enabled: resolved.enabled.value,
    minStars: resolved.minStars.value,
    excludeQuestions: resolved.excludeQuestions.value,
    dailyCap: resolved.dailyCap.value,
    holdbackMinutes: resolved.holdbackMinutes.value,
    windowStart: resolved.windowStart.value,
    windowEnd: resolved.windowEnd.value,
    shadowMode: resolved.shadowMode.value,
    varyWording: resolved.varyWording.value,
  };
}

export function hasQuestionOrComplaint(comment: string | null, stars: number): boolean {
  if (stars <= 3) return true;
  const text = comment?.trim() ?? "";
  if (!text) return false;
  if (text.includes("?")) return true;
  return /\b(refund|complaint|worst|rude|dirty|never again|waiting|terrible|awful|disappointed|slow service)\b/i.test(
    text
  );
}

export function clockInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function withinPostingWindow(
  now: Date,
  start: string | null,
  end: string | null,
  timeZone: string
): boolean {
  if (!start || !end) return true;
  const clock = clockInZone(now, timeZone);
  if (start <= end) return clock >= start && clock <= end;
  return clock >= start || clock <= end;
}

export interface AutomationVerdict {
  draft: boolean;
  publish: boolean;
  reasons: string[];
}

export function automationVerdict(input: {
  settings: AutomationValue;
  stars: number;
  comment: string | null;
  createdAt: Date;
  now: Date;
  paused: boolean;
  publishedToday: number;
  timeZone: string;
  replyText?: string | null;
}): AutomationVerdict {
  if (input.stars <= 3) {
    return { draft: false, publish: false, reasons: ["Negative reviews need a person."] };
  }
  if (input.paused) {
    return { draft: false, publish: false, reasons: ["Automation is paused."] };
  }
  if (!input.settings.enabled) {
    return { draft: false, publish: false, reasons: ["Automatic replies are off."] };
  }
  if (input.stars < input.settings.minStars) {
    return { draft: false, publish: false, reasons: ["The rating is below the automation rule."] };
  }
  if (input.settings.excludeQuestions && hasQuestionOrComplaint(input.comment, input.stars)) {
    return { draft: false, publish: false, reasons: ["The review has a question or a complaint."] };
  }

  const reasons: string[] = [];
  if (input.settings.shadowMode) reasons.push("Shadow mode saves a draft and does not post.");
  if (input.publishedToday >= input.settings.dailyCap) reasons.push("This location has reached its daily cap.");
  if (!withinPostingWindow(input.now, input.settings.windowStart, input.settings.windowEnd, input.timeZone)) {
    reasons.push("Outside the posting window.");
  }
  const ageMinutes = (input.now.getTime() - input.createdAt.getTime()) / 60000;
  if (ageMinutes < input.settings.holdbackMinutes) reasons.push("The holdback period has not elapsed.");
  if (input.replyText && checkReplyGuardrails(input.replyText).length) {
    reasons.push("Guardrails blocked the reply.");
  }
  return { draft: true, publish: reasons.length === 0, reasons };
}

export function voiceGuide(tone: ToneValue, vary: boolean): string {
  const lines = ["CONFIGURED REPLY VOICE"];
  if (tone.greeting) lines.push(`- Open with this greeting when it fits: ${tone.greeting}`);
  if (tone.signoff) lines.push(`- Close with this sign-off: ${tone.signoff}`);
  lines.push(tone.warmth === "formal" ? "- Sound calm and formal." : "- Sound friendly and human.");
  lines.push(
    tone.length === "brief"
      ? "- Keep the reply to one or two short sentences."
      : tone.length === "detailed"
        ? "- Use a fuller reply, still under 90 words."
        : "- Use a moderate length, about two to four sentences."
  );
  if (tone.languages.length) {
    lines.push(`- Languages this business replies in: ${tone.languages.join(", ")}.`);
  }
  if (tone.neverSay.length) lines.push(`- Never say: ${tone.neverSay.join("; ")}.`);
  if (tone.spellings.length) {
    lines.push(
      `- Spell these exactly: ${tone.spellings.map((rule) => `${rule.term} as ${rule.spelling}`).join("; ")}.`
    );
  }
  if (vary) lines.push("- Vary the opening and wording from other locations. Do not reuse a stock sentence.");
  return `\n${lines.join("\n")}\n`;
}

export function localPreview(input: {
  tone: ToneValue;
  template: string | null;
  reviewerName: string;
  locationName: string;
  comment: string;
}): { text: string; words: number; violations: string[] } {
  const body =
    input.template?.trim() ||
    "Thank you for telling us about your visit. We have shared this with the team.";
  const filled = body
    .replaceAll("{name}", input.reviewerName || "there")
    .replaceAll("{location}", input.locationName || "our team");
  const parts = [input.tone.greeting, filled, input.tone.signoff].map((part) => part.trim()).filter(Boolean);
  const text = parts.join(" ");
  return {
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    violations: checkReplyGuardrails(text).map((item) => item.message),
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toneError(fields: ToneFields): string | null {
  if (fields.greeting && fields.greeting.length > 80) return "The greeting is too long.";
  if (fields.signoff && fields.signoff.length > 80) return "The sign-off is too long.";
  if (fields.warmth && !WARMTH.includes(fields.warmth)) return "Choose formal or friendly.";
  if (fields.length && !REPLY_LENGTHS.includes(fields.length)) return "Choose a reply length.";
  if (fields.languages && fields.languages.some((id) => !REPLY_LANGUAGES.some((item) => item.id === id))) {
    return "Choose a supported language.";
  }
  if (fields.neverSay && fields.neverSay.some((item) => item.length > 80)) return "A never-say rule is too long.";
  if (fields.spellings && fields.spellings.some((rule) => !rule.term.trim() || !rule.spelling.trim())) {
    return "Each spelling rule needs a term and the spelling to use.";
  }
  return null;
}

export function automationError(fields: AutomationFields): string | null {
  if (fields.minStars != null && (fields.minStars < 4 || fields.minStars > 5)) {
    return "Automatic replies can cover 4 or 5 star reviews.";
  }
  if (fields.dailyCap != null && (fields.dailyCap < 1 || fields.dailyCap > 100)) {
    return "The daily cap has to be between 1 and 100.";
  }
  if (fields.holdbackMinutes != null && (fields.holdbackMinutes < 0 || fields.holdbackMinutes > 10080)) {
    return "Holdback has to be between 0 minutes and 7 days.";
  }
  const start = fields.windowStart;
  const end = fields.windowEnd;
  if ((start && !end) || (!start && end)) return "Set both the start and end of the posting window.";
  if (start && !TIME.test(start)) return "Use a 24-hour start time.";
  if (end && !TIME.test(end)) return "Use a 24-hour end time.";
  return null;
}
