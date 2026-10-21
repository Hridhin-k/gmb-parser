import { z } from "zod";
import { detectReviewLanguage } from "@/lib/review-inbox";
import { excerptSupportsClaim } from "@/lib/intelligence/claim-support";
import { isLeafTopic, resolveTopicCode, TAXONOMY_VERSION } from "@/lib/intelligence/taxonomy";

export { excerptComplainsAboutPrice, excerptSupportsClaim } from "@/lib/intelligence/claim-support";

export const EXTRACT_ANALYSIS_VERSION = "extract-v2";
export const EXTRACT_PROMPT_VERSION = "extract-v2";

/**
 * Classification scheme.
 *
 * rating.band comes only from stars: 1–2 low, 3 mid, 4–5 high.
 * It is not an opinion about the words.
 *
 * textSentiment is unknown when the comment is empty or when no quotation
 * survived validation. It is positive when every surviving quotation is praise,
 * negative when every one is a complaint, mixed when both exist, and neutral
 * when the only quotations are neutral.
 *
 * overall is unknown when text sentiment is unknown. It is mixed when the
 * rating band and the text disagree (a low or mid rating with positive text,
 * or a high rating with negative text) or when the text itself is mixed.
 * Otherwise it equals the text sentiment.
 *
 * A model's bare sentiment label is an interpretation. It is kept only when
 * the quotations support it. Quotations are the evidence.
 *
 * Severity describes the complaint in the text, not the star rating:
 * none (no complaint), low (inconvenience), moderate (the customer wants a
 * correction), high (safety, loss of money, or they cannot use the service).
 *
 * Urgency: none, soon (a fix is asked for), immediate (they are waiting now,
 * or describe a safety issue happening now).
 */
export const RATING_BANDS = ["low", "mid", "high"] as const;
export const TEXT_SENTIMENTS = ["positive", "mixed", "negative", "neutral", "unknown"] as const;
export const SEVERITIES = ["none", "low", "moderate", "high"] as const;
export const URGENCIES = ["none", "soon", "immediate"] as const;
export const ESCALATION_CODES = ["safety", "refund_or_billing", "abuse", "legal", "unresolved"] as const;
export const ENTITY_KINDS = ["product", "service", "facility", "staff_role", "area"] as const;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;

export type RatingBand = (typeof RATING_BANDS)[number];
export type TextSentiment = (typeof TEXT_SENTIMENTS)[number];

export interface ExtractionQuotation {
  topicCode: string;
  polarity: "praise" | "complaint" | "neutral";
  excerpt: string;
  /** The aspect in the customer's own wording, when the model provides it ("kidswear selection limited"). */
  phrase?: string;
  rank: "primary" | "secondary";
  confidence: number;
  uncertain: boolean;
}

export interface ExtractionEscalation {
  code: (typeof ESCALATION_CODES)[number];
  excerpt: string;
}

export interface ExtractionEntity {
  kind: (typeof ENTITY_KINDS)[number];
  label: string;
  excerpt: string;
}

export interface ReviewExtraction {
  analysisVersion: typeof EXTRACT_ANALYSIS_VERSION;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  promptVersion: typeof EXTRACT_PROMPT_VERSION;
  repaired: boolean;
  reused: boolean;
  facts: {
    rating: { stars: number; band: RatingBand };
    language: string;
    quotations: ExtractionQuotation[];
  };
  interpretation: {
    textSentiment: TextSentiment;
    overall: TextSentiment;
    severity: (typeof SEVERITIES)[number];
    urgency: (typeof URGENCIES)[number];
    escalation: ExtractionEscalation[];
    actionable: Array<{ topicCode: string; excerpt: string }>;
    entities: ExtractionEntity[];
    /** Staff members named in the review, exactly as written. */
    staffMentions: string[];
    /** Customer requests or wishes, copied from the comment. */
    requests: string[];
    uncertain: boolean;
    note: string;
  };
}

export class ExtractionRejected extends Error {
  readonly errorClass = "invalid_response";
  constructor(message: string) {
    super(message);
    this.name = "ExtractionRejected";
  }
}

