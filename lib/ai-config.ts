import type { AutomationValue, ToneValue } from "@/lib/automation";
import { AUTOMATION_DEFAULTS, TONE_DEFAULTS } from "@/lib/automation";

export const AI_KNOWLEDGE_KINDS = [
  "instruction",
  "faq",
  "response_rule",
  "approved_example",
  "insight_lens",
] as const;
export type AiKnowledgeKind = (typeof AI_KNOWLEDGE_KINDS)[number];

export type AiConfigStatus = "draft" | "active" | "archived";

export const INSIGHT_VERTICAL_PRESETS = ["fashion", "restaurant", "hospitality", "retail", "general"] as const;
export type InsightVerticalPreset = (typeof INSIGHT_VERTICAL_PRESETS)[number];

export interface InsightLens {
  vertical: string;
  watchThemes: string[];
  focusQuestions: string[];
  successSignals: string[];
}

export interface OrgContext {
  industry: string;
  positioning: string;
  priorities: string;
  policies: string;
  legacyVoice: "warm" | "professional" | "brief" | "";
  legacyNote: string;
}

export interface AiConfigSnapshot {
  org: OrgContext;
  tone: ToneValue;
  automation: AutomationValue;
  insights: InsightLens;
}

export interface AiKnowledgeRow {
  id: string;
  workspaceId: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  kind: AiKnowledgeKind;
  title: string;
  body: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface KnowledgeScope {
  workspaceId?: string;
  clientId: string | null;
  groupId: string | null;
  parentGroupId: string | null;
  locationId: string | null;
}

export const EMPTY_ORG: OrgContext = {
  industry: "",
  positioning: "",
  priorities: "",
  policies: "",
  legacyVoice: "",
  legacyNote: "",
};

export const EMPTY_INSIGHT_LENS: InsightLens = {
  vertical: "",
  watchThemes: [],
  focusQuestions: [],
  successSignals: [],
};

/** Suggested lens fields when an owner picks a vertical preset. */
export const INSIGHT_VERTICAL_DEFAULTS: Record<InsightVerticalPreset, InsightLens> = {
  fashion: {
    vertical: "fashion",
    watchThemes: ["quality", "fit", "staff", "price", "returns"],
    focusQuestions: [
      "Which outlets drag quality or fit complaints?",
      "Is price mentioned more often in low-star reviews than before?",
    ],
    successSignals: ["fewer quality complaints", "higher reply rate on 1–3 star reviews"],
  },
  restaurant: {
    vertical: "restaurant",
    watchThemes: ["food", "service", "wait time", "hygiene", "value"],
    focusQuestions: [
      "Where is wait time rising in low-star reviews?",
      "Which outlets earn praise for service worth copying?",
    ],
    successSignals: ["lower wait-time share", "stable or rising average rating"],
  },
  hospitality: {
    vertical: "hospitality",
    watchThemes: ["cleanliness", "staff", "check-in", "noise", "value"],
    focusQuestions: [
      "Which properties show cleanliness or noise spikes?",
      "Is staff praise concentrated in a few outlets?",
    ],
    successSignals: ["fewer cleanliness complaints", "higher reply coverage"],
  },
  retail: {
    vertical: "retail",
    watchThemes: ["staff", "stock", "price", "checkout", "store experience"],
    focusQuestions: [
      "Which outlets mention stock or checkout friction most?",
      "Is staff tone improving or getting worse?",
    ],
    successSignals: ["fewer stock complaints", "faster replies on negative reviews"],
  },
  general: {
    vertical: "general",
    watchThemes: ["staff", "quality", "price", "wait time"],
    focusQuestions: [
      "Which themes rose among 1–3 star reviews?",
      "Which outlets improved or slipped on average rating?",
    ],
    successSignals: ["stable average rating", "higher reply rate"],
  },
};

function stringList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 80);
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

export function parseInsightLens(value: unknown): InsightLens {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_INSIGHT_LENS };
  }
  const raw = value as Record<string, unknown>;
  return {
    vertical: typeof raw.vertical === "string" ? raw.vertical.trim().slice(0, 80) : "",
    watchThemes: stringList(raw.watchThemes),
    focusQuestions: stringList(raw.focusQuestions, 8),
    successSignals: stringList(raw.successSignals, 8),
  };
}

export function insightLensFromMetadata(metadata: Record<string, unknown> | null | undefined): InsightLens | null {
  if (!metadata || typeof metadata !== "object") return null;
  const lens = parseInsightLens(metadata.lens ?? metadata);
  if (!lens.vertical && !lens.watchThemes.length && !lens.focusQuestions.length && !lens.successSignals.length) {
    return null;
  }
  return lens;
}

