import { createHash } from "node:crypto";
import {
  ANALYSIS_VERSION,
  STANDARD_TOPICS,
  type ObservationAggregates,
} from "@/lib/review-intelligence";

export const INSIGHT_PROMPT_VERSION = "insight-v3";

export type InsightSentiment = "positive" | "negative";

export type InsightCategory =
  | "recurring_strength"
  | "recurring_issue"
  | "serious_incident"
  | "staff_recognition"
  | "staff_complaint"
  | "product_quality"
  | "service_quality"
  | "trend"
  | "outlet_comparison"
  | "relationship"
  | "emerging_theme";

/** One persisted insight. Numbers always come from the database, never from model prose. */
export interface InsightRecord {
  id: string;
  category: InsightCategory;
  sentiment: InsightSentiment;
  title: string;
  detail: string;
  /** 1 (minor) to 5 (critical) business importance, where applicable. */
  importance: number | null;
  severity: number | null;
  evidenceReviewIds: string[];
  evidenceExcerpts: string[];
  supportingReviews: number;
  denominator: number | null;
  calculation: string;
  context: string;
  confidence: number | null;
  limitations: string[];
  suggestedAction: string | null;
}

export interface SampleObservation {
  reviewId: string;
  locationId: string;
  topic: string;
  sentiment: string;
  entityType: string | null;
  entityName: string | null;
  severity: number | null;
  evidenceExcerpt: string;
}

