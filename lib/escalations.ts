export const ESCALATION_TIMEZONES = [
  { id: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { id: "UTC", label: "UTC" },
  { id: "Asia/Dubai", label: "Gulf (Asia/Dubai)" },
  { id: "America/New_York", label: "US Eastern (America/New_York)" },
] as const;

export type EscalationTimezone = (typeof ESCALATION_TIMEZONES)[number]["id"];

export const RESOLUTION_ACTIONS = [
  {
    id: "apology_callback",
    label: "Apology and callback",
    detail: "Records that someone should apologise and call. It does not mean the call happened.",
  },
  {
    id: "replacement_arranged",
    label: "Replacement arranged",
    detail: "Records replacement as the next step. It does not mean a replacement was delivered.",
  },
  {
    id: "store_visit_scheduled",
    label: "Store visit scheduled",
    detail: "Records a store visit as the next step. It does not mean the visit happened.",
  },
] as const;

export type ResolutionCode = (typeof RESOLUTION_ACTIONS)[number]["id"];

export const ESCALATION_LEVELS = [
  { id: "store", label: "Store" },
  { id: "regional", label: "Regional" },
  { id: "leadership", label: "Leadership" },
] as const;

export type EscalationLevel = (typeof ESCALATION_LEVELS)[number]["id"];

export interface EscalationPolicy {
  maxStars: number;
  flagProfanity: boolean;
  flagLegalSafety: boolean;
  extraKeywords: string[];
  reminderHours: number[];
  dueHours: number;
  timezone: EscalationTimezone;
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  maxStars: 3,
  flagProfanity: true,
  flagLegalSafety: true,
  extraKeywords: [],
  reminderHours: [2, 6],
  dueHours: 24,
  timezone: "Asia/Kolkata",
};

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard"];
const LEGAL_SAFETY = [
  "lawsuit",
  "sue ",
  "lawyer",
  "attorney",
  "police",
  "injury",
  "injured",
  "unsafe",
  "harassment",
  "fraud",
  "poison",
  "food poisoning",
];

export type TriggerReason = "rating" | "profanity" | "legal_safety" | "keyword";

function hasWord(text: string, word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^a-z])${escaped}(?:[^a-z]|$)`, "i").test(text);
}

/** The same substrings the escalation rules use for legal and safety text. */
export function legalSafetyTerms(): string[] {
  return LEGAL_SAFETY.map((word) => word.trim()).filter((word) => word.length >= 3);
}
export function legalSafetyMatches(comment: string | null): string[] {
  const text = (comment ?? "").toLowerCase();
  if (!text) return [];
  return LEGAL_SAFETY.filter((word) => text.includes(word.trim())).map((word) => word.trim());
}

export function escalationReasons(
  input: { starRating: number; comment: string | null },
  policy: EscalationPolicy
): TriggerReason[] {
  const reasons: TriggerReason[] = [];
  if (input.starRating <= policy.maxStars) reasons.push("rating");
  const text = (input.comment ?? "").toLowerCase();
  if (policy.flagProfanity && PROFANITY.some((word) => hasWord(text, word))) reasons.push("profanity");
  if (policy.flagLegalSafety && LEGAL_SAFETY.some((word) => text.includes(word.trim()))) {
    reasons.push("legal_safety");
  }
  const extra = policy.extraKeywords.map((word) => word.trim().toLowerCase()).filter((word) => word.length >= 3);
  if (extra.some((word) => text.includes(word))) reasons.push("keyword");
  return reasons;
}

/** An open escalation, or the same trigger key, blocks a second record. */
export function shouldSkipTrigger(input: { hasOpen: boolean; knownKey: boolean }): boolean {
  return input.hasOpen || input.knownKey;
}

export function queueBucket(
  input: { status: string; dueAt: string },
  now: number
): "needs_human" | "in_progress" | "past_sla" | "resolved" {
  if (input.status === "resolved") return "resolved";
  if (Date.parse(input.dueAt) < now) return "past_sla";
  if (input.status === "in_progress") return "in_progress";
  return "needs_human";
}

export function slaClock(dueAt: string, now: number): { remaining: string | null; overdue: string | null } {
  const delta = Date.parse(dueAt) - now;
  const abs = Math.abs(delta);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  if (delta >= 0) return { remaining: label, overdue: null };
  return { remaining: null, overdue: label };
}

export function formatInTimezone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function autoreplyPausedFor(input: {
  pauses: Array<{ scope: string; clientId: string | null; locationId: string | null }>;
  clientId: string | null;
  locationId: string | null;
}): boolean {
  return input.pauses.some(
    (pause) =>
      pause.scope === "workspace" ||
      (pause.scope === "client" && pause.clientId && pause.clientId === input.clientId) ||
      (pause.scope === "location" && pause.locationId && pause.locationId === input.locationId)
  );
}
