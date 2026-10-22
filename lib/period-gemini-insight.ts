/** Temporary page-load reading. At most the latest 100 reviews in the selected window. */

export const PERIOD_INSIGHT_REVIEW_CAP = 100;

export type PeriodInsightTone = "praise" | "problem" | "watch";

export interface PeriodReviewLine {
  stars: number;
  when: string;
  location: string;
  text: string;
}

export interface PeriodInsightCard {
  title: string;
  detail: string;
  tone: PeriodInsightTone;
}

export interface PeriodInsightCopy {
  headline: string;
  summary: string;
  insights: PeriodInsightCard[];
  actions: string[];
}

export function periodInsightScopeSelected(scope: {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  blocked: boolean;
}): boolean {
  if (scope.blocked) return false;
  return Boolean(scope.clientId || scope.groupId || scope.locationId);
}

/** Newest first. `capped` is true when rows were dropped to stay within the limit. */
export function latestPeriodReviews(
  rows: PeriodReviewLine[],
  cap = PERIOD_INSIGHT_REVIEW_CAP
): { reviews: PeriodReviewLine[]; capped: boolean } {
  const sorted = [...rows].sort((left, right) => (left.when < right.when ? 1 : left.when > right.when ? -1 : 0));
  return { reviews: sorted.slice(0, cap), capped: sorted.length > cap };
}

export function periodInsightPrompt(input: {
  scopeTitle: string;
  periodLabel: string;
  reviews: PeriodReviewLine[];
  capped: boolean;
}): string {
  const stats = sampleStats(input.reviews);
  const coverage = input.capped
    ? `These are the latest ${input.reviews.length} reviews in that period. Gemini is limited to 100, so older reviews in the period may be missing.`
    : `These are all ${input.reviews.length} reviews in that period.`;
  const lines = input.reviews.map((review, index) => {
    const text = review.text ? cell(review.text) : "(no written comment)";
    return `${index + 1}. ${review.stars}★ ${review.when.slice(0, 10)} | ${cell(review.location)} | ${text}`;
  });
  return [
    `You analyse Google reviews for ${input.scopeTitle} during ${input.periodLabel}.`,
    coverage,
    "Use only these reviews. Do not invent visits, staff, outlets, or counts.",
    "The only figures you may cite are on the stats line. Do not calculate a percentage.",
    "Do not name individual customers.",
    "Write for the owner: what customers are saying, what is hurting the rating, and what to do next.",
    "Return JSON with headline (one sentence), summary (two or three sentences), insights (3 to 5 items, each with title, detail, and tone of praise, problem, or watch), and actions (1 to 3 short steps).",
    `Stats: ${stats.count} reviews, average ${stats.average}, stars ${stats.starLine}, ${stats.withText} with written comments.`,
    "Reviews:",
    ...lines,
  ].join("\n");
}

export function parsePeriodInsight(raw: string): PeriodInsightCopy | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const headline = clip(row.headline, 200);
  const summary = clip(row.summary, 700);
  if (!headline || !summary) return null;
  const insights = Array.isArray(row.insights)
    ? row.insights.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const card = item as Record<string, unknown>;
        const title = clip(card.title, 80);
        const detail = clip(card.detail, 400);
        if (!title || !detail) return [];
        return [{ title, detail, tone: toneOf(card.tone ?? card.sentiment) }];
      })
    : [];
  if (insights.length === 0) return null;
  const actions = Array.isArray(row.actions)
    ? row.actions.flatMap((item) => {
        const action = clip(item, 160);
        return action ? [action] : [];
      })
    : [];
  return {
    headline,
    summary,
    insights: insights.slice(0, 5),
    actions: actions.slice(0, 3),
  };
}

function sampleStats(reviews: PeriodReviewLine[]): { count: number; average: string; starLine: string; withText: number } {
  const stars = [0, 0, 0, 0, 0, 0];
  let sum = 0;
  let withText = 0;
  for (const review of reviews) {
    const star = Math.max(1, Math.min(5, Math.round(review.stars)));
    stars[star] += 1;
    sum += star;
    if (review.text) withText += 1;
  }
  const count = reviews.length;
  const average = count > 0 ? (sum / count).toFixed(2) : "0";
  const starLine = [1, 2, 3, 4, 5].map((star) => `${star}★ ${stars[star]}`).join(", ");
  return { count, average, starLine, withText };
}

function cell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function toneOf(value: unknown): PeriodInsightTone {
  if (value === "praise" || value === "positive") return "praise";
  if (value === "problem" || value === "negative") return "problem";
  return "watch";
}
