import { createHash } from "crypto";
import { AppError } from "@/lib/errors";

/**
 * Review-level intelligence. One written review yields any number of
 * observations; praise and complaints are separate rows and are never
 * merged. Counts in this module are computed from stored observations,
 * never taken from model output.
 */

export const ANALYSIS_VERSION = "obs-v1";

export const OBSERVATION_SENTIMENTS = ["positive", "negative", "neutral", "mixed"] as const;
export type ObservationSentiment = (typeof OBSERVATION_SENTIMENTS)[number];

export const ENTITY_TYPES = [
  "staff",
  "product",
  "clothing_category",
  "outlet",
  "service",
  "billing",
  "refund",
  "price",
  "facility",
  "other",
] as const;
export type ObservationEntityType = (typeof ENTITY_TYPES)[number];

/** Standard reporting categories. A subtopic always keeps the customer's specific meaning. */
export const STANDARD_TOPICS = [
  "staff",
  "product_quality",
  "assortment",
  "price",
  "billing",
  "refunds_returns",
  "service_speed",
  "cleanliness",
  "store_experience",
  "other",
] as const;

export interface ExtractedObservation {
  topic: string;
  subtopic: string | null;
  sentiment: ObservationSentiment;
  detail: string;
  entityType: ObservationEntityType | null;
  entityName: string | null;
  severity: number | null;
  severityRationale: string | null;
  evidenceExcerpt: string;
  evidenceStart: number | null;
  evidenceEnd: number | null;
  basis: "fact" | "hypothesis";
  confidence: number | null;
  isAmbiguous: boolean;
  dedupeKey: string;
}

export interface ObservationRow extends ExtractedObservation {
  reviewId: string;
  locationId: string;
  clientId: string | null;
  groupId: string | null;
  reviewCreateTime: string;
  starRating: number;
}