/** Client-scoped insight_lens row wins; otherwise workspace snapshot.insights. */
export function resolveInsightLens(input: {
  workspaceLens: InsightLens;
  knowledge: AiKnowledgeRow[];
  clientId: string | null;
}): InsightLens {
  const clientRows = input.knowledge.filter(
    (row) =>
      row.enabled &&
      row.kind === "insight_lens" &&
      input.clientId &&
      row.clientId === input.clientId &&
      !row.groupId &&
      !row.locationId
  );
  for (const row of clientRows) {
    const fromMeta = insightLensFromMetadata(row.metadata);
    if (fromMeta) return fromMeta;
  }
  const workspaceRows = input.knowledge.filter(
    (row) =>
      row.enabled &&
      row.kind === "insight_lens" &&
      !row.clientId &&
      !row.groupId &&
      !row.locationId
  );
  for (const row of workspaceRows) {
    const fromMeta = insightLensFromMetadata(row.metadata);
    if (fromMeta) return fromMeta;
  }
  return parseInsightLens(input.workspaceLens);
}

export function insightLensPromptBlock(lens: InsightLens, notes?: string): string {
  const lines: string[] = [];
  if (lens.vertical.trim()) lines.push(`Business vertical / lens: ${lens.vertical.trim()}`);
  if (lens.watchThemes.length) lines.push(`Watch themes (prioritise when present in reviews): ${lens.watchThemes.join(", ")}`);
  if (lens.focusQuestions.length) {
    lines.push("Focus questions from the operator:\n" + lens.focusQuestions.map((q) => `- ${q}`).join("\n"));
  }
  if (lens.successSignals.length) {
    lines.push("Success signals they care about:\n" + lens.successSignals.map((s) => `- ${s}`).join("\n"));
  }
  if (notes?.trim()) lines.push(`Extra lens notes: ${notes.trim().slice(0, 800)}`);
  if (!lines.length) return "";
  return (
    `\nINSIGHT LENS (saved parameters — shape the brief around these; do not invent causes outside the reviews)\n` +
    `${lines.join("\n")}\n`
  );
}

export function insightLensFingerprint(lens: InsightLens): string {
  return JSON.stringify({
    v: lens.vertical,
    t: lens.watchThemes,
    q: lens.focusQuestions,
    s: lens.successSignals,
  });
}

export function defaultSnapshot(): AiConfigSnapshot {
  return {
    org: { ...EMPTY_ORG },
    tone: { ...TONE_DEFAULTS },
    automation: { ...AUTOMATION_DEFAULTS },
    insights: { ...EMPTY_INSIGHT_LENS },
  };
}

export function parseSnapshot(value: unknown): AiConfigSnapshot {
  const base = defaultSnapshot();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const raw = value as Record<string, unknown>;
  const org = raw.org && typeof raw.org === "object" ? (raw.org as Record<string, unknown>) : {};
  const tone = raw.tone && typeof raw.tone === "object" ? (raw.tone as Record<string, unknown>) : {};
  const automation =
    raw.automation && typeof raw.automation === "object" ? (raw.automation as Record<string, unknown>) : {};
  const voice = org.legacyVoice;
  return {
    org: {
      industry: typeof org.industry === "string" ? org.industry : "",
      positioning: typeof org.positioning === "string" ? org.positioning : "",
      priorities: typeof org.priorities === "string" ? org.priorities : "",
      policies: typeof org.policies === "string" ? org.policies : "",
      legacyVoice:
        voice === "warm" || voice === "professional" || voice === "brief" ? voice : "",
      legacyNote: typeof org.legacyNote === "string" ? org.legacyNote : "",
    },
    tone: {
      greeting: typeof tone.greeting === "string" ? tone.greeting : base.tone.greeting,
      signoff: typeof tone.signoff === "string" ? tone.signoff : base.tone.signoff,
      warmth: tone.warmth === "formal" || tone.warmth === "friendly" ? tone.warmth : base.tone.warmth,
      length:
        tone.length === "brief" || tone.length === "standard" || tone.length === "detailed"
          ? tone.length
          : base.tone.length,
      languages: Array.isArray(tone.languages)
        ? tone.languages.filter((item): item is string => typeof item === "string")
        : base.tone.languages,
      neverSay: Array.isArray(tone.neverSay)
        ? tone.neverSay.filter((item): item is string => typeof item === "string")
        : base.tone.neverSay,
      spellings: Array.isArray(tone.spellings)
        ? tone.spellings.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const row = item as { term?: unknown; spelling?: unknown };
            if (typeof row.term !== "string" || typeof row.spelling !== "string") return [];
            return [{ term: row.term, spelling: row.spelling }];
          })
        : base.tone.spellings,
    },
    automation: {
      enabled: typeof automation.enabled === "boolean" ? automation.enabled : base.automation.enabled,
      minStars: typeof automation.minStars === "number" ? automation.minStars : base.automation.minStars,
      excludeQuestions:
        typeof automation.excludeQuestions === "boolean"
          ? automation.excludeQuestions
          : base.automation.excludeQuestions,
      dailyCap: typeof automation.dailyCap === "number" ? automation.dailyCap : base.automation.dailyCap,
      holdbackMinutes:
        typeof automation.holdbackMinutes === "number"
          ? automation.holdbackMinutes
          : base.automation.holdbackMinutes,
      windowStart: typeof automation.windowStart === "string" ? automation.windowStart : null,
      windowEnd: typeof automation.windowEnd === "string" ? automation.windowEnd : null,
      shadowMode:
        typeof automation.shadowMode === "boolean" ? automation.shadowMode : base.automation.shadowMode,
      varyWording:
        typeof automation.varyWording === "boolean" ? automation.varyWording : base.automation.varyWording,
    },
    insights: parseInsightLens(raw.insights),
  };
}

