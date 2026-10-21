import type { SummaryDocument } from "./summary-aggregate";
import { allowedNumbers, type InsightFinding } from "./insight";

/**
 * The leadership brief is part of the insight report, not a separate model
 * feature. It is written from the stored summary document: counts come from
 * buildSummaryDocument, and model wording (when used) may only repeat the
 * numbers listed by briefAllowedNumbers.
 */
export interface ReportBrief {
  summary: string;
  highlights: string[];
  risks: string[];
  model: string;
}

const BANNED_BRIEF_PHRASES = ["statistically significant", "will improve", "will raise", "caused the"] as const;

export function briefClaimsClean(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_BRIEF_PHRASES.every((phrase) => !lower.includes(phrase));
}

/** Every number a brief may state, expanded with common rounded forms. */
export function briefAllowedNumbers(document: SummaryDocument): number[] {
  const raw: number[] = [
    document.coverage.reviewCount,
    document.coverage.extractedCount,
    document.coverage.unextractedCount,
    // Outlets means outlets with reviews in the window, not the scope
    // size: a brief saying "across 10 outlets" when 9 had reviews is
    // wrong even though 10 is the organisation's outlet count. The
    // locations list itself can include zero-review outlets (the org
    // projection lists every location), so count only reviewed ones.
    document.locations.filter((row) => row.reviewCount > 0).length,
    document.metrics.averageRating ?? Number.NaN,
    document.metrics.negativeShare === null ? Number.NaN : document.metrics.negativeShare * 100,
    document.sentiment.positive,
    document.sentiment.negative,
    document.sentiment.mixed,
    document.sentiment.neutral,
    ...document.topics.flatMap((row) => [row.reviews, row.share === null ? Number.NaN : row.share * 100]),
    ...document.issues.flatMap((row) => [row.reviews, row.share === null ? Number.NaN : row.share * 100]),
    ...document.praise.map((row) => row.reviews),
    ...document.locations.flatMap((row) => [row.reviewCount, row.averageRating ?? Number.NaN]),
    ...document.months.map((row) => row.count),
  ];
  const allowed = new Set<number>();
  for (const value of raw) {
    if (!Number.isFinite(value)) continue;
    allowed.add(value);
    allowed.add(Math.round(value));
    allowed.add(Math.round(value * 10) / 10);
    allowed.add(Math.round(value * 100) / 100);
  }
  return [...allowed];
}

export function briefNumbersAllowed(texts: readonly string[], allowed: readonly number[]): boolean {
  const joined = texts.join("\n");
  const found = joined.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  for (const token of found) {
    const value = Number.parseFloat(token.replace(/,/g, "").replace(/%$/, ""));
    if (!Number.isFinite(value)) continue;
    // Years in dates are not claims.
    if (Number.isInteger(value) && value >= 1990 && value <= 2100) continue;
    if (!allowed.some((candidate) => Math.abs(candidate - value) <= 0.011)) return false;
  }
  return true;
}

/**
 * An executive synthesis item: a named conclusion that rests on specific
 * findings. It is wording only — every number must already exist on one
 * of the findings it cites, or in the summary brief facts.
 */
export interface ReportSynthesisItem {
  title: string;
  summary: string;
  action: string;
  keys: string[];
}

/**
 * Keeps only synthesis items whose cited finding keys exist and whose
 * numbers all come from those findings or the summary. Anything else is
 * dropped rather than shown.
 */
export function validateSynthesis(
  raw: unknown,
  findings: readonly InsightFinding[],
  document: SummaryDocument
): ReportSynthesisItem[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map(findings.map((finding) => [finding.key, finding]));
  const baseAllowed = briefAllowedNumbers(document);
  const clean = (value: unknown, max: number): string =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
  const out: ReportSynthesisItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { title?: unknown; summary?: unknown; action?: unknown; keys?: unknown };
    const title = clean(record.title, 120);
    const summary = clean(record.summary, 600);
    const action = clean(record.action, 240);
    if (!title || !summary) continue;
    const keys = [...new Set((Array.isArray(record.keys) ? record.keys : []).filter((key): key is string => typeof key === "string" && byKey.has(key)))];
    if (keys.length === 0) continue;
    const allowed = new Set<number>(baseAllowed);
    for (const key of keys) {
      const finding = byKey.get(key);
      if (!finding) continue;
      for (const value of allowedNumbers(finding)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) allowed.add(numeric);
      }
    }
    const texts = [title, summary, action];
    if (!texts.every((line) => briefClaimsClean(line))) continue;
    if (!briefNumbersAllowed(texts, [...allowed])) continue;
    out.push({ title, summary, action, keys });
    if (out.length >= 5) break;
  }
  return out;
}