const HARM_TERMS =
  /\b(injur|hurt|bleed|blood|sick|vomit|food poison|contaminat|hair in|insect|cockroach|rat\b|discriminat|racist|caste|harass|abuse|threat|cheat|fraud|scam|stole|theft|police|legal|consumer court|unsafe|dangerous|allergy|hospital)\b/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function clampSeverity(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function clampConfidence(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

export function observationDedupeKey(input: {
  topic: string;
  sentiment: string;
  entityName: string | null;
  evidenceExcerpt: string;
}): string {
  const raw = [
    input.topic,
    input.sentiment,
    (input.entityName ?? "").toLowerCase(),
    collapse(input.evidenceExcerpt).toLowerCase(),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Documented severity scale for negative observations. Severity describes
 * the alleged incident as reported; it is not a verification status. An
 * allegation can be high severity and still unproven — basis and the
 * excerpt keep that distinction visible.
 *   1 low      Minor annoyance, no lasting impact (slow queue, small mess).
 *   2 low      Noticeable inconvenience the customer absorbed (long wait, missing common size).
 *   3 moderate Real service/product failure affecting the purchase (defect, wrong billing corrected on request, unavailable advertised item).
 *   4 high     Serious failure needing management action (double charge, refusal of refund, discriminatory or abusive treatment alleged).
 *   5 critical Harm or risk: illness, injury, contamination, safety hazard, fraud, or abuse alleged.
 */
export const SEVERITY_LABELS: Record<number, string> = {
  1: "low",
  2: "low",
  3: "moderate",
  4: "high",
  5: "critical",
};

export function severityLabel(severity: number | null | undefined): string {
  if (!severity) return "unrated";
  return SEVERITY_LABELS[Math.min(5, Math.max(1, Math.round(severity)))] ?? "unrated";
}

/**
 * A single severe complaint must surface even when it happens once, and a
 * serious allegation counts whatever the star rating says: a five-star
 * review can contain a critical complaint.
 */
export function isSevereIncident(input: {
  sentiment: string;
  severity: number | null;
  evidenceExcerpt: string;
  starRating: number;
}): boolean {
  if (input.sentiment !== "negative") return false;
  if ((input.severity ?? 0) >= 4) return true;
  return HARM_TERMS.test(input.evidenceExcerpt);
}

/**
 * Validates raw model observations against the original comment.
 * An observation survives only when its excerpt is found in the comment
 * (whitespace-normalised). Sentiments stay exactly as classified; praise
 * is never folded into a complaint or the reverse.
 */
export function validateObservations(raw: unknown, comment: string): ExtractedObservation[] {
  if (!Array.isArray(raw)) return [];
  const source = collapse(comment);
  const out: ExtractedObservation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sentiment = OBSERVATION_SENTIMENTS.includes(row.sentiment as ObservationSentiment)
      ? (row.sentiment as ObservationSentiment)
      : null;
    if (!sentiment) continue;
    const excerptRaw = typeof row.evidenceExcerpt === "string" ? collapse(row.evidenceExcerpt) : "";
    if (!excerptRaw) continue;
    const at = source.toLowerCase().indexOf(excerptRaw.toLowerCase());
    if (at < 0) continue;
    const evidenceExcerpt = source.slice(at, at + excerptRaw.length);
    const topicInput = typeof row.topic === "string" && row.topic.trim() ? row.topic.trim() : "other";
    const topic = (STANDARD_TOPICS as readonly string[]).includes(slug(topicInput))
      ? slug(topicInput)
      : slug(topicInput) || "other";
    const entityType = ENTITY_TYPES.includes(row.entityType as ObservationEntityType)
      ? (row.entityType as ObservationEntityType)
      : null;
    const confidence = clampConfidence(row.confidence);
    const observation: ExtractedObservation = {
      topic,
      subtopic:
        typeof row.subtopic === "string" && row.subtopic.trim() ? row.subtopic.trim().slice(0, 120) : null,
      sentiment,
      detail:
        typeof row.detail === "string" && row.detail.trim()
          ? row.detail.trim().slice(0, 500)
          : evidenceExcerpt.slice(0, 500),
      entityType,
      entityName:
        typeof row.entityName === "string" && row.entityName.trim()
          ? row.entityName.trim().slice(0, 120)
          : null,
      severity: sentiment === "negative" ? clampSeverity(row.severity) : null,
      severityRationale:
        sentiment === "negative" && typeof row.severityRationale === "string" && row.severityRationale.trim()
          ? row.severityRationale.trim().slice(0, 300)
          : null,
      evidenceExcerpt,
      evidenceStart: at,
      evidenceEnd: at + evidenceExcerpt.length,
      basis: row.basis === "hypothesis" ? "hypothesis" : "fact",
      confidence,
      isAmbiguous: row.isAmbiguous === true || (confidence !== null && confidence < 0.6),
      dedupeKey: "",
    };
    observation.dedupeKey = observationDedupeKey(observation);
    out.push(observation);
  }
  return dedupeObservations(out);
}

/** Idempotency inside one analysis: identical points are stored once. */
export function dedupeObservations(rows: ExtractedObservation[]): ExtractedObservation[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.dedupeKey)) return false;
    seen.add(row.dedupeKey);
    return true;
  });
}

