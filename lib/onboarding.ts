export const ONBOARDING_STEPS = ["connect", "import", "groups", "tone", "invite"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const GROUPING_MODES = ["state_city", "city", "account", "none", "csv"] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];

export const TONE_VOICES = ["warm", "professional", "brief"] as const;
export type ToneVoice = (typeof TONE_VOICES)[number];

export type HoldReason = "duplicate" | "unverified";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AuthMethod {
  id: "google" | "microsoft" | "email" | "sso" | "phone";
  label: string;
  detail: string;
  available: boolean;
  reason: string | null;
  /** Present only for a configured SSO provider. Not a secret. */
  ssoDomain?: string;
}

export interface AuthMethodFlags {
  microsoft?: boolean;
  email?: boolean;
  ssoDomain?: string | null;
  phone?: boolean;
}

/** Only returns methods that are actually configured. Unconfigured providers stay hidden. */
export function authMethods(flags: AuthMethodFlags = {}): AuthMethod[] {
  const ssoDomain = flags.ssoDomain?.trim() || "";
  const methods: AuthMethod[] = [
    {
      id: "google",
      label: "Google",
      detail: "Sign in with the Google account you use for work.",
      available: true,
      reason: null,
    },
  ];

  if (flags.microsoft) {
    methods.push({
      id: "microsoft",
      label: "Microsoft",
      detail: "Sign in with a Microsoft work account.",
      available: true,
      reason: null,
    });
  }
  if (flags.email) {
    methods.push({
      id: "email",
      label: "Work email and password",
      detail: "Sign in with an email and password.",
      available: true,
      reason: null,
    });
  }
  if (ssoDomain) {
    methods.push({
      id: "sso",
      label: "Single sign-on",
      detail: "Sign in through your company identity provider.",
      available: true,
      reason: null,
      ssoDomain,
    });
  }
  if (flags.phone) {
    methods.push({
      id: "phone",
      label: "Mobile number",
      detail: "A one-time code for store managers.",
      available: true,
      reason: null,
    });
  }

  return methods;
}

export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "auth_failed") {
    return "Sign-in did not finish. Try Google again. If this keeps happening, the provider returned an error.";
  }
  return "Sign-in did not finish. Try again.";
}

export function inviteExpiresAt(from = Date.now()): string {
  return new Date(from + INVITE_TTL_MS).toISOString();
}

export function isInviteExpired(
  expiresAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= now;
}

/**
 * Addresses stored by the Google sync are
 * street lines, city, state, postal code, country.
 * A street line that itself contains a comma can shift this guess,
 * so the wizard asks for confirmation before saving groups.
 */
export function placeFromStoredAddress(address: string | null | undefined): {
  city: string | null;
  state: string | null;
} {
  if (!address?.trim()) return { city: null, state: null };
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 4) {
    return {
      city: parts[parts.length - 4] ?? null,
      state: parts[parts.length - 3] ?? null,
    };
  }
  if (parts.length >= 2) {
    return { city: parts[parts.length - 2] ?? null, state: parts[parts.length - 1] ?? null };
  }
  return { city: parts[0] ?? null, state: null };
}

export interface LocationForGrouping {
  id: string;
  title: string;
  address: string | null;
  accountName: string | null;
  holdReason: HoldReason | null;
}

export interface SuggestedGroup {
  name: string;
  source: "state_city" | "city" | "account" | "manual" | "csv";
  locationIds: string[];
}

export function suggestGroups(
  mode: "state_city" | "city" | "account",
  locations: LocationForGrouping[]
): { groups: SuggestedGroup[]; unplacedIds: string[] } {
  const buckets = new Map<string, string[]>();
  const unplacedIds: string[] = [];
  const source = mode === "state_city" ? "state_city" : mode === "city" ? "city" : "account";

  for (const location of locations) {
    if (location.holdReason) {
      unplacedIds.push(location.id);
      continue;
    }
    let key: string | null = null;
    if (mode === "account") {
      key = location.accountName?.trim() || null;
    } else {
      const place = placeFromStoredAddress(location.address);
      if (mode === "city") key = place.city;
      else if (place.city && place.state) key = `${place.state} · ${place.city}`;
      else key = place.city ?? place.state;
    }
    if (!key) {
      unplacedIds.push(location.id);
      continue;
    }
    const list = buckets.get(key) ?? [];
    list.push(location.id);
    buckets.set(key, list);
  }

  return {
    groups: [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, locationIds]) => ({ name: name.slice(0, 120), source, locationIds })),
    unplacedIds,
  };
}

export interface DuplicateInput {
  id: string;
  placeId: string | null;
  title: string;
  address: string | null;
  googleDuplicateOf: string | null;
  voiceOfMerchant: boolean | null;
  accountUnverified: boolean;
}