export function ratingBand(stars: number): RatingBand {
  if (stars <= 2) return "low";
  if (stars === 3) return "mid";
  return "high";
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function sensitive(value: string): boolean {
  return EMAIL.test(value) || PHONE.test(value);
}

function quoteInComment(comment: string, excerpt: string): string | null {
  const text = clip(excerpt, 400);
  if (!text || sensitive(text) || !comment.includes(text)) return null;
  return text;
}

const looseAspect = z.object({
  topicCode: z.string().nullish(),
  topic: z.string().nullish(),
  code: z.string().nullish(),
  polarity: z.string().nullish(),
  excerpt: z.string().nullish(),
  quote: z.string().nullish(),
  phrase: z.string().nullish(),
  aspect: z.string().nullish(),
  confidence: z.number().nullish(),
  uncertain: z.boolean().nullish(),
  rank: z.string().nullish(),
}).strip();

const looseEscalation = z.object({
  code: z.string().nullish(),
  excerpt: z.string().nullish(),
}).strip();

const looseEntity = z.object({
  kind: z.string().nullish(),
  label: z.string().nullish(),
  excerpt: z.string().nullish(),
}).strip();

// The model emits null for fields it has nothing to say about ("note": null is
// the common case). Null must behave like an absent field, not reject the
// whole review.
const loosePayload = z.object({
  aspects: z.array(z.unknown()).nullish(),
  severity: z.string().nullish(),
  urgency: z.string().nullish(),
  escalation: z.array(z.unknown()).nullish(),
  entities: z.array(z.unknown()).nullish(),
  staff: z.array(z.unknown()).nullish(),
  staffMentions: z.array(z.unknown()).nullish(),
  requests: z.array(z.unknown()).nullish(),
  actionable: z.array(z.unknown()).nullish(),
  uncertain: z.boolean().nullish(),
  note: z.string().nullish(),
  textSentiment: z.string().nullish(),
}).strip();

function polarityOf(raw: string | null | undefined): ExtractionQuotation["polarity"] | null {
  if (raw === "praise" || raw === "positive") return "praise";
  if (raw === "complaint" || raw === "negative") return "complaint";
  if (raw === "neutral") return "neutral";
  return null;
}

export function textSentimentFrom(quotations: readonly ExtractionQuotation[]): TextSentiment {
  if (quotations.length === 0) return "unknown";
  const praise = quotations.some((item) => item.polarity === "praise");
  const complaint = quotations.some((item) => item.polarity === "complaint");
  if (praise && complaint) return "mixed";
  if (praise) return "positive";
  if (complaint) return "negative";
  return "neutral";
}

export function overallFrom(text: TextSentiment, band: RatingBand): TextSentiment {
  if (text === "unknown" || text === "mixed") return text;
  const ratingLeansNegative = band === "low" || band === "mid";
  if (text === "positive" && ratingLeansNegative) return "mixed";
  if (text === "negative" && band === "high") return "mixed";
  return text;
}

function asSeverity(raw: string | null | undefined, hasComplaint: boolean): ReviewExtraction["interpretation"]["severity"] {
  if (!hasComplaint) return "none";
  if (raw === "high" || raw === "moderate" || raw === "low") return raw;
  return "low";
}

function asUrgency(raw: string | null | undefined, hasComplaint: boolean): ReviewExtraction["interpretation"]["urgency"] {
  if (!hasComplaint) return "none";
  if (raw === "immediate" || raw === "soon") return raw;
  return "none";
}

export function buildRatingOnlyExtraction(stars: number): ReviewExtraction {
  return {
    analysisVersion: EXTRACT_ANALYSIS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: EXTRACT_PROMPT_VERSION,
    repaired: false,
    reused: false,
    facts: {
      rating: { stars, band: ratingBand(stars) },
      language: "none",
      quotations: [],
    },
    interpretation: {
      textSentiment: "unknown",
      overall: "unknown",
      severity: "none",
      urgency: "none",
      escalation: [],
      actionable: [],
      entities: [],
      staffMentions: [],
      requests: [],
      uncertain: false,
      note: "",
    },
  };
}

/**
 * Validates model JSON against the review text. Unknown topics, excerpts that
 * are not in the comment, and contact details are dropped. A payload that is
 * not JSON is rejected. A payload that can be reduced to valid quotations is
 * repaired and stored. The raw model string is not returned.
 */
export function validateModelExtraction(input: {
  comment: string;
  starRating: number;
  modelText: string;
}): ReviewExtraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.modelText);
  } catch {
    throw new ExtractionRejected("invalid_response: model output was not JSON");
  }
  const payload = loosePayload.safeParse(parsed);
  if (!payload.success) {
    throw new ExtractionRejected("invalid_response: model output was not an object");
  }

  let repaired = false;
  const quotations: ExtractionQuotation[] = [];
  const seen = new Set<string>();
  for (const item of payload.data.aspects ?? []) {
    const aspect = looseAspect.safeParse(item);
    if (!aspect.success) {
      repaired = true;
      continue;
    }
    const code = resolveTopicCode(aspect.data.topicCode ?? aspect.data.topic ?? aspect.data.code ?? "");
    const polarity = polarityOf(aspect.data.polarity);
    const excerpt = quoteInComment(input.comment, aspect.data.excerpt ?? aspect.data.quote ?? "");
    if (!code || !isLeafTopic(code) || code === "other" && !excerpt || !polarity || !excerpt) {
      repaired = true;
      continue;
    }
    if (code === "other" && excerpt.length < 8) {
      repaired = true;
      continue;
    }
    if ((polarity === "complaint" || polarity === "praise") && !excerptSupportsClaim(code, polarity, excerpt)) {
      repaired = true;
      continue;
    }
    if (aspect.data.uncertain === true) {
      repaired = true;
      continue;
    }
    const key = `${code}|${polarity}`;
    if (seen.has(key)) {
      repaired = true;
      continue;
    }
    seen.add(key);
    const confidence = aspect.data.confidence;
    const phraseRaw = clip(aspect.data.phrase ?? aspect.data.aspect ?? "", 80);
    quotations.push({
      topicCode: code,
      polarity,
      excerpt,
      ...(phraseRaw && !sensitive(phraseRaw) ? { phrase: phraseRaw } : {}),
      rank: "secondary",
      confidence: typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : 0.5,
      uncertain: false,
    });
    if (quotations.length >= 6) break;
  }
  if ((payload.data.aspects?.length ?? 0) > quotations.length) repaired = true;

  quotations.sort((a, b) => b.confidence - a.confidence);
  if (quotations[0]) quotations[0].rank = "primary";

  const hasComplaint = quotations.some((item) => item.polarity === "complaint");
  const escalation: ExtractionEscalation[] = [];
  for (const item of payload.data.escalation ?? []) {
    const row = looseEscalation.safeParse(item);
    if (!row.success) {
      repaired = true;
      continue;
    }
    const code = ESCALATION_CODES.find((allowed) => allowed === row.data.code);
    const excerpt = row.data.excerpt ? quoteInComment(input.comment, row.data.excerpt) : null;
    if (!code || !excerpt) {
      repaired = true;
      continue;
    }
    escalation.push({ code, excerpt });
  }

  const entities: ExtractionEntity[] = [];
  for (const item of payload.data.entities ?? []) {
    const row = looseEntity.safeParse(item);
    if (!row.success) {
      repaired = true;
      continue;
    }
    const kind = ENTITY_KINDS.find((allowed) => allowed === row.data.kind);
    const excerpt = row.data.excerpt ? quoteInComment(input.comment, row.data.excerpt) : null;
    const label = clip(row.data.label ?? "", 80);
    if (!kind || !excerpt || !label || sensitive(label)) {
      repaired = true;
      continue;
    }
    entities.push({ kind, label, excerpt });
    if (entities.length >= 6) break;
  }

  // Staff names and customer requests are only kept when the exact
  // wording appears in the comment, so the model cannot invent people
  // or wishes that were never expressed.
  const staffMentions: string[] = [];
  const staffSeen = new Set<string>();
  for (const item of [...(payload.data.staffMentions ?? []), ...(payload.data.staff ?? [])]) {
    const raw = typeof item === "string" ? item : (item as { name?: unknown })?.name;
    if (typeof raw !== "string") continue;
    const name = clip(raw.replace(/\s+/g, " "), 40);
    if (!name || sensitive(name)) continue;
    const key = name.toLowerCase();
    if (staffSeen.has(key)) continue;
    if (!input.comment.toLowerCase().includes(key)) {
      repaired = true;
      continue;
    }
    staffSeen.add(key);
    staffMentions.push(name);
    if (staffMentions.length >= 4) break;
  }

  const requests: string[] = [];
  for (const item of payload.data.requests ?? []) {
    const raw = typeof item === "string" ? item : (item as { text?: unknown; excerpt?: unknown })?.text ?? (item as { excerpt?: unknown })?.excerpt;
    if (typeof raw !== "string") continue;
    const quote = quoteInComment(input.comment, raw);
    if (!quote) {
      repaired = true;
      continue;
    }
    if (!requests.includes(quote)) requests.push(quote.slice(0, 160));
    if (requests.length >= 3) break;
  }

  const actionable: Array<{ topicCode: string; excerpt: string }> = [];
  for (const item of payload.data.actionable ?? []) {
    const row = looseAspect.safeParse(item);
    if (!row.success) continue;
    const code = resolveTopicCode(row.data.topicCode ?? row.data.code ?? "");
    const excerpt = quoteInComment(input.comment, row.data.excerpt ?? "");
    if (!code || !excerpt || !hasComplaint) {
      repaired = true;
      continue;
    }
    actionable.push({ topicCode: code, excerpt });
  }

  const textSentiment = textSentimentFrom(quotations);
  const modelAskedPositive = payload.data.textSentiment === "positive" || payload.data.textSentiment === "negative";
  if (modelAskedPositive && textSentiment === "unknown") repaired = true;

  return {
    analysisVersion: EXTRACT_ANALYSIS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: EXTRACT_PROMPT_VERSION,
    repaired,
    reused: false,
    facts: {
      rating: { stars: input.starRating, band: ratingBand(input.starRating) },
      language: detectReviewLanguage(input.comment),
      quotations,
    },
    interpretation: {
      textSentiment,
      overall: overallFrom(textSentiment, ratingBand(input.starRating)),
      severity: asSeverity(payload.data.severity, hasComplaint),
      urgency: asUrgency(payload.data.urgency, hasComplaint),
      escalation,
      actionable,
      entities,
      staffMentions,
      requests,
      uncertain: payload.data.uncertain === true || quotations.some((item) => item.uncertain) || textSentiment === "unknown",
      note: clip(payload.data.note ?? "", 240),
    },
  };
}