export function extractionPrompt(input: { comment: string; starRating: number }): string {
  return `You extract structured observations from one Google review. Return JSON only: {"observations":[...]}.

Rules:
- One observation per distinct point. A review can praise one thing and complain about another: return both, as separate observations. Never merge praise and a complaint into one item.
- Sentiment per observation: "positive", "negative", "neutral", or "mixed" only when the point itself is genuinely both.
- Keep every meaningful point, including a problem that occurs only once in this review. Do not drop a point because it seems minor or unusual.
- topic: one of ${STANDARD_TOPICS.join(", ")}. If none fits, use a short snake_case topic of your own instead of forcing a fit.
- subtopic: the specific thing in the customer's words (for example "missing sizes", "jeans quality", "billing counter behaviour").
- detail: one sentence stating the specific issue, strength, event, or request.
- entityType: one of ${ENTITY_TYPES.join(", ")} when a specific entity is identifiable, else null. entityName: a staff name, product, clothing category, or other name exactly as written, else null. Never invent a name.
- Negative observations: severity on this scale, with severityRationale in a few words. 1 low: minor annoyance. 2 low: noticeable inconvenience. 3 moderate: real failure affecting the purchase (defect, wrong billing). 4 high: serious failure needing management action (double charge, refused refund, discriminatory or abusive treatment alleged). 5 critical: harm or risk alleged (illness, injury, contamination, safety, fraud, abuse). Severity describes the allegation as reported, not a verified fact. Positive observations: severity null.
- evidenceExcerpt: an exact quote from the review that proves the point. Copy it word for word; do not paraphrase inside the quote.
- basis: "fact" when the review states it directly, "hypothesis" when it is your interpretation.
- confidence: 0 to 1. isAmbiguous: true when the wording is unclear or could mean two things.
- Do not invent facts, causes, names, or events that are not in the review.

Star rating: ${input.starRating}/5
Review:
"""${input.comment.slice(0, 4000)}"""`;
}

export function parseExtractionResponse(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { observations?: unknown };
    return parsed.observations ?? null;
  } catch {
    return null;
  }
}

export interface TopicCount {
  topic: string;
  count: number;
  reviews: number;
}

export interface ObservationAggregates {
  reviewsAnalysed: number;
  observations: number;
  positive: TopicCount[];
  negative: TopicCount[];
  severeIncidents: ObservationRow[];
  staffPraise: Array<{ name: string; count: number }>;
  staffComplaints: Array<{ name: string; count: number }>;
  byOutlet: Array<{ locationId: string; positive: number; negative: number; severe: number }>;
  /** Distinct analysed reviews per outlet — the denominator for outlet rates. */
  outletReviews: Record<string, number>;
  byMonth: Array<{ month: string; positive: number; negative: number }>;
  topicRelationships: Array<{ pair: [string, string]; reviews: number }>;
  firstSeenByTopic: Record<string, string>;
}

