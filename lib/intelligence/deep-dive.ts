import { briefClaimsClean, briefNumbersAllowed } from "@/lib/intelligence/brief";

/**
 * A deep dive is a short, rich read of ONE finding's cited reviews. The
 * finding itself stays deterministic; the model only reads the small
 * set of reviews already stapled to it (never the whole slice), so the
 * input stays tiny and every statement can be checked against the
 * finding's own numbers and the size of the cited set.
 */
export interface FindingDeepDive {
  summary: string;
  observations: string[];
  action: string;
  model: string;
  generatedAt: string;
}

export interface DeepDiveFindingFacts {
  title: string;
  explanation: string;
  whyItMatters: string;
  category: string;
  evidenceCount: number;
  sampleSize: number;
  metrics: Array<{ key: string; value: number | null; sampleSize: number; definition: string }>;
}

export interface DeepDiveReviewText {
  stars: number;
  location: string;
  date: string;
  comment: string;
}

export function deepDivePrompt(finding: DeepDiveFindingFacts, reviews: readonly DeepDiveReviewText[]): string {
  const numbers = new Set<string>();
  for (const item of finding.metrics) {
    if (item.value !== null) numbers.add(String(item.value));
    numbers.add(String(item.sampleSize));
  }
  numbers.add(String(finding.evidenceCount));
  numbers.add(String(finding.sampleSize));
  numbers.add(String(reviews.length));
  const lines = [
    "You are reading the exact reviews behind one finding from a review-analysis report. Write a short deep dive.",
    "",
    `Finding: ${finding.title}`,
    `What the counters found: ${finding.explanation}`,
    `Why it matters: ${finding.whyItMatters}`,
    ...finding.metrics.map((item) => `${item.key}=${item.value ?? "null"} (${item.definition})`),
    "",
    `The ${reviews.length} cited reviews (stars, outlet, date, customer words):`,
    ...reviews.map(
      (review, index) =>
        `${index + 1}. ${review.stars} stars · ${review.location} · ${review.date}\n"""${review.comment}"""`
    ),
    "",
    "Write JSON only:",
    '{ "summary": "2-3 sentences: what these reviews actually say, in plain words", "observations": ["up to 4 short points: recurring details, differences between outlets or ratings, specific names/products/sizes mentioned"], "action": "one concrete next step for the manager" }',
    "",
    "Rules:",
    `- You may only use these numbers: ${[...numbers].join(", ")}. Counts of these cited reviews (like "18 of ${reviews.length}") are allowed. Never use percentages.`,
    "- Do not invent anything that is not in these reviews. Names may be mentioned only when a review itself names them.",
    "- If a cited review does not actually say what the finding claims, say that it does not support the finding.",
    "- Do not say a change is statistically significant, will improve or raise the rating, or that a topic caused the rating.",
    "- Reviewer names are not included. Do not invent any.",
  ];
  return lines.join("\n");
}

/** Numbers a deep dive may state: the finding's own numbers plus any count within the cited set. */
export function deepDiveAllowedNumbers(finding: DeepDiveFindingFacts, citedCount: number): number[] {
  const allowed = new Set<number>([finding.evidenceCount, finding.sampleSize, citedCount, 1, 2, 3, 4, 5]);
  for (const item of finding.metrics) {
    if (item.value !== null && Number.isFinite(item.value)) allowed.add(item.value);
    allowed.add(item.sampleSize);
  }
  for (let count = 0; count <= citedCount; count += 1) allowed.add(count);
  return [...allowed];
}

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

/**
 * Keeps a model deep dive only when every number in it comes from the
 * finding or the cited set, and no banned claim slipped in. Anything
 * else is discarded whole — partial invention is not shown.
 */
export function validateDeepDive(
  raw: unknown,
  finding: DeepDiveFindingFacts,
  citedCount: number,
  model: string,
  generatedAt: string
): FindingDeepDive | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as { summary?: unknown; observations?: unknown; action?: unknown };
  const summary = clean(record.summary, 700);
  const action = clean(record.action, 300);
  const observations = (Array.isArray(record.observations) ? record.observations : [])
    .map((item) => clean(item, 300))
    .filter(Boolean)
    .slice(0, 4);
  if (!summary || observations.length === 0) return null;
  const texts = [summary, ...observations, action];
  if (!texts.every((line) => briefClaimsClean(line))) return null;
  if (!briefNumbersAllowed(texts, deepDiveAllowedNumbers(finding, citedCount))) return null;
  return { summary, observations, action, model, generatedAt };
}

/** Shape-checks a stored deep dive when a report is loaded for display. */
export function parseStoredDeepDive(value: unknown): FindingDeepDive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<FindingDeepDive>;
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
  return {
    summary: raw.summary,
    observations: Array.isArray(raw.observations)
      ? raw.observations.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
      : [],
    action: typeof raw.action === "string" ? raw.action : "",
    model: typeof raw.model === "string" ? raw.model : "none",
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
  };
}