export function extractFromReview(input: {
  comment: string | null;
  starRating: number;
  modelText: string | null;
}): ReviewExtraction {
  const comment = input.comment?.trim() ? input.comment : null;
  if (!comment) return buildRatingOnlyExtraction(input.starRating);
  if (!input.modelText) {
    throw new ExtractionRejected("invalid_response: a review with text needs model output");
  }
  return validateModelExtraction({ comment, starRating: input.starRating, modelText: input.modelText });
}

export interface BoundAssignment {
  workspaceId: string;
  reviewId: string;
  analysisVersion: typeof EXTRACT_ANALYSIS_VERSION;
  topicCode: string;
  polarity: ExtractionQuotation["polarity"];
  excerpt: string;
  rank: "primary" | "secondary";
  confidence: number;
  uncertain: boolean;
  sentiment: TextSentiment;
}

/** Every assignment is a quotation from this review and this analysis version. */
export function bindAssignments(input: {
  workspaceId: string;
  reviewId: string;
  comment: string | null;
  extraction: ReviewExtraction;
}): BoundAssignment[] {
  const comment = input.comment ?? "";
  return input.extraction.facts.quotations.map((quotation) => {
    if (!comment.includes(quotation.excerpt)) {
      throw new Error("Assignment excerpt is not in this review");
    }
    const sentiment: TextSentiment =
      quotation.polarity === "praise" ? "positive" : quotation.polarity === "complaint" ? "negative" : "neutral";
    return {
      workspaceId: input.workspaceId,
      reviewId: input.reviewId,
      analysisVersion: EXTRACT_ANALYSIS_VERSION,
      topicCode: quotation.topicCode,
      polarity: quotation.polarity,
      excerpt: quotation.excerpt,
      rank: quotation.rank,
      confidence: quotation.confidence,
      uncertain: quotation.uncertain,
      sentiment,
    };
  });
}

export function shouldReuseExtraction(existing: {
  contentHash: string;
  analysisVersion: string;
  taxonomyVersion: string;
  promptVersion: string;
  status: string;
  isCurrent: boolean;
} | null, contentHash: string): boolean {
  if (!existing || !existing.isCurrent || existing.status !== "ready") return false;
  return (
    existing.contentHash === contentHash &&
    existing.analysisVersion === EXTRACT_ANALYSIS_VERSION &&
    existing.taxonomyVersion === TAXONOMY_VERSION &&
    existing.promptVersion === EXTRACT_PROMPT_VERSION
  );
}