/** The first profile in each duplicate set stays clear. Later copies are held. */
export function holdReasons(locations: DuplicateInput[]): Map<string, HoldReason | null> {
  const result = new Map<string, HoldReason | null>();
  const byPlace = new Map<string, string[]>();
  const byText = new Map<string, string[]>();

  for (const location of locations) {
    result.set(location.id, null);
    const placeId = location.placeId?.trim();
    if (placeId) byPlace.set(placeId, [...(byPlace.get(placeId) ?? []), location.id]);
    const text = `${location.title}|${location.address ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (location.address?.trim() && text.length > 3) {
      byText.set(text, [...(byText.get(text) ?? []), location.id]);
    }
  }

  const duplicates = new Set<string>();
  for (const ids of [...byPlace.values(), ...byText.values()]) {
    if (ids.length < 2) continue;
    for (const id of ids.slice(1)) duplicates.add(id);
  }

  for (const location of locations) {
    if (location.googleDuplicateOf?.trim() || duplicates.has(location.id)) {
      result.set(location.id, "duplicate");
    } else if (location.voiceOfMerchant === false) {
      result.set(location.id, "unverified");
    }
  }

  return result;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function parseGroupCsv(text: string): { location: string; group: string }[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0] ?? "").map((cell) => cell.trim().toLowerCase());
  const locationIndex = header.findIndex((cell) =>
    ["location", "name", "title"].includes(cell)
  );
  const groupIndex = header.findIndex((cell) => cell === "group");
  const hasHeader = locationIndex >= 0 && groupIndex >= 0;
  const start = hasHeader ? 1 : 0;
  const locationCell = hasHeader ? locationIndex : 0;
  const groupCell = hasHeader ? groupIndex : 1;
  const rows: { location: string; group: string }[] = [];

  for (const line of lines.slice(start)) {
    const cells = splitCsvLine(line);
    const location = (cells[locationCell] ?? "").trim();
    const group = (cells[groupCell] ?? "").trim();
    if (!location && !group) continue;
    rows.push({ location, group });
  }
  return rows;
}

export function matchCsvGroups(
  rows: { location: string; group: string }[],
  locations: { id: string; title: string; holdReason: HoldReason | null }[]
): { groups: SuggestedGroup[]; errors: string[]; heldIds: string[] } {
  const byTitle = new Map<string, { id: string; holdReason: HoldReason | null }[]>();
  for (const location of locations) {
    const key = location.title.trim().toLowerCase();
    const list = byTitle.get(key) ?? [];
    list.push(location);
    byTitle.set(key, list);
  }

  const errors: string[] = [];
  const heldIds: string[] = [];
  const buckets = new Map<string, string[]>();

  rows.forEach((row, index) => {
    const line = index + 1;
    if (!row.location || !row.group) {
      errors.push(`Row ${line} needs both a location and a group.`);
      return;
    }
    if (row.group.length > 120) {
      errors.push(`Row ${line} group name is longer than 120 characters.`);
      return;
    }
    const matches = byTitle.get(row.location.trim().toLowerCase()) ?? [];
    if (matches.length === 0) {
      errors.push(`Row ${line}: no location named “${row.location}”.`);
      return;
    }
    if (matches.length > 1) {
      errors.push(
        `Row ${line}: “${row.location}” matches ${matches.length} locations. Rename one in Google before using CSV grouping.`
      );
      return;
    }
    const match = matches[0];
    if (!match) return;
    if (match.holdReason) {
      heldIds.push(match.id);
      return;
    }
    const name = row.group.trim();
    const list = buckets.get(name) ?? [];
    if (!list.includes(match.id)) list.push(match.id);
    buckets.set(name, list);
  });

  return {
    groups: [...buckets.entries()].map(([name, locationIds]) => ({
      name,
      source: "csv" as const,
      locationIds,
    })),
    errors,
    heldIds,
  };
}

const TONE_LINES: Record<ToneVoice, string> = {
  warm: "Sound warm and human. Use short sentences.",
  professional: "Sound calm and professional. No slang.",
  brief: "Use as few words as the review allows.",
};

export function toneInstruction(voice: ToneVoice | null | undefined, note: string | null | undefined): string {
  const extra = note?.trim().slice(0, 500) ?? "";
  if (!voice && !extra) return "";
  const lines = ["WORKSPACE REPLY TONE"];
  if (voice) lines.push(`- ${TONE_LINES[voice]}`);
  if (extra) lines.push(`- Also follow this note from the business: ${extra}`);
  return `\n${lines.join("\n")}\n`;
}

export function shouldEnterWizard(input: {
  completed: boolean;
  connections: number;
  locations: number;
}): boolean {
  return !input.completed && input.connections === 0 && input.locations === 0;
}

export function stepUnlocked(
  step: OnboardingStep,
  view: {
    step: OnboardingStep | "done";
    connections: number;
    locations: number;
    grouping: GroupingMode | null;
    toneVoice: ToneVoice | null;
  }
): boolean {
  const saved = view.step === "done" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(view.step);
  const target = ONBOARDING_STEPS.indexOf(step);
  if (target <= saved) return true;
  if (step === "import") return view.connections > 0;
  if (step === "groups") return view.locations > 0;
  if (step === "tone") return view.grouping != null;
  if (step === "invite") return view.toneVoice != null;
  return false;
}

export function googleConnectError(code: string | null | undefined): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    access_denied: "You denied access to the Google account. Connect again when you are ready.",
    auth_failed: "Google authorization failed. Try connecting again.",
    missing_params: "The authorization response was incomplete. Try connecting again.",
    OAUTH_INVALID_STATE: "The authorization request was invalid. Start the connection again.",
    OAUTH_STATE_EXPIRED: "The authorization request expired. Start the connection again.",
    OAUTH_TOKEN_EXCHANGE_FAILED: "Google did not finish the connection. Try again.",
    OAUTH_NO_REFRESH_TOKEN:
      "Google did not grant offline access. Remove GRM in your Google account permissions, then connect again.",
    OAUTH_INVALID_GRANT: "The authorization code was already used. Start the connection again.",
    CONFIG_ERROR: "Google OAuth is not configured on the server. Add the Google client id, secret, and redirect URI.",
  };
  return messages[code] ?? "Google did not finish connecting. Try again from this step.";
}