function topicCounts(rows: ObservationRow[]): TopicCount[] {
  const byTopic = new Map<string, { count: number; reviews: Set<string> }>();
  for (const row of rows) {
    const entry = byTopic.get(row.topic) ?? { count: 0, reviews: new Set<string>() };
    entry.count += 1;
    entry.reviews.add(row.reviewId);
    byTopic.set(row.topic, entry);
  }
  return [...byTopic.entries()]
    .map(([topic, entry]) => ({ topic, count: entry.count, reviews: entry.reviews.size }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function staffNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Prefer a cased spelling ("Sanjana") over an all-lowercase duplicate. */
function preferStaffName(current: string, next: string): string {
  const currentCased = current !== current.toLowerCase();
  const nextCased = next !== next.toLowerCase();
  if (nextCased && !currentCased) return next;
  return current;
}

function entityCounts(rows: ObservationRow[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    if (row.entityType !== "staff" || !row.entityName?.trim()) continue;
    const display = row.entityName.trim().replace(/\s+/g, " ");
    const key = staffNameKey(display);
    const entry = counts.get(key) ?? { name: display, count: 0 };
    entry.count += 1;
    entry.name = preferStaffName(entry.name, display);
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Counts computed from stored observations. Frequency never filters anything out. */
export function aggregateObservations(rows: ObservationRow[]): ObservationAggregates {
  const positive = rows.filter((row) => row.sentiment === "positive");
  const negative = rows.filter((row) => row.sentiment === "negative");

  const outlets = new Map<string, { locationId: string; positive: number; negative: number; severe: number }>();
  const outletReviewSets = new Map<string, Set<string>>();
  const months = new Map<string, { month: string; positive: number; negative: number }>();
  const topicsByReview = new Map<string, Set<string>>();
  const firstSeenByTopic: Record<string, string> = {};

  for (const row of rows) {
    const outlet = outlets.get(row.locationId) ?? { locationId: row.locationId, positive: 0, negative: 0, severe: 0 };
    if (row.sentiment === "positive") outlet.positive += 1;
    if (row.sentiment === "negative") outlet.negative += 1;
    if (isSevereIncident(row)) outlet.severe += 1;
    outlets.set(row.locationId, outlet);
    const reviewSet = outletReviewSets.get(row.locationId) ?? new Set<string>();
    reviewSet.add(row.reviewId);
    outletReviewSets.set(row.locationId, reviewSet);

    const month = row.reviewCreateTime.slice(0, 7);
    const bucket = months.get(month) ?? { month, positive: 0, negative: 0 };
    if (row.sentiment === "positive") bucket.positive += 1;
    if (row.sentiment === "negative") bucket.negative += 1;
    months.set(month, bucket);

    const topics = topicsByReview.get(row.reviewId) ?? new Set<string>();
    topics.add(row.topic);
    topicsByReview.set(row.reviewId, topics);

    if (!firstSeenByTopic[row.topic] || row.reviewCreateTime < firstSeenByTopic[row.topic]!) {
      firstSeenByTopic[row.topic] = row.reviewCreateTime;
    }
  }

  const pairs = new Map<string, { pair: [string, string]; reviews: number }>();
  for (const topics of topicsByReview.values()) {
    const sorted = [...topics].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = `${sorted[i]}|${sorted[j]}`;
        const entry = pairs.get(key) ?? { pair: [sorted[i]!, sorted[j]!] as [string, string], reviews: 0 };
        entry.reviews += 1;
        pairs.set(key, entry);
      }
    }
  }

  return {
    reviewsAnalysed: new Set(rows.map((row) => row.reviewId)).size,
    observations: rows.length,
    positive: topicCounts(positive),
    negative: topicCounts(negative),
    severeIncidents: rows
      .filter((row) => isSevereIncident(row))
      .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.reviewCreateTime.localeCompare(b.reviewCreateTime)),
    staffPraise: entityCounts(positive),
    staffComplaints: entityCounts(negative),
    byOutlet: [...outlets.values()].sort((a, b) => b.negative - a.negative || b.positive - a.positive),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    topicRelationships: [...pairs.values()]
      .filter((entry) => entry.reviews >= 2)
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 20),
    outletReviews: Object.fromEntries(
      [...outletReviewSets.entries()].map(([locationId, set]) => [locationId, set.size])
    ),
    firstSeenByTopic,
  };
}

// ---------------------------------------------------------------------------
// Batching. Reviews are analysed in bounded multi-review calls. Bounds come
// from the models in use: output is capped per call, and each review needs
// roughly 150-300 output tokens of observation JSON, so a batch is limited
// both by estimated input tokens and by review count.
// ---------------------------------------------------------------------------

export const BATCH_MAX_REVIEWS = 25;
export const BATCH_MAX_INPUT_TOKENS = 12_000;
/** Fixed prompt cost charged per review inside a batch (id line, stars, framing). */
const BATCH_PER_REVIEW_OVERHEAD_TOKENS = 60;

/** Conservative token estimate: ~4 characters per token for mixed English/Malayalam text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BatchableReview {
  id: string;
  comment: string;
  starRating: number;
}

export function buildBatches<T extends BatchableReview>(
  reviews: readonly T[],
  limits: { maxReviews?: number; maxInputTokens?: number } = {}
): T[][] {
  const maxReviews = limits.maxReviews ?? BATCH_MAX_REVIEWS;
  const maxInputTokens = limits.maxInputTokens ?? BATCH_MAX_INPUT_TOKENS;
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;
  for (const review of reviews) {
    const cost = estimateTokens(review.comment) + BATCH_PER_REVIEW_OVERHEAD_TOKENS;
    if (current.length > 0 && (current.length >= maxReviews || currentTokens + cost > maxInputTokens)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(review);
    currentTokens += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function batchExtractionPrompt(reviews: readonly BatchableReview[]): string {
  const blocks = reviews
    .map(
      (review) =>
        `REVIEW ${review.id}\nStar rating: ${review.starRating}/5\n"""${review.comment.slice(0, 4000)}"""`
    )
    .join("\n\n");
  return `You extract structured observations from Google reviews. Return JSON only:
{"results":[{"reviewId":"<id copied exactly>","observations":[...]}]}

Include one result for every REVIEW below, even when its observations list is empty. Copy each reviewId exactly; never invent an id.

For each review, follow these rules:
- One observation per distinct point. A review can praise one thing and complain about another: return both, as separate observations. Never merge praise and a complaint into one item, and never collapse distinct complaints into one generic statement.
- Sentiment per observation: "positive", "negative", "neutral", or "mixed" only when the point itself is genuinely both. Judge the point itself, not the star rating: a five-star review can contain a serious complaint.
- Keep every meaningful point, including a problem that occurs only once in this review. Do not drop a point because it seems minor or unusual.
- topic: one of ${STANDARD_TOPICS.join(", ")}. If none fits, use a short snake_case topic of your own instead of forcing a fit.
- subtopic: the specific thing in the customer's words (for example "missing sizes", "jeans quality", "billing counter behaviour").
- detail: one sentence stating the specific issue, strength, event, or request, preserving product, outlet, and qualifier details.
- entityType: one of ${ENTITY_TYPES.join(", ")} when a specific entity is identifiable, else null. entityName: a staff name, product, clothing category, or other name exactly as written, else null. Never invent a name.
- Negative observations: severity on this scale, with severityRationale in a few words. 1 low: minor annoyance. 2 low: noticeable inconvenience. 3 moderate: real failure affecting the purchase (defect, wrong billing). 4 high: serious failure needing management action (double charge, refused refund, discriminatory or abusive treatment alleged). 5 critical: harm or risk alleged (illness, injury, contamination, safety, fraud, abuse). Severity describes the allegation as reported, not a verified fact. Positive observations: severity null.
- evidenceExcerpt: an exact quote from that review that proves the point. Copy it word for word; do not paraphrase inside the quote.
- basis: "fact" when the review states it directly, "hypothesis" when it is your interpretation. Do not present an interpretation as a fact.
- confidence: 0 to 1. isAmbiguous: true when the wording is unclear or could mean two things.
- Do not invent facts, causes, names, products, counts, or dates that are not in the review.

${blocks}`;
}

export interface BatchSplit {
  /** Raw observations per review id in the batch. Only ids from the batch appear. */
  byReview: Map<string, unknown[]>;
  /** Batch ids the model did not return. These must be recorded as failed, never skipped silently. */
  missingReviewIds: string[];
  /** Ids the model returned that are not in the batch. Dropped and counted. */
  unknownReviewIds: string[];
}