export interface EvidenceItem {
  key: string;
  category: InsightCategory;
  sentiment: InsightSentiment;
  title: string;
  statLine: string;
  supportingReviews: number;
  denominator: number | null;
  calculation: string;
  context: string;
  severity: number | null;
  evidenceReviewIds: string[];
  evidenceExcerpts: string[];
  limitations: string[];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Sorted, de-duplicated location ids — the normalised scope identity. */
export function normaliseLocationIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Cache identity for a report. Any change to organisation, scope, range,
 * analysis schema, prompt version, or model configuration produces a
 * different key, so a stale report is never served for changed inputs.
 */
/**
 * Preset windows ("last month") resolve to slightly different instants on
 * every request. Truncating bounds to the UTC day keeps the identity
 * stable within a day; the data fingerprint remains the real validity
 * check, so a same-day boundary shift can never serve stale insights.
 */
function dayBound(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function computeReportCacheKey(input: {
  workspaceId: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  locationIds: readonly string[];
  rangeStart: string | null;
  rangeEnd: string | null;
  model: string;
}): string {
  return hash(
    JSON.stringify({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      groupId: input.groupId,
      locationId: input.locationId,
      locationIds: normaliseLocationIds(input.locationIds),
      rangeStart: dayBound(input.rangeStart),
      rangeEnd: dayBound(input.rangeEnd),
      analysisVersion: ANALYSIS_VERSION,
      promptVersion: INSIGHT_PROMPT_VERSION,
      model: input.model,
    })
  );
}

/**
 * Fingerprint of the exact source data a report was built from: every
 * eligible review's id and content fingerprint. A new, removed, or edited
 * review changes it — including when a six-month window overlaps a
 * three-month one, where the fingerprint simply covers more reviews
 * (reviews are never double-counted; ids are a set).
 */
export function computeScopeDataFingerprint(
  entries: readonly { reviewId: string; fingerprint: string }[],
  failedCount: number
): string {
  const sorted = [...entries].sort((a, b) => a.reviewId.localeCompare(b.reviewId));
  return hash(
    sorted.map((e) => `${e.reviewId}:${e.fingerprint}`).join("\n") + `\nfailed:${failedCount}`
  );
}

export type ReportAction = "reuse" | "wait" | "generate";

/**
 * Cache decision. Reuse only a completed/partial report whose data
 * fingerprint still matches the live review set; wait only for a fresh
 * in-progress job (the unique cache key prevents duplicate generation).
 */
export function decideReportAction(
  existing: { status: string; dataFingerprint: string | null; updatedAt: string } | null,
  currentFingerprint: string,
  now: Date = new Date()
): ReportAction {
  if (!existing) return "generate";
  if (existing.status === "processing" || existing.status === "pending") {
    // Healthy jobs heartbeat as they work; five silent minutes = owner gone.
    const ageMs = now.getTime() - new Date(existing.updatedAt).getTime();
    return ageMs < 5 * 60 * 1000 ? "wait" : "generate";
  }
  if (
    (existing.status === "completed" || existing.status === "partial") &&
    existing.dataFingerprint === currentFingerprint
  ) {
    return "reuse";
  }
  return "generate";
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function samplesFor(
  samples: SampleObservation[],
  predicate: (s: SampleObservation) => boolean,
  limit = 5
): SampleObservation[] {
  return samples.filter(predicate).slice(0, limit);
}

/**
 * Evidence for aggregate items (topics, trends, outlets, relationships):
 * severe one-off incidents already get their own prominent cards, so
 * they are used as illustrative samples only when nothing else exists.
 * Otherwise a single dramatic review becomes the face of every theme.
 */
function illustrativeSamples(
  samples: SampleObservation[],
  predicate: (s: SampleObservation) => boolean,
  limit = 5
): SampleObservation[] {
  const picked = samples.filter(predicate);
  const ordinary = picked.filter((s) => (s.severity ?? 0) < 4);
  const severe = picked.filter((s) => (s.severity ?? 0) >= 4);
  return [...ordinary, ...severe].slice(0, limit);
}

const PRODUCT_TOPICS = new Set(["product_quality", "assortment", "pricing", "availability"]);
const STANDARD_TOPIC_SET = new Set<string>(STANDARD_TOPICS);

function topicCategory(topic: string, sentiment: InsightSentiment): InsightCategory {
  if (PRODUCT_TOPICS.has(topic)) return "product_quality";
  if (sentiment === "positive") return "recurring_strength";
  return "recurring_issue";
}

/**
 * Builds the evidence pack the synthesis model may interpret. Every item
 * carries database-computed counts and real excerpts; the model writes
 * prose only. Positive and negative items are always separate.
 */
export function buildEvidenceItems(input: {
  aggregates: ObservationAggregates;
  previous: ObservationAggregates | null;
  previousEligible: number;
  samples: SampleObservation[];
  outletNames: Record<string, string>;
}): EvidenceItem[] {
  const { aggregates, previous, samples, outletNames } = input;
  const items: EvidenceItem[] = [];
  const denominator = aggregates.reviewsAnalysed;

  for (const [list, sentiment] of [
    [aggregates.positive, "positive"],
    [aggregates.negative, "negative"],
  ] as const) {
    for (const entry of list.slice(0, 8)) {
      const picked = illustrativeSamples(
        samples,
        (s) => s.topic === entry.topic && s.sentiment === sentiment
      );
      items.push({
        key: `topic:${sentiment}:${entry.topic}`,
        category: topicCategory(entry.topic, sentiment),
        sentiment,
        title: entry.topic.replace(/_/g, " "),
        statLine: `${entry.reviews} of ${denominator} analysed written reviews (${pct(entry.reviews, denominator)}) mention ${entry.topic.replace(/_/g, " ")} ${sentiment === "positive" ? "positively" : "negatively"} across ${entry.count} observations.`,
        supportingReviews: entry.reviews,
        denominator,
        calculation: "reviews mentioning topic ÷ analysed written reviews",
        context: `topic ${entry.topic}`,
        severity: null,
        evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
        evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
        limitations: [],
      });
      if (!STANDARD_TOPIC_SET.has(entry.topic) && entry.reviews >= 2) {
        items.push({
          key: `emerging:${sentiment}:${entry.topic}`,
          category: "emerging_theme",
          sentiment,
          title: `Emerging theme: ${entry.topic.replace(/_/g, " ")}`,
          statLine: `${entry.topic.replace(/_/g, " ")} is not in the standard taxonomy but appears in ${entry.reviews} reviews. Treat it as an emerging theme worth watching.`,
          supportingReviews: entry.reviews,
          denominator,
          calculation: "reviews mentioning non-taxonomy topic ÷ analysed written reviews",
          context: `emerging topic ${entry.topic}`,
          severity: null,
          evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
          evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
          limitations: ["Theme name was assigned by the extraction model, not the fixed taxonomy."],
        });
      }
    }
  }

  // Serious incidents: independent of frequency. One credible report is enough.
  for (const incident of aggregates.severeIncidents.slice(0, 10)) {
    items.push({
      key: `severe:${incident.reviewId}:${incident.topic}`,
      category: "serious_incident",
      sentiment: "negative",
      title: `Serious incident: ${incident.topic.replace(/_/g, " ")}`,
      statLine: `Single reported incident (severity ${incident.severity ?? "unrated"}/5) in a ${incident.starRating}-star review dated ${incident.reviewCreateTime.slice(0, 10)}. This is one customer's allegation: surface it for verification, do not state it as proven fact.`,
      supportingReviews: 1,
      denominator,
      calculation: "single reported incident; frequency is not the criterion",
      context: `topic ${incident.topic}`,
      severity: incident.severity,
      evidenceReviewIds: [incident.reviewId],
      evidenceExcerpts: [incident.evidenceExcerpt],
      limitations: ["Single reported incident requiring verification."],
    });
  }

  const severeReviewIds = new Set(aggregates.severeIncidents.map((i) => i.reviewId));

  for (const [list, sentiment, category] of [
    [aggregates.staffPraise, "positive", "staff_recognition"],
    [aggregates.staffComplaints, "negative", "staff_complaint"],
  ] as const) {
    for (const entry of list.slice(0, 6)) {
      const picked = samplesFor(
        samples,
        (s) =>
          s.entityType === "staff" &&
          s.entityName?.trim().toLowerCase() === entry.name.trim().toLowerCase() &&
          s.sentiment === sentiment
      );
      // One incident, one story: if every review behind this staff
      // complaint is already a severe incident with its own card, a
      // second "staff complaint" card would portray the same event
      // twice. Repeat complaints from other reviews still surface.
      if (
        category === "staff_complaint" &&
        picked.length > 0 &&
        picked.every((sample) => severeReviewIds.has(sample.reviewId))
      ) {
        continue;
      }
      items.push({
        key: `staff:${sentiment}:${entry.name.toLowerCase()}`,
        category: category as InsightCategory,
        sentiment,
        title: entry.name,
        statLine: `${entry.name} is named in ${entry.count} ${sentiment} staff observations.`,
        supportingReviews: Math.max(new Set(picked.map((s) => s.reviewId)).size, 1),
        denominator,
        calculation: "staff observations naming this person (sample of source reviews attached)",
        context: `staff member ${entry.name}`,
        severity: null,
        evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
        evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
        limitations: [],
      });
    }
  }

  // Trends: equivalent previous interval, absolute counts AND rates, per sentiment.
  if (previous && input.previousEligible >= 10 && denominator >= 10) {
    for (const sentiment of ["positive", "negative"] as const) {
      const current = sentiment === "positive" ? aggregates.positive : aggregates.negative;
      const before = sentiment === "positive" ? previous.positive : previous.negative;
      const beforeByTopic = new Map(before.map((t) => [t.topic, t]));
      const movers = current
        .map((entry) => {
          const prev = beforeByTopic.get(entry.topic);
          const prevReviews = prev?.reviews ?? 0;
          const rateNow = denominator > 0 ? entry.reviews / denominator : 0;
          const ratePrev = previous.reviewsAnalysed > 0 ? prevReviews / previous.reviewsAnalysed : 0;
          return { entry, prevReviews, deltaRate: rateNow - ratePrev };
        })
        .filter((m) => Math.abs(m.deltaRate) >= 0.02 || Math.abs(m.entry.reviews - m.prevReviews) >= 3)
        .sort((a, b) => Math.abs(b.deltaRate) - Math.abs(a.deltaRate))
        .slice(0, 4);
      for (const mover of movers) {
        const picked = illustrativeSamples(
          samples,
          (s) => s.topic === mover.entry.topic && s.sentiment === sentiment,
          3
        );
        items.push({
          key: `trend:${sentiment}:${mover.entry.topic}`,
          category: "trend",
          sentiment,
          title: `${mover.entry.topic.replace(/_/g, " ")} trend`,
          statLine: `${mover.entry.topic.replace(/_/g, " ")} (${sentiment}): ${mover.entry.reviews} reviews this period (${pct(mover.entry.reviews, denominator)} of ${denominator}) vs ${mover.prevReviews} in the previous equivalent period (${pct(mover.prevReviews, previous.reviewsAnalysed)} of ${previous.reviewsAnalysed}). Review volumes differ between periods, so compare the rates, not just the counts. This shows association over time, not causation.`,
          supportingReviews: mover.entry.reviews,
          denominator,
          calculation: "topic review rate this period vs previous equivalent period",
          context: `trend for topic ${mover.entry.topic}`,
          severity: null,
          evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
          evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
          limitations: ["Trend compares equivalent intervals; it does not prove cause."],
        });
      }
    }
  }

  // Outlet comparisons with denominators and sample-size caveats.
  for (const outlet of aggregates.byOutlet) {
    const reviews = aggregates.outletReviews[outlet.locationId] ?? 0;
    if (reviews < 5) continue;
    const sentiment: InsightSentiment = outlet.negative > outlet.positive ? "negative" : "positive";
    const picked = illustrativeSamples(samples, (s) => s.locationId === outlet.locationId, 3);
    const name = outletNames[outlet.locationId] ?? "Outlet";
    items.push({
      key: `outlet:${outlet.locationId}`,
      category: "outlet_comparison",
      sentiment,
      title: name,
      statLine: `${name}: ${reviews} analysed written reviews; ${outlet.positive} positive and ${outlet.negative} negative observations (${pct(outlet.negative, Math.max(outlet.positive + outlet.negative, 1))} of observations negative), ${outlet.severe} severe. Compare rates, not raw counts, across outlets.`,
      supportingReviews: reviews,
      denominator: reviews,
      calculation: "observations per outlet ÷ analysed reviews at that outlet",
      context: `outlet ${name}`,
      severity: null,
      evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
      evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
      limitations: reviews < 10 ? ["Small sample at this outlet; treat ranking as indicative."] : [],
    });
  }

  // Relationships: topics repeatedly raised together in the same reviews.
  const negativeTopics = new Set(aggregates.negative.map((t) => t.topic));
  const positiveTopics = new Set(aggregates.positive.map((t) => t.topic));
  for (const rel of aggregates.topicRelationships.slice(0, 6)) {
    const [a, b] = rel.pair;
    const sentiment: InsightSentiment | null =
      negativeTopics.has(a) && negativeTopics.has(b)
        ? "negative"
        : positiveTopics.has(a) && positiveTopics.has(b)
          ? "positive"
          : null;
    if (!sentiment) continue;
    const picked = illustrativeSamples(samples, (s) => s.topic === a || s.topic === b, 3);
    items.push({
      key: `relationship:${sentiment}:${a}|${b}`,
      category: "relationship",
      sentiment,
      title: `${a.replace(/_/g, " ")} + ${b.replace(/_/g, " ")}`,
      statLine: `${a.replace(/_/g, " ")} and ${b.replace(/_/g, " ")} are raised together in ${rel.reviews} reviews. Co-occurrence shows the issues are experienced together; it does not prove one causes the other.`,
      supportingReviews: rel.reviews,
      denominator,
      calculation: "reviews mentioning both topics ÷ analysed written reviews",
      context: `topics ${a} and ${b}`,
      severity: null,
      evidenceReviewIds: [...new Set(picked.map((s) => s.reviewId))],
      evidenceExcerpts: picked.map((s) => s.evidenceExcerpt),
      limitations: ["Correlation only; causation is not established."],
    });
  }

  return items;
}

export function synthesisPrompt(items: EvidenceItem[], scopeLabel: string): string {
  const lines = items.map(
    (item) =>
      `- key ${item.key} | ${item.sentiment} | ${item.category} | ${item.statLine} | evidence: ${item.evidenceExcerpts.slice(0, 2).map((e) => `"${e}"`).join(" ; ") || "none"}`
  );
  return `You write business insights from review evidence for ${scopeLabel}. Return JSON only:
{"insights":[{"key":"<evidence key>","title":"...","detail":"...","importance":1-5,"suggestedAction":"..."|null,"confidence":0-1}]}

Rules:
- Write one insight per evidence key. Use only the facts in the evidence lines; never invent counts, percentages, names, products, or dates. The numbers in each statLine are computed from the database and are the only numbers you may repeat.
- Keep positive and negative insights separate. Never merge praise and complaints.
- For serious_incident keys: describe it as a single reported incident that needs verification, not as proven fact, and suggest an investigation action.
- Never use a serious incident as the illustrative example for a recurring theme, trend, outlet, or relationship insight. Recurring insights must be illustrated by typical, repeated feedback, so one dramatic event is not portrayed as if it were several different problems.
- detail: 2-3 sentences interpreting what the evidence means for the business, preserving specific products, behaviours, and qualifiers from the excerpts.
- suggestedAction: a concrete next step justified by the evidence, or null when the evidence does not justify one.
- importance: 5 = act now (serious harm, fraud, safety), 4 = high, 3 = moderate, 2 = low, 1 = minor. For positive items, importance means value worth reinforcing.
- confidence: lower it when the evidence is thin, ambiguous, or a single report.

Evidence:
${lines.join("\n")}`;
}

export function parseSynthesisResponse(text: string): unknown {
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

interface ModelInsight {
  key?: unknown;
  title?: unknown;
  detail?: unknown;
  importance?: unknown;
  suggestedAction?: unknown;
  confidence?: unknown;
}

/**
 * Joins model prose onto database evidence. Keys the model invents are
 * dropped; keys it omits get a factual fallback written from the stat
 * line, so no evidence item is ever silently lost.
 */
export function assembleInsights(
  items: EvidenceItem[],
  parsed: unknown,
  cacheKey: string
): InsightRecord[] {
  const byKey = new Map<string, ModelInsight>();
  const list =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { insights?: unknown }).insights)
      ? ((parsed as { insights: unknown[] }).insights as ModelInsight[])
      : [];
  for (const entry of list) {
    if (entry && typeof entry.key === "string") byKey.set(entry.key, entry);
  }

  const seenIds = new Map<string, number>();
  return items.map((item) => {
    const model = byKey.get(item.key);
    const title =
      typeof model?.title === "string" && model.title.trim() ? model.title.trim() : item.title;
    const detail =
      typeof model?.detail === "string" && model.detail.trim()
        ? model.detail.trim()
        : item.statLine;
    const importanceRaw = typeof model?.importance === "number" ? model.importance : null;
    const baseId = hash(`${cacheKey}:${item.key}`).slice(0, 24);
    const seen = seenIds.get(baseId) ?? 0;
    seenIds.set(baseId, seen + 1);
    return {
      id: seen === 0 ? baseId : `${baseId}-${seen}`,
      category: item.category,
      sentiment: item.sentiment,
      title,
      detail,
      importance:
        importanceRaw !== null ? Math.min(5, Math.max(1, Math.round(importanceRaw))) : null,
      severity: item.severity,
      evidenceReviewIds: item.evidenceReviewIds,
      evidenceExcerpts: item.evidenceExcerpts,
      supportingReviews: item.supportingReviews,
      denominator: item.denominator,
      calculation: item.calculation,
      context: item.context,
      confidence: typeof model?.confidence === "number" ? model.confidence : null,
      limitations: item.limitations,
      suggestedAction:
        typeof model?.suggestedAction === "string" && model.suggestedAction.trim()
          ? model.suggestedAction.trim()
          : null,
    };
  });
}