/** Knowledge visible for a location: workspace-wide, matching client, matching group or parent, or that outlet. */
export function knowledgeInScope(rows: AiKnowledgeRow[], scope: KnowledgeScope): AiKnowledgeRow[] {
  return rows.filter((row) => {
    if (!row.enabled) return false;
    if (scope.workspaceId && row.workspaceId !== scope.workspaceId) return false;
    if (!row.clientId && !row.groupId && !row.locationId) return true;
    if (row.locationId) return Boolean(scope.locationId && row.locationId === scope.locationId);
    if (row.groupId) {
      return scope.groupId === row.groupId || scope.parentGroupId === row.groupId;
    }
    if (row.clientId) return Boolean(scope.clientId && row.clientId === scope.clientId);
    return false;
  });
}

/** Reject knowledge that belongs to another workspace id. */
export function assertSameWorkspace(rows: AiKnowledgeRow[], workspaceId: string): AiKnowledgeRow[] {
  return rows.filter((row) => row.workspaceId === workspaceId);
}

export function knowledgePromptBlock(rows: AiKnowledgeRow[]): string {
  const scoped = rows.filter((row) => row.enabled && row.body.trim() && row.kind !== "insight_lens");
  if (!scoped.length) return "";
  const byKind = (kind: AiKnowledgeKind) => scoped.filter((row) => row.kind === kind);
  const parts: string[] = [];
  const instructions = byKind("instruction").slice(0, 8);
  const rules = byKind("response_rule").slice(0, 12);
  const faqs = byKind("faq").slice(0, 8);
  const examples = byKind("approved_example").slice(0, 5);
  if (instructions.length) {
    parts.push(
      "ORGANISATION INSTRUCTIONS (saved by this workspace — follow them)\n" +
        instructions.map((row) => `- ${row.title}: ${row.body.slice(0, 500)}`).join("\n")
    );
  }
  if (rules.length) {
    parts.push(
      "RESPONSE RULES (saved by this workspace)\n" +
        rules.map((row) => `- ${row.title}: ${row.body.slice(0, 500)}`).join("\n")
    );
  }
  if (faqs.length) {
    parts.push(
      "APPROVED FACTS AND FAQs (use only when relevant; do not invent beyond these)\n" +
        faqs.map((row) => `- Q: ${row.title}\n  A: ${row.body.slice(0, 500)}`).join("\n")
    );
  }
  if (examples.length) {
    parts.push(
      "APPROVED EXAMPLE REPLIES (match their style; do not copy customer names or invent similar incidents)\n" +
        examples.map((row, index) => `${index + 1}. ${row.body.slice(0, 600)}`).join("\n")
    );
  }
  return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}

export function orgContextPromptBlock(org: OrgContext): string {
  const lines: string[] = [];
  if (org.industry.trim()) lines.push(`Industry: ${org.industry.trim().slice(0, 200)}`);
  if (org.positioning.trim()) lines.push(`Brand positioning: ${org.positioning.trim().slice(0, 400)}`);
  if (org.priorities.trim()) lines.push(`Customer experience priorities: ${org.priorities.trim().slice(0, 400)}`);
  if (org.policies.trim()) lines.push(`Policies the reply may reference: ${org.policies.trim().slice(0, 600)}`);
  if (!lines.length) return "";
  return `\nORGANISATION CONTEXT (saved instructions — not a trained model)\n${lines.join("\n")}\n`;
}

export function templatesPromptBlock(templates: Array<{ name: string; body: string }>): string {
  const rows = templates.filter((item) => item.body.trim()).slice(0, 4);
  if (!rows.length) return "";
  return (
    `\nSAVED REPLY TEMPLATES (optional phrasing ideas for this scope)\n` +
    rows.map((item) => `- ${item.name}: ${item.body.slice(0, 400)}`).join("\n") +
    "\n"
  );
}