const BRIEF_LINE = /^(.+?)\s*[—:]\s*(?:praised in |complaints in )?([\d,]+)\s+reviews/i;

/** A complaint count that is a small tail of a much larger praise count is not a separate risk. */
export function complaintStandsApart(praiseCount: number, complaintCount: number): boolean {
  return complaintCount > 0 && praiseCount >= 0;
}

function isBucketTopic(label: string): boolean {
  return label.trim().toLowerCase() === "other";
}

export function parseBriefCount(line: string): { label: string; count: number } | null {
  const match = line.match(BRIEF_LINE);
  if (!match) return null;
  const count = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(count) || count <= 0) return null;
  return { label: match[1].trim(), count };
}

/**
 * Praise and complaints are different counts on the same topics. A complaint
 * stays in the risk list even when the same topic is praised more often.
 * The catch-all topic "Other" is omitted from both lists.
 */
export function reconcileBriefLists(
  highlights: readonly string[],
  risks: readonly string[]
): { highlights: string[]; risks: string[] } {
  const praise = highlights.flatMap((line) => {
    const parsed = parseBriefCount(line);
    if (!parsed || isBucketTopic(parsed.label)) return [];
    return [parsed];
  });
  const praiseByLabel = new Map(praise.map((row) => [row.label.toLowerCase(), row.count]));
  const complaints = risks.flatMap((line) => {
    const parsed = parseBriefCount(line);
    if (!parsed || isBucketTopic(parsed.label)) return [];
    const praised = praiseByLabel.get(parsed.label.toLowerCase());
    if (praised !== undefined && !complaintStandsApart(praised, parsed.count)) return [];
    return [parsed];
  });
  return {
    highlights: praise.slice(0, 4).map((row) => `${row.label} — praised in ${row.count.toLocaleString("en-US")} reviews`),
    risks: complaints.slice(0, 4).map((row) => `${row.label} — complaints in ${row.count.toLocaleString("en-US")} reviews`),
  };
}

export function deterministicBrief(document: SummaryDocument): ReportBrief {
  const { reviewCount, extractedCount } = document.coverage;
  const average = document.metrics.averageRating;
  const praise = document.praise.filter((row) => !isBucketTopic(row.label));
  const praiseByLabel = new Map(praise.map((row) => [row.label.toLowerCase(), row.reviews]));
  const issues = document.issues.filter((row) => {
    if (isBucketTopic(row.label)) return false;
    const praised = praiseByLabel.get(row.label.toLowerCase()) ?? 0;
    return complaintStandsApart(praised, row.reviews);
  });
  const topPraise = praise.slice(0, 2);
  const topIssues = issues.slice(0, 2);
  const sentences: string[] = [
    average === null
      ? `${reviewCount} reviews counted for this scope and window.`
      : `${reviewCount} reviews counted for this scope and window, with an average rating of ${average.toFixed(2)} from the sum of stars.`,
  ];
  if (extractedCount > 0) {
    sentences.push(`Topic counts come from the ${extractedCount} extracted reviews.`);
  }
  if (topPraise.length > 0) {
    sentences.push(
      `Customers praise ${topPraise.map((row) => `${row.label.toLowerCase()} (${row.reviews} reviews)`).join(" and ")} most often.`
    );
  }
  sentences.push(
    topIssues.length > 0
      ? `The most mentioned issues are ${topIssues.map((row) => `${row.label.toLowerCase()} (${row.reviews} reviews)`).join(" and ")}.`
      : "No issue topic repeats in the extracted reviews."
  );
  return {
    summary: sentences.join(" "),
    highlights: praise.slice(0, 4).map((row) => `${row.label} — praised in ${row.reviews} reviews`),
    risks: issues.slice(0, 4).map((row) => `${row.label} — complaints in ${row.reviews} reviews`),
    model: "none",
  };
}