export function splitBatchResults(batch: readonly BatchableReview[], parsed: unknown): BatchSplit {
  const wanted = new Set(batch.map((review) => review.id));
  const byReview = new Map<string, unknown[]>();
  const unknownReviewIds: string[] = [];
  const results =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)
      ? ((parsed as { results: unknown[] }).results)
      : [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as { reviewId?: unknown; observations?: unknown };
    if (typeof row.reviewId !== "string") continue;
    if (!wanted.has(row.reviewId)) {
      unknownReviewIds.push(row.reviewId);
      continue;
    }
    byReview.set(row.reviewId, Array.isArray(row.observations) ? row.observations : []);
  }
  return {
    byReview,
    missingReviewIds: batch.filter((review) => !byReview.has(review.id)).map((review) => review.id),
    unknownReviewIds,
  };
}

export function parseBatchExtractionResponse(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Bounded exponential backoff for transient failures. Returns the value or rethrows the last error. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  input: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, error: unknown) => void } = {}
): Promise<T> {
  const attempts = input.attempts ?? 3;
  const baseDelayMs = input.baseDelayMs ?? 800;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      // Configuration, refusal, invalid output and unknown paid outcomes are not retryable.
      if (error && typeof error === "object" && "retryable" in error && error.retryable === false) throw error;
      if (error instanceof AppError && !["AI_QUOTA", "AI_UNAVAILABLE"].includes(error.code)) throw error;
      if (attempt >= attempts) break;
      input.onRetry?.(attempt, error);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
