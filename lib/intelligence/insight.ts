import { createHash } from "node:crypto";
import { z } from "zod";
import { excerptSupportsClaim } from "@/lib/intelligence/claim-support";
import { TAXONOMY_VERSION, TAXONOMY_V2 } from "@/lib/intelligence/taxonomy";
import { SUMMARY_ANALYSIS_VERSION, type SummaryDocument } from "@/lib/intelligence/summary-aggregate";
import type { SummaryWindow } from "@/lib/intelligence/summary-window";
import type { IntelligenceScopeType } from "@/lib/intelligence/identity";

export const INSIGHT_PROMPT_VERSION = "insight-v1";
export const INSIGHT_ANALYSIS_VERSION = "insight-v1";
export const CLUSTER_LOGIC_VERSION = "cluster-v1";

export const INSIGHT_CATEGORIES = [
  "trend",
  "recurring_issue",
  "positive_driver",
  "anomaly",
  "location_comparison",
  "emerging_topic",
  "recommendation",
  "rating_drag",
  "fan_friction",
  "rare_severe",
  "location_drag",
  "micro_topic",
  "staff_mention",
  "customer_request",
] as const;

const findingSchema = z.object({
  key: z.string().min(8).max(80),
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(800),
  category: z.enum(INSIGHT_CATEGORIES),
  workspaceId: z.string().min(8),
  clientId: z.string().min(8),
  scopeType: z.enum(["organisation", "group", "location"]),
  scopeId: z.string().min(8),
  rangeLabel: z.string(),
  rangeStart: z.string().nullable(),
  rangeEnd: z.string().nullable(),
  comparisonStart: z.string().nullable(),
  comparisonEnd: z.string().nullable(),
  topicCodes: z.array(z.string()),
  clusterIds: z.array(z.string()),
  reviewIds: z.array(z.string()),
  locationIds: z.array(z.string()),
  metrics: z.array(z.object({
    key: z.string(),
    value: z.number().nullable(),
    sampleSize: z.number().int().nonnegative(),
    definition: z.string(),
  })),
  evidenceCount: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  confidence: z.enum(["low", "medium", "high"]),
  quality: z.enum(["supported", "hypothesis"]),
  whyItMatters: z.string().min(1).max(400),
  action: z.string().min(1).max(400).nullable(),
  links: z.object({
    reviewHrefs: z.array(z.string()),
    locationIds: z.array(z.string()),
    clusterIds: z.array(z.string()),
    escalationHref: z.string().nullable(),
  }),
  model: z.string(),
  promptVersion: z.literal(INSIGHT_PROMPT_VERSION),
  analysisVersion: z.literal(INSIGHT_ANALYSIS_VERSION),
  summaryVersion: z.literal(SUMMARY_ANALYSIS_VERSION),
  taxonomyVersion: z.literal(TAXONOMY_VERSION),
  clusterVersion: z.literal(CLUSTER_LOGIC_VERSION),
  hypothesis: z.boolean(),
});

export type InsightFinding = z.infer<typeof findingSchema>;

export interface InsightReview {
  id: string;
  workspaceId: string;
  locationId: string;
  createdAt: string;
  stars: number;
  overall: "positive" | "negative" | "mixed" | "neutral" | "unknown" | null;
  issues: string[];
  praise: string[];
  excerpts: Array<{ topicCode: string; polarity: "praise" | "complaint"; text: string }>;
  aspects?: Array<{ phrase: string; topicCode: string; polarity: "praise" | "complaint" | "neutral" }>;
  staffMentions?: string[];
  requests?: string[];
  clusterIds: string[];
  severe: boolean;
}

export interface InsightClusterRef {
  id: string;
  title: string;
  topicKey: string;
  reviewIds: string[];
}

export interface InsightInput {
  workspaceId: string;
  clientId: string;
  scopeType: IntelligenceScopeType;
  scopeId: string;
  locationIds: readonly string[];
  window: SummaryWindow;
  summary: SummaryDocument;
  reviews: readonly InsightReview[];
  previousReviews: readonly InsightReview[];
  clusters: readonly InsightClusterRef[];
}

export interface InsightReportDraft {
  sourceHash: string;
  insufficient: boolean;
  insufficientReason: string | null;
  findings: InsightFinding[];
  recommendations: Array<{ findingKey: string; action: string }>;
}

const DEFINITIONS: Record<string, string> = {
  review_count: "Distinct reviews in this scope and window.",
  issue_reviews: "Distinct reviews cited by this finding. A review with two topics still counts once here.",
  previous_issue_reviews: "Distinct reviews of this complaint in the previous window of the same length.",
  average_rating: "Sum of stars divided by the review count. Not an average of location averages.",
  average_rating_delta: "Change in that average versus the previous window. Null when either window has no rated reviews.",
  location_review_count: "Distinct reviews at the cited location in this window.",
  topic_review_count: "Distinct reviews in this window that mention the topic in praise or complaint.",
  topic_average_rating: "Sum of stars of reviews mentioning the topic, divided by that count.",
  baseline_average_rating: "The scope average rating in this window, used as the comparison line.",
  low_star_reviews: "Reviews among those counted that gave 1 or 2 stars.",
  fan_complaint_reviews: "Reviews with 4 or 5 stars that still list the topic as a complaint.",
  location_topic_average_rating: "Sum of stars of reviews mentioning the topic at the cited location, divided by that count.",
  phrase_review_count: "Distinct reviews whose stored quotations contain the phrase.",
  staff_mention_reviews: "Distinct reviews that name this staff member.",
  staff_praise_reviews: "Reviews whose sentence thanks this person, including a low star whose words still thank them.",
  staff_complaint_reviews: "Reviews whose sentence blames this person, or a 1–2 star review with no sentence thanking them.",
  request_review_count: "Distinct reviews that contain this customer request or wish.",
};

function label(code: string): string {
  return TAXONOMY_V2.find((node) => node.code === code)?.label ?? code;
}

/** The quotation for this finding's topic. Another topic's sentence is not evidence. */
export function evidenceExcerpt(
  excerpts: ReadonlyArray<{ topicCode: string; polarity: "praise" | "complaint"; text: string }>,
  topicCodes: readonly string[],
  category: string,
): string | null {
  if (topicCodes.length === 0) return excerpts[0]?.text.slice(0, 240) ?? null;
  const polarity = category === "positive_driver" ? "praise" : "complaint";
  const matched = excerpts.find((item) => topicCodes.includes(item.topicCode) && item.polarity === polarity);
  return matched?.text.slice(0, 240) ?? null;
}

function keyFor(category: string, code: string, locationIds: string[]): string {
  return createHash("sha256").update([category, code, ...locationIds].join("|")).digest("hex").slice(0, 24);
}

function confidence(sampleSize: number, evidenceCount: number): InsightFinding["confidence"] {
  if (sampleSize >= 8 && evidenceCount >= 3) return "high";
  if (sampleSize >= 5 && evidenceCount >= 2) return "medium";
  return "low";
}

function qualityFor(sampleSize: number, evidenceCount: number): InsightFinding["quality"] {
  return sampleSize >= 8 && evidenceCount >= 3 ? "supported" : "hypothesis";
}

/** A tagged topic counts only when this review's own quotation says it. Reviews with no quotation yet keep the tag. */
function grounded(review: InsightReview, code: string, polarity: "complaint" | "praise"): boolean {
  const tagged = polarity === "complaint" ? review.issues.includes(code) : review.praise.includes(code);
  if (!tagged) return false;
  const matching = review.excerpts.filter((item) => item.topicCode === code && item.polarity === polarity);
  if (review.excerpts.length === 0) return true;
  return matching.some((item) => excerptSupportsClaim(code, polarity, item.text));
}

function countIssue(reviews: readonly InsightReview[], code: string): InsightReview[] {
  return reviews.filter((review) => grounded(review, code, "complaint"));
}

function complaintQuotes(reviews: readonly InsightReview[], code: string): string[] {
  const quotes: string[] = [];
  for (const review of reviews) {
    const text = evidenceExcerpt(review.excerpts, [code], "recurring_issue")?.replace(/\s+/g, " ").trim();
    if (!text || quotes.includes(text)) continue;
    quotes.push(text.slice(0, 180));
    if (quotes.length >= 2) break;
  }
  return quotes;
}

function praiseBeside(reviews: readonly InsightReview[], code: string): string | null {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    for (const excerpt of review.excerpts) {
      if (excerpt.polarity !== "praise" || excerpt.topicCode === code || excerpt.topicCode === "other") continue;
      if (!excerptSupportsClaim(excerpt.topicCode, "praise", excerpt.text)) continue;
      counts.set(excerpt.topicCode, (counts.get(excerpt.topicCode) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  return `The same reviews also praise ${label(top[0])}. That praise stays a separate count.`;
}

function attachComplaintQuotes(finding: InsightFinding, reviews: readonly InsightReview[]): InsightFinding {
  if (finding.topicCodes.length !== 1 || finding.explanation.includes("They say:")) return finding;
  if (finding.category === "positive_driver" || finding.category === "staff_mention" || finding.category === "customer_request" || finding.category === "micro_topic") return finding;
  const code = finding.topicCodes[0]!;
  const cited = reviews.filter((review) => finding.reviewIds.includes(review.id));
  const quotes = complaintQuotes(cited, code);
  if (quotes.length === 0) return finding;
  const beside = praiseBeside(cited, code);
  const said = `They say: ${quotes.map((quote) => `“${quote}”`).join(" ")}`;
  return { ...finding, explanation: `${said} ${finding.explanation}${beside ? ` ${beside}` : ""}`.slice(0, 800) };
}

function complaintAction(code: string): string {
  switch (code) {
    case "product_variety":
      return "Check the categories and seasons named in the cited sentences before changing the whole range.";
    case "product_quality":
      return "Check the products named in the cited sentences: their condition, and whether the claim made at sale matches the item.";
    case "price":
      return "Compare the cited sentence with that product's price, quality, and range. A price that is only stated, not criticised, is not this complaint.";
    case "billing_delay":
    case "queue_time":
      return "Investigate the cited visit and how the queue and billing desk handled that customer. Do not fold this into a general staff problem unless other reviews say the same.";
    case "staff_politeness":
      return "Investigate the cited visit with the people on that shift. Keep it separate from product complaints in the same reviews.";
    default:
      return `Act on what the cited sentences say about ${label(code)}. Do not add a cause the reviews do not name.`;
  }
}

const STAFF_HONORIFIC = /^(?:mr|mrs|ms|miss)\.?\s+/i;

function staffIdentity(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(STAFF_HONORIFIC, "").toLowerCase();
}

/** "Amal" and "Amal Joseph" are one person. "Ramala" is not. */
function sameStaffPerson(left: string, right: string): boolean {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.length >= 3 && longer.startsWith(`${shorter} `);
}

function nameMentioned(identity: string, text: string): boolean {
  const first = identity.split(" ")[0] ?? identity;
  if (first.length < 3) return false;
  return new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function readStaffReview(review: InsightReview, identity: string): "blame" | "thanks" | "plain" {
  let blame = false;
  let thanks = false;
  for (const excerpt of review.excerpts) {
    const aboutThem = excerpt.topicCode.startsWith("staff_") || nameMentioned(identity, excerpt.text);
    if (!aboutThem) continue;
    if (excerpt.polarity === "complaint") blame = true;
    if (excerpt.polarity === "praise") thanks = true;
  }
  if (blame) return "blame";
  if (thanks) return "thanks";
  if (review.stars <= 2) return "blame";
  if (review.stars >= 4) return "thanks";
  return "plain";
}

function staffBehaviour(texts: readonly string[], kind: "thanks" | "blame"): string | null {
  const blob = texts.join(" ");
  if (kind === "blame") return /\b(rude|ignored|shout|misbehav|poor behav)/i.test(blob) ? "treating the customer badly" : null;
  const parts: string[] = [];
  if (/\b(find|found|looking for|what i needed|what we needed|what i was looking)\b/i.test(blob)) parts.push("finding what the customer came for");
  if (/\b(patient|no pressure|without any pressure|without rushing|not rushing)\b/i.test(blob)) parts.push("not rushing them");
  if (parts.length === 0 && /\b(helpful|help|kind|friendly)\b/i.test(blob)) parts.push("being helpful on the floor");
  return parts.slice(0, 2).join(" and ") || null;
}

function staffQuotes(reviews: readonly InsightReview[], identity: string, polarity: "praise" | "complaint"): string[] {
  const quotes: string[] = [];
  for (const review of reviews) {
    const texts = review.excerpts
      .filter((item) => item.polarity === polarity && (nameMentioned(identity, item.text) || item.topicCode.startsWith("staff_")))
      .map((item) => item.text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .sort((a, b) => Number(nameMentioned(identity, b)) - Number(nameMentioned(identity, a)) || a.length - b.length);
    const text = texts[0];
    if (!text || quotes.includes(text)) continue;
    quotes.push(text.slice(0, 160));
    if (quotes.length >= 2) break;
  }
  return quotes;
}

function staffOutletClause(reviews: readonly InsightReview[]): string {
  const counts = new Map<string, number>();
  for (const review of reviews) counts.set(review.locationId, (counts.get(review.locationId) ?? 0) + 1);
  const ranked = [...counts.values()].sort((a, b) => b - a);
  const top = ranked[0] ?? 0;
  if (ranked.length <= 1) return `All ${top} were written at one outlet. That is the store to manage.`;
  const rest = ranked.slice(1);
  if (rest.every((count) => count === 1)) {
    const elsewhere = rest.length === 1 ? "One review was written at another outlet" : `${rest.length} other outlets have one review each`;
    return `${top} of these reviews were written at one outlet. That is the store to manage. ${elsewhere}. A single review elsewhere is a name to check, not a second workplace.`;
  }
  return `These reviews were written at ${ranked.length} outlets. Start with the outlet that has ${top} of them.`;
}

function staffExplanation(candidate: {
  name: string;
  aliases: string[];
  reviews: InsightReview[];
  thanks: InsightReview[];
  blamed: InsightReview[];
  mismatches: InsightReview[];
  identity: string;
}): string {
  const thanked = candidate.thanks.length >= candidate.blamed.length;
  const pool = thanked ? candidate.thanks : candidate.blamed;
  const quotes = staffQuotes(pool, candidate.identity, thanked ? "praise" : "complaint");
  const behaviour = staffBehaviour(quotes, thanked ? "thanks" : "blame");
  const lead = thanked
    ? `Customers name "${candidate.name}" to thank the staff${behaviour ? ` for ${behaviour}` : ""}.`
    : `Customers name "${candidate.name}" when the visit goes badly${behaviour ? `, for ${behaviour}` : ""}.`;
  const said = quotes.length > 0 ? ` They say: ${quotes.map((quote) => `“${quote}”`).join(" ")}` : "";
  const mismatch = candidate.mismatches.length === 0
    ? ""
    : candidate.mismatches.length === 1
      ? ` One review is scored ${candidate.mismatches[0]!.stars} star${candidate.mismatches[0]!.stars === 1 ? "" : "s"} and the sentence still thanks them. Use the sentence, not that star.`
      : ` ${candidate.mismatches.length} reviews are scored 1 or 2 stars and the sentences still thank them. Use the sentences, not those stars.`;
  const aliases = candidate.aliases.length === 0 ? "" : ` Other reviews write ${candidate.aliases.slice(0, 3).map((name) => `“${name}”`).join(" and ")}. Confirm that is the same person.`;
  return `${lead}${said} ${staffOutletClause(candidate.reviews)}${mismatch}${aliases}`;
}

function staffAction(candidate: { name: string; aliases: string[]; blamed: InsightReview[]; thanks: InsightReview[]; mismatches: InsightReview[] }): string {
  if (candidate.blamed.length > candidate.thanks.length) {
    return `Read the reviews that blame "${candidate.name}" and check they describe the same behaviour before you raise it at that outlet.`;
  }
  const notes: string[] = [];
  if (candidate.aliases.length > 0) notes.push(`Confirm ${candidate.aliases.slice(0, 2).map((name) => `"${name}"`).join(" and ")} ${candidate.aliases.length === 1 ? "is" : "are"} the same person.`);
  if (candidate.mismatches.length > 0) notes.push("Do not treat a low star as a complaint about them when the sentence thanks them.");
  return [`Recognise "${candidate.name}" at the outlet these reviews come from.`, ...notes].join(" ").slice(0, 400);
}

function metric(key: string, value: number | null, sampleSize: number) {
  return { key, value, sampleSize, definition: DEFINITIONS[key] ?? key };
}

function baseFinding(input: InsightInput, partial: {
  category: InsightFinding["category"];
  code: string;
  locationIds: string[];
  reviews: InsightReview[];
  clusterIds?: string[];
  title: string;
  explanation: string;
  whyItMatters: string;
  action: string | null;
  extraMetrics?: InsightFinding["metrics"];
}): InsightFinding {
  const sampleSize = input.summary.coverage.reviewCount;
  const evidence = partial.reviews;
  const quality = qualityFor(sampleSize, evidence.length);
  const severe = evidence.some((review) => review.severe);
  const finding: InsightFinding = {
    key: keyFor(partial.category, partial.code, partial.locationIds),
    title: partial.title,
    explanation: partial.explanation,
    category: partial.category,
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    rangeLabel: input.window.label,
    rangeStart: input.window.start,
    rangeEnd: input.window.end,
    comparisonStart: input.window.comparison?.start ?? null,
    comparisonEnd: input.window.comparison?.end ?? null,
    topicCodes: partial.code ? [partial.code] : [],
    clusterIds: partial.clusterIds ?? [],
    reviewIds: evidence.map((review) => review.id),
    locationIds: partial.locationIds,
    metrics: [
      metric("review_count", sampleSize, sampleSize),
      metric("issue_reviews", evidence.length, evidence.length),
      ...(partial.extraMetrics ?? []),
    ],
    evidenceCount: evidence.length,
    sampleSize,
    confidence: confidence(sampleSize, evidence.length),
    quality,
    whyItMatters: partial.whyItMatters,
    action: partial.action,
    links: {
      reviewHrefs: evidence.map((review) => `/reviews?review=${review.id}`),
      locationIds: partial.locationIds,
      clusterIds: partial.clusterIds ?? [],
      escalationHref: severe ? "/escalations" : null,
    },
    model: "none",
    promptVersion: INSIGHT_PROMPT_VERSION,
    analysisVersion: INSIGHT_ANALYSIS_VERSION,
    summaryVersion: SUMMARY_ANALYSIS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    clusterVersion: CLUSTER_LOGIC_VERSION,
    hypothesis: quality === "hypothesis",
  };
  return findingSchema.parse(finding);
}

function inScope(input: InsightInput, review: InsightReview): boolean {
  return review.workspaceId === input.workspaceId && input.locationIds.includes(review.locationId);
}

export function insightInputHash(input: InsightInput): string {
  const clusterPart = input.clusters
    .map((cluster) => `${cluster.id}:${[...cluster.reviewIds].sort().join(",")}`)
    .sort()
    .join(";");
  return createHash("sha256")
    .update([
      input.workspaceId,
      input.scopeType,
      input.scopeId,
      input.window.kind,
      input.window.start ?? "all",
      input.window.end ?? "all",
      input.window.comparison?.start ?? "",
      input.window.comparison?.end ?? "",
      input.summary.sourceHash,
      SUMMARY_ANALYSIS_VERSION,
      TAXONOMY_VERSION,
      CLUSTER_LOGIC_VERSION,
      INSIGHT_PROMPT_VERSION,
      clusterPart,
    ].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function discoverFindings(input: InsightInput): InsightReportDraft {
  const sourceHash = insightInputHash(input);
  const current = input.reviews.filter((review) => inScope(input, review));
  const previous = input.previousReviews.filter((review) => inScope(input, review));
  const sampleSize = input.summary.coverage.reviewCount;
  if (sampleSize < 3 || current.length < 3) {
    return {
      sourceHash,
      insufficient: true,
      insufficientReason: "Fewer than three reviews are in this scope and window, so no finding is reported.",
      findings: [],
      recommendations: [],
    };
  }
  const codes = new Set<string>();
  for (const review of [...current, ...previous]) {
    for (const code of review.issues) codes.add(code);
    for (const code of review.praise) codes.add(code);
  }
  const drafts: InsightFinding[] = [];
  const coveredTopics = new Set<string>();
  // Windows without a comparison (all time) have no "appears in both
  // windows" test, so their biggest complaints are collected here and
  // emitted as volume-ranked recurring issues after the loop.
  const standaloneIssues: Array<{ code: string; now: InsightReview[]; before: InsightReview[] }> = [];
  const singleVisits: Array<{ code: string; now: InsightReview[]; before: InsightReview[] }> = [];
  // The same windows still deserve trend and emerging checks. With no
  // previous window to compare against, the window is split at its
  // middle review date: earlier half versus later half. Only used when
  // the caller supplied no real comparison and the dates actually span
  // time (a single-day window has no meaningful halves).
  const hasRealComparison = Boolean(input.window.comparison);
  let halfBefore: InsightReview[] = [];
  let halfNow: InsightReview[] = [];
  if (!hasRealComparison && previous.length === 0 && current.length >= 6) {
    const dated = current
      .filter((review) => review.createdAt)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (dated.length >= 6 && dated[0]!.createdAt < dated[dated.length - 1]!.createdAt) {
      const splitAt = Math.floor(dated.length / 2);
      halfBefore = dated.slice(0, splitAt);
      halfNow = dated.slice(splitAt);
      if (halfBefore.length < 3 || halfNow.length < 3) {
        halfBefore = [];
        halfNow = [];
      }
    }
  }
  const halves = halfNow.length > 0;

  for (const code of codes) {
    if (code === "other") continue;
    const now = countIssue(current, code);
    const before = countIssue(previous, code);
    // Comparison pair for trend/emerging/recurring: the real previous
    // window when there is one, otherwise the window's own halves.
    const cmpNow = hasRealComparison ? now : countIssue(halfNow, code);
    const cmpBefore = hasRealComparison ? before : countIssue(halfBefore, code);
    const cmpReviews = hasRealComparison ? now : cmpNow;
    const byLocation = new Map<string, InsightReview[]>();
    for (const review of now) {
      const list = byLocation.get(review.locationId) ?? [];
      list.push(review);
      byLocation.set(review.locationId, list);
    }
    const ranked = [...byLocation.entries()].sort((a, b) => b[1].length - a[1].length);
    const top = ranked[0];
    const otherLocations = input.locationIds.filter((id) => id !== top?.[0]);
    const otherHasReviews = otherLocations.some((id) => current.some((review) => review.locationId === id));
    const otherHasIssue = otherLocations.some((id) => (byLocation.get(id)?.length ?? 0) > 0);
    if (top && top[1].length >= 2 && top[1].length === now.length && otherHasReviews && !otherHasIssue && now.length / sampleSize <= 0.5) {
      const locationCount = current.filter((review) => review.locationId === top[0]).length;
      drafts.push(baseFinding(input, {
        category: "anomaly",
        code,
        locationIds: [top[0]],
        reviews: top[1],
        title: `${label(code)} is concentrated in one outlet`,
        explanation: `${top[1].length} of ${sampleSize} reviews in this window mention ${label(code)}, and all of them are at one outlet. That outlet has ${locationCount} reviews in the window.`,
        whyItMatters: "The same complaint is not spread across the scope. It is a local pattern in this sample.",
        action: "Read these reviews at that outlet before treating this as an organisation-wide issue.",
        extraMetrics: [metric("location_review_count", locationCount, locationCount)],
      }));
      coveredTopics.add(code);
    }
    const compared = input.locationIds.filter((id) => current.filter((review) => review.locationId === id).length >= 3);
    if (compared.length >= 2 && top && top[1].length >= 2 && !coveredTopics.has(code)) {
      const quiet = compared.find((id) => (byLocation.get(id)?.length ?? 0) === 0 && current.filter((review) => review.locationId === id).length >= 3);
      const loudCount = current.filter((review) => review.locationId === top[0]).length;
      if (quiet && loudCount >= 3 && top[1].length / loudCount >= 0.5 && !coveredTopics.has(`loc:${code}`)) {
        drafts.push(baseFinding(input, {
          category: "location_comparison",
          code,
          locationIds: [top[0], quiet],
          reviews: top[1],
          title: `${label(code)} differs between outlets`,
          explanation: `${top[1].length} of ${loudCount} reviews at one outlet mention ${label(code)}. Another outlet with at least three reviews has none.`,
          whyItMatters: "The outlets in this scope do not show the same complaint rate in this window.",
          action: "Compare the cited reviews with the outlet that has none of this complaint.",
        }));
        coveredTopics.add(code);
      }
    }
    // Rate-based location comparison: the share test above needs half of
    // an outlet's reviews on one complaint, which healthy chains never
    // reach. This compares complaint rates instead — one outlet's rate
    // at least 3x the scope rate, with enough reviews to mean something.
    if (
      now.length >= 4 &&
      current.length > 0 &&
      !drafts.some((finding) => finding.category === "location_comparison" && finding.topicCodes.includes(code))
    ) {
      const scopeRate = now.length / current.length;
      let worst: { locationId: string; mentions: InsightReview[]; outletTotal: number; rate: number } | null = null;
      for (const locationId of input.locationIds) {
        const outletTotal = current.filter((review) => review.locationId === locationId).length;
        const mentions = byLocation.get(locationId) ?? [];
        if (outletTotal < 30 || mentions.length < 4) continue;
        const rate = mentions.length / outletTotal;
        if (rate >= 3 * scopeRate && rate >= 0.02 && (!worst || rate > worst.rate)) {
          worst = { locationId, mentions, outletTotal, rate };
        }
      }
      if (worst) {
        drafts.push(baseFinding(input, {
          category: "location_comparison",
          code,
          locationIds: [worst.locationId],
          reviews: worst.mentions.slice(0, 25),
          title: `${label(code)} complaints are concentrated at one outlet`,
          explanation: `${worst.mentions.length} of ${worst.outletTotal} reviews at one outlet mention ${label(code)} (${Math.round(worst.rate * 1000) / 10}% of its reviews), against ${now.length} of ${current.length} (${Math.round(scopeRate * 1000) / 10}%) across the scope. Rates compare shares of each outlet's own reviews, not raw counts.`,
          whyItMatters: "Raw counts follow outlet size. A complaint rate several times the scope rate points at one outlet's version of this topic.",
          action: `Compare the cited ${label(code)} reviews at this outlet with the same topic at other outlets before changing anything organisation-wide.`,
          extraMetrics: [metric("location_review_count", worst.outletTotal, worst.outletTotal)],
        }));
      }
    }
    if ((hasRealComparison || halves) && cmpBefore.length >= 1 && cmpNow.length >= 2 && cmpNow.length >= cmpBefore.length * 2 && !coveredTopics.has(code)) {
      drafts.push(baseFinding(input, {
        category: "trend",
        code,
        locationIds: [...new Set(cmpReviews.map((review) => review.locationId))],
        reviews: cmpReviews,
        title: hasRealComparison
          ? `${label(code)} increased against the previous window`
          : `${label(code)} increased in the recent half of this window`,
        explanation: hasRealComparison
          ? `${label(code)} appears in ${cmpNow.length} reviews in this window and ${cmpBefore.length} in the previous window of the same length. This is a count comparison.`
          : `${label(code)} appears in ${cmpNow.length} reviews in the later half of this window and ${cmpBefore.length} in the earlier half. The window is split at its middle review date, so this is a count comparison within the window.`,
        whyItMatters: "The complaint is more common than in the baseline. The sample may still be small.",
        action: "Read the cited reviews and check whether they describe one operational problem.",
        extraMetrics: [
          metric("previous_issue_reviews", cmpBefore.length, cmpBefore.length),
          ...(hasRealComparison
            ? [metric("average_rating_delta", input.summary.changes?.averageRatingDelta ?? null, sampleSize)]
            : []),
        ],
      }));
      coveredTopics.add(code);
    }
    if ((hasRealComparison || halves) && cmpBefore.length === 0 && cmpNow.length >= 3 && !coveredTopics.has(code)) {
      drafts.push(baseFinding(input, {
        category: "emerging_topic",
        code,
        locationIds: [...new Set(cmpReviews.map((review) => review.locationId))],
        reviews: cmpReviews,
        title: hasRealComparison
          ? `${label(code)} was absent in the previous window`
          : `${label(code)} appeared only in the recent half of this window`,
        explanation: hasRealComparison
          ? `The previous window of the same length has 0 reviews mentioning ${label(code)}. This window has ${cmpNow.length}.`
          : `No review in the earlier half of this window mentions ${label(code)}. The later half has ${cmpNow.length}. The window is split at its middle review date.`,
        whyItMatters: "The baseline was checked. Absence there is not proof the issue never occurred earlier.",
        action: "Read the cited reviews before calling this a new operational problem.",
        extraMetrics: [metric("previous_issue_reviews", 0, 0)],
      }));
      coveredTopics.add(code);
    }
    const ratingDelta = input.summary.changes?.averageRatingDelta;
    const ratingStable = ratingDelta !== null && ratingDelta !== undefined && Math.abs(ratingDelta) < 0.2;
    if (input.window.comparison && ratingStable && now.length >= before.length + 2 && now.length >= 2 && !coveredTopics.has(code)) {
      drafts.push(baseFinding(input, {
        category: "trend",
        code,
        locationIds: [...new Set(now.map((review) => review.locationId))],
        reviews: now,
        title: `${label(code)} rose while the average rating stayed near the same`,
        explanation: `Average rating changed by ${ratingDelta} against the previous window. ${label(code)} moved from ${before.length} reviews to ${now.length}.`,
        whyItMatters: "A stable average can hide a complaint that became more common.",
        action: "Read the cited reviews. The rating change does not explain the complaint.",
        extraMetrics: [
          metric("previous_issue_reviews", before.length, before.length),
          metric("average_rating", input.summary.metrics.averageRating, sampleSize),
          metric("average_rating_delta", ratingDelta, sampleSize),
        ],
      }));
      coveredTopics.add(code);
    }
    if ((hasRealComparison || halves) && cmpBefore.length >= 2 && cmpNow.length >= 2 && !coveredTopics.has(code)) {
      drafts.push(baseFinding(input, {
        category: "recurring_issue",
        code,
        locationIds: [...new Set(cmpReviews.map((review) => review.locationId))],
        reviews: cmpReviews,
        title: hasRealComparison
          ? `${label(code)} appears in both windows`
          : `${label(code)} appears in both halves of this window`,
        explanation: hasRealComparison
          ? `${label(code)} is in ${cmpBefore.length} reviews in the previous window and ${cmpNow.length} in this one.`
          : `${label(code)} is in ${cmpBefore.length} reviews in the earlier half of this window and ${cmpNow.length} in the later half. The window is split at its middle review date.`,
        whyItMatters: "The complaint is present on both sides of the comparison. That does not show whether anyone has acted on it.",
        action: "Read both sets of reviews before deciding it is still open.",
        extraMetrics: [metric("previous_issue_reviews", cmpBefore.length, cmpBefore.length)],
      }));
      coveredTopics.add(code);
    }
    if (now.length >= 2 && !coveredTopics.has(code)) {
      standaloneIssues.push({ code, now, before });
    } else if (now.length === 1 && now[0]!.stars <= 3 && !coveredTopics.has(code)) {
      singleVisits.push({ code, now, before });
    }
  }

  standaloneIssues.sort((a, b) => b.now.length - a.now.length);
  singleVisits.sort((a, b) => a.now[0]!.stars - b.now[0]!.stars || complaintQuotes(b.now, b.code).join("").length - complaintQuotes(a.now, a.code).join("").length);
  for (const candidate of [...standaloneIssues.slice(0, 8), ...singleVisits.slice(0, 6)]) {
    const avg = candidate.now.reduce((sum, review) => sum + review.stars, 0) / candidate.now.length;
    const avgRounded = Number(avg.toFixed(2));
    const quotes = complaintQuotes(candidate.now, candidate.code);
    const beside = praiseBeside(candidate.now, candidate.code);
    const quoted = quotes.length > 0 ? ` They say: ${quotes.map((quote) => `“${quote}”`).join(" ")}` : "";
    const comparison = input.window.comparison ? ` The previous window has ${candidate.before.length}.` : "";
    const oneVisit = candidate.now.length === 1;
    const explanation = (oneVisit
      ? `One review complains about ${label(candidate.code)}, at ${avgRounded} stars.${quoted}${comparison} Praise of the same topic is a separate count and is not subtracted.${beside ? ` ${beside}` : ""}`
      : `${candidate.now.length} reviews in this window complain about ${label(candidate.code)}, averaging ${avgRounded} stars.${quoted}${comparison} Praise of the same topic is a separate count and is not subtracted.${beside ? ` ${beside}` : ""}`
    ).slice(0, 800);
    drafts.push(baseFinding(input, {
      category: "recurring_issue",
      code: candidate.code,
      locationIds: [...new Set(candidate.now.map((review) => review.locationId))],
      reviews: candidate.now.slice(0, 25),
      title: oneVisit ? `${label(candidate.code)} in one review` : `${label(candidate.code)} complaints in this window`,
      explanation,
      whyItMatters: oneVisit
        ? "One review is a visit to investigate. The sentence is the complaint. The star rating is not."
        : "These reviews name this complaint in their own words. A larger amount of praise for the same topic does not remove them, and a different complaint in the same review stays in its own finding.",
      action: complaintAction(candidate.code),
      extraMetrics: [
        metric("topic_average_rating", avgRounded, candidate.now.length),
        metric("low_star_reviews", candidate.now.filter((review) => review.stars <= 2).length, candidate.now.length),
      ],
    }));
  }

  const unexplained = current.filter((review) => review.stars <= 3 && review.excerpts.length === 0 && review.issues.length === 0);
  if (unexplained.length > 0) {
    drafts.push(baseFinding(input, {
      category: "recurring_issue",
      code: "",
      locationIds: [...new Set(unexplained.map((review) => review.locationId))],
      reviews: unexplained.slice(0, 25),
      title: "Low-star reviews with no stated complaint",
      explanation: `${unexplained.length} reviews are 1–3 stars and have no complaint quotation. They count in the rating. They are not given a topic.`,
      whyItMatters: "A star rating without words does not say what went wrong. Assigning a topic would be a guess.",
      action: "Leave these unexplained. Do not assign a complaint the review does not write.",
      extraMetrics: [metric("low_star_reviews", unexplained.filter((review) => review.stars <= 2).length, unexplained.length)],
    }));
  }

  for (const code of codes) {
    const praised = current.filter((review) => grounded(review, code, "praise") && review.stars >= 4);
    if (praised.length < 2 || coveredTopics.has(`praise:${code}`)) continue;
    drafts.push(baseFinding(input, {
      category: "positive_driver",
      code,
      locationIds: [...new Set(praised.map((review) => review.locationId))],
      reviews: praised,
      title: `${label(code)} shows up in strong reviews`,
      explanation: `${praised.length} reviews with 4 or 5 stars praise ${label(code)}. The scope average is ${input.summary.metrics.averageRating ?? "unavailable"} from ${sampleSize} reviews.`,
      whyItMatters: "These reviews describe a behaviour guests marked highly. That is an association in this sample, not a cause of the rating.",
      action: "Read the cited reviews if you want to see the wording guests used.",
      extraMetrics: [metric("average_rating", input.summary.metrics.averageRating, sampleSize)],
    }));
  }

  for (const cluster of input.clusters) {
    const members = current.filter((review) => cluster.reviewIds.includes(review.id));
    if (members.length < 2) continue;
    const already = drafts.some((finding) => finding.topicCodes.length > 0 && finding.reviewIds.length === members.length && members.every((review) => finding.reviewIds.includes(review.id)));
    if (already) continue;
    drafts.push(baseFinding(input, {
      category: "recurring_issue",
      code: cluster.topicKey,
      locationIds: [...new Set(members.map((review) => review.locationId))],
      reviews: members,
      clusterIds: [cluster.id],
      title: cluster.title,
      explanation: `${members.length} reviews in this window sit in one cluster, ${cluster.title}. They can use different wording.`,
      whyItMatters: "The cluster groups them by topic and similarity. Wording differences are not separate issues here.",
      action: "Open the cluster and read each supporting review.",
    }));
  }

  // ---- Deep patterns -------------------------------------------------
  // Frequency answers "what is mentioned most", which analytics already
  // shows. These generators answer "what sits next to low ratings, what
  // happy customers still complain about, what is rare but severe, and
  // where one outlet diverges" — patterns a manual read tends to miss.
  const round2 = (value: number) => Number(value.toFixed(2));
  const mentionsOf = (pool: readonly InsightReview[], code: string) =>
    pool.filter((review) => grounded(review, code, "complaint") || grounded(review, code, "praise"));
  const citeLowest = (pool: readonly InsightReview[], cap = 25) =>
    [...pool].sort((a, b) => a.stars - b.stars).slice(0, cap);
  const baseline =
    input.summary.metrics.averageRating ??
    (current.length > 0 ? round2(current.reduce((sum, review) => sum + review.stars, 0) / current.length) : null);

  if (baseline !== null) {
    // Rating drag: a topic need not be frequent to sit next to low stars.
    const dragCandidates: Array<{ code: string; complaints: InsightReview[]; avg: number; drag: number; low: number }> = [];
    for (const code of codes) {
      if (code === "other") continue;
      const complaints = countIssue(current, code);
      if (complaints.length < 5) continue;
      const avg = complaints.reduce((sum, review) => sum + review.stars, 0) / complaints.length;
      const drag = baseline - avg;
      if (drag < 0.35) continue;
      dragCandidates.push({ code, complaints, avg, drag, low: complaints.filter((review) => review.stars <= 2).length });
    }
    dragCandidates.sort((a, b) => b.drag - a.drag || b.complaints.length - a.complaints.length);
    for (const candidate of dragCandidates.slice(0, 5)) {
      drafts.push(baseFinding(input, {
        category: "rating_drag",
        code: candidate.code,
        locationIds: [...new Set(candidate.complaints.map((review) => review.locationId))],
        reviews: citeLowest(candidate.complaints),
        title: `${label(candidate.code)} complaints average ${round2(candidate.avg)} stars`,
        explanation: `${candidate.complaints.length} reviews complain about ${label(candidate.code)}. Their average rating is ${round2(candidate.avg)} against the scope average of ${round2(baseline)}. ${candidate.low} of them are 1 or 2 stars. Praise that uses the same word is not included. This is an association in this sample, not proof of cause.`,
        whyItMatters: "A complaint does not need to be frequent to sit next to low ratings. Volume charts rank it low; the rating gap ranks it high.",
        action: `Read the lowest-rated reviews that complain about ${label(candidate.code)} and check for one fixable cause.`,
        extraMetrics: [
          metric("topic_review_count", candidate.complaints.length, candidate.complaints.length),
          metric("topic_average_rating", round2(candidate.avg), candidate.complaints.length),
          metric("baseline_average_rating", round2(baseline), sampleSize),
          metric("low_star_reviews", candidate.low, candidate.complaints.length),
        ],
      }));
    }

    // Location drag: one outlet's version of a topic is much weaker.
    const locationCandidates: Array<{ locationId: string; code: string; mentions: InsightReview[]; avg: number; topicAvg: number }> = [];
    for (const locationId of input.locationIds) {
      const atLocation = current.filter((review) => review.locationId === locationId);
      if (atLocation.length < 30) continue;
      for (const code of codes) {
        if (code === "other") continue;
        const mentions = mentionsOf(atLocation, code);
        const complaints = countIssue(atLocation, code);
        if (mentions.length < 4 || complaints.length < 2) continue;
        const allMentions = mentionsOf(current, code);
        const avg = mentions.reduce((sum, review) => sum + review.stars, 0) / mentions.length;
        const topicAvg = allMentions.reduce((sum, review) => sum + review.stars, 0) / allMentions.length;
        if (baseline - avg >= 0.5 && topicAvg - avg >= 0.3) {
          locationCandidates.push({ locationId, code, mentions: complaints, avg, topicAvg });
        }
      }
    }
    locationCandidates.sort((a, b) => baseline - b.avg - (baseline - a.avg) || b.mentions.length - a.mentions.length);
    for (const candidate of locationCandidates.slice(0, 5)) {
      drafts.push(baseFinding(input, {
        category: "location_drag",
        code: candidate.code,
        locationIds: [candidate.locationId],
        reviews: citeLowest(candidate.mentions),
        title: `${label(candidate.code)} is weaker at one outlet`,
        explanation: `${candidate.mentions.length} reviews at one outlet complain about ${label(candidate.code)}. Mentions of it at that outlet average ${round2(candidate.avg)} stars. Across the scope the topic averages ${round2(candidate.topicAvg)} and the scope average is ${round2(baseline)}. Praise is not listed as the concern.`,
        whyItMatters: "The topic is not an organisation-wide problem at this size. One outlet's version of it scores far below the rest.",
        action: `Compare the cited reviews at this outlet with the same topic at other outlets before changing anything organisation-wide.`,
        extraMetrics: [
          metric("location_topic_average_rating", round2(candidate.avg), candidate.mentions.length),
          metric("topic_average_rating", round2(candidate.topicAvg), candidate.mentions.length),
          metric("baseline_average_rating", round2(baseline), sampleSize),
        ],
      }));
    }
  }

  // Friction inside fans: complaints and wishes inside 4-5 star reviews.
  const frictionCandidates: Array<{ code: string; happy: InsightReview[] }> = [];
  for (const code of codes) {
    if (code === "other") continue;
    const happy = current.filter((review) => review.stars >= 4 && grounded(review, code, "complaint"));
    if (happy.length >= 3) frictionCandidates.push({ code, happy });
  }
  frictionCandidates.sort((a, b) => b.happy.length - a.happy.length);
  for (const candidate of frictionCandidates.slice(0, 5)) {
    drafts.push(baseFinding(input, {
      category: "fan_friction",
      code: candidate.code,
      locationIds: [...new Set(candidate.happy.map((review) => review.locationId))],
      reviews: candidate.happy.slice(0, 25),
      title: `${label(candidate.code)}: complaints inside happy reviews`,
      explanation: `${candidate.happy.length} reviews with 4 or 5 stars still list ${label(candidate.code)} as a complaint. These customers rated the visit highly overall, so complaint reports that start from low stars miss them.`,
      whyItMatters: "This is what satisfied customers wish were different. It rarely appears in complaint volume because the reviews look positive.",
      action: `Read these reviews for requests and wishes about ${label(candidate.code)} from customers who otherwise rated the visit highly.`,
      extraMetrics: [metric("fan_complaint_reviews", candidate.happy.length, candidate.happy.length)],
    }));
  }

  // Rare but severe: too small for frequency rules, too harsh to ignore.
  const severeCandidates: Array<{ code: string; mentions: InsightReview[]; avg: number; harsh: number }> = [];
  for (const code of codes) {
    if (code === "other") continue;
    const mentions = mentionsOf(current, code);
    if (mentions.length < 2 || mentions.length > 7) continue;
    const harsh = mentions.filter((review) => review.stars <= 2 || review.severe).length;
    const avg = mentions.reduce((sum, review) => sum + review.stars, 0) / mentions.length;
    if (harsh >= 1 && avg <= 3.8) severeCandidates.push({ code, mentions, avg, harsh });
  }
  severeCandidates.sort((a, b) => b.harsh - a.harsh || a.avg - b.avg);
  for (const candidate of severeCandidates.slice(0, 5)) {
    const finding = baseFinding(input, {
      category: "rare_severe",
      code: candidate.code,
      locationIds: [...new Set(candidate.mentions.map((review) => review.locationId))],
      reviews: citeLowest(candidate.mentions),
      title: `${label(candidate.code)} is rare but severe here`,
      explanation: `Only ${candidate.mentions.length} reviews mention ${label(candidate.code)}, and they average ${round2(candidate.avg)} stars. ${candidate.harsh} of them are 1 or 2 stars or flagged severe. Small counts are easy to miss in volume reports.`,
      whyItMatters: "Rare complaints can still describe the worst experiences in the window. Frequency alone would hide them.",
      action: `Read each cited review about ${label(candidate.code)} and decide whether it is an isolated incident or an unchecked gap.`,
      extraMetrics: [
        metric("topic_review_count", candidate.mentions.length, candidate.mentions.length),
        metric("topic_average_rating", round2(candidate.avg), candidate.mentions.length),
        metric("low_star_reviews", candidate.harsh, candidate.mentions.length),
      ],
    });
    drafts.push({ ...finding, quality: "hypothesis", confidence: "low", hypothesis: true });
  }

  // Named staff: people customers mention by name. "Amal", "Mr. Amal",
  // and "Amal Joseph" are one person. A 1-star review whose sentence
  // thanks them is not a complaint about them.
  const staffGroups: Array<{ names: Map<string, number>; reviews: Map<string, InsightReview> }> = [];
  for (const review of current) {
    for (const raw of review.staffMentions ?? []) {
      const written = raw.trim().replace(/\s+/g, " ");
      const identity = staffIdentity(written);
      if (!identity) continue;
      let group = staffGroups.find((item) => [...item.names.keys()].some((name) => sameStaffPerson(staffIdentity(name), identity)));
      if (!group) {
        group = { names: new Map(), reviews: new Map() };
        staffGroups.push(group);
      }
      group.names.set(written, (group.names.get(written) ?? 0) + 1);
      group.reviews.set(review.id, review);
    }
  }
  const staffCandidates = staffGroups
    .map((group) => {
      const written = [...group.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? "";
      const reviews = [...group.reviews.values()];
      const identity = staffIdentity(written);
      const reads = reviews.map((review) => ({ review, read: readStaffReview(review, identity) }));
      const thanks = reads.filter((item) => item.read === "thanks").map((item) => item.review);
      const blamed = reads.filter((item) => item.read === "blame").map((item) => item.review);
      const mismatches = thanks.filter((review) => review.stars <= 2);
      return { name: written, aliases: [...group.names.keys()].filter((item) => item.toLowerCase() !== written.toLowerCase()), reviews, thanks, blamed, mismatches, identity };
    })
    .filter((candidate) => candidate.name && candidate.reviews.length >= 3)
    .sort((a, b) => b.blamed.length - a.blamed.length || b.thanks.length - a.thanks.length || b.reviews.length - a.reviews.length)
    .slice(0, 12);
  for (const candidate of staffCandidates) {
    const finding = baseFinding(input, {
      category: "staff_mention",
      code: "",
      locationIds: [...new Set(candidate.reviews.map((review) => review.locationId))],
      reviews: citeLowest(candidate.reviews),
      title: candidate.blamed.length > candidate.thanks.length
        ? `Customers name "${candidate.name}" when the visit goes badly`
        : `Customers name "${candidate.name}" to thank the staff`,
      explanation: staffExplanation(candidate).slice(0, 800),
      whyItMatters: "A repeated name is a person a manager can recognise or correct. The sentence says what they did. The star only scores the visit.",
      action: staffAction(candidate),
      extraMetrics: [
        metric("staff_mention_reviews", candidate.reviews.length, candidate.reviews.length),
        metric("staff_praise_reviews", candidate.thanks.length, candidate.reviews.length),
        metric("staff_complaint_reviews", candidate.blamed.length, candidate.reviews.length),
        metric("topic_average_rating", round2(candidate.reviews.reduce((sum, review) => sum + review.stars, 0) / candidate.reviews.length), candidate.reviews.length),
      ],
    });
    drafts.push({ ...finding, key: keyFor("staff_mention", candidate.identity, []) });
  }

  // Customer requests: wishes and asks copied from the reviews. Grouped
  // by a normalised key (light singularisation, first five words), so
  // "need more collection" and "need more collections for kids" count
  // as the same ask instead of fragmenting below the evidence bar.
  const REQUEST_STOPWORDS = new Set(["the", "a", "an", "for", "in", "of", "to", "and", "or", "can", "be", "is", "are", "pls", "please", "with", "some"]);
  const normaliseRequestKey = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
      .filter((word) => !REQUEST_STOPWORDS.has(word))
      .slice(0, 3)
      .join(" ");
  const requestMap = new Map<string, { displays: Map<string, number>; reviews: Map<string, InsightReview> }>();
  for (const review of current) {
    for (const raw of review.requests ?? []) {
      const display = raw.trim().replace(/\s+/g, " ");
      if (display.length < 8) continue;
      const key = normaliseRequestKey(display);
      if (!key) continue;
      const entry = requestMap.get(key) ?? { displays: new Map<string, number>(), reviews: new Map<string, InsightReview>() };
      entry.displays.set(display, (entry.displays.get(display) ?? 0) + 1);
      entry.reviews.set(review.id, review);
      requestMap.set(key, entry);
    }
  }
  const requestCandidates = [...requestMap.entries()]
    .map(([key, entry]) => ({
      key,
      display: [...entry.displays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key,
      reviews: [...entry.reviews.values()],
    }))
    .filter((candidate) => candidate.reviews.length >= 2)
    .sort((a, b) => b.reviews.length - a.reviews.length)
    .slice(0, 5);
  for (const candidate of requestCandidates) {
    const avg = candidate.reviews.reduce((sum, review) => sum + review.stars, 0) / candidate.reviews.length;
    const finding = baseFinding(input, {
      category: "customer_request",
      code: "",
      locationIds: [...new Set(candidate.reviews.map((review) => review.locationId))],
      reviews: candidate.reviews.slice(0, 25),
      title: `Customers are asking: "${candidate.display.slice(0, 90)}"`,
      explanation: `${candidate.reviews.length} reviews contain this request or wish in the customer's own words. Their average rating is ${round2(avg)}. Requests are copied from the reviews, not paraphrased by a model.`,
      whyItMatters: "Requests are demand the store has not met yet, stated directly by customers. They rarely appear in complaint counts because the reviewers are often otherwise happy.",
      action: `Read the cited reviews behind this request and judge whether it is cheap to grant for the customers asking.`,
      extraMetrics: [
        metric("request_review_count", candidate.reviews.length, candidate.reviews.length),
        metric("topic_average_rating", round2(avg), candidate.reviews.length),
      ],
    });
    drafts.push({ ...finding, key: keyFor("customer_request", candidate.key, []) });
  }

  // Micro-topics: phrases customers repeat inside their own wording.
  // Extraction v2 aspect phrases (the model's read of the customer's
  // wording) are preferred; n-gram mining over quotation text remains
  // as the fallback for reviews extracted before v2. These are the
  // specific, store-level subjects a fixed taxonomy flattens
  // ("kidswear selection", "size missing") — no model at this step.
  const PHRASE_STOP = new Set([
    "the", "and", "for", "with", "was", "were", "are", "very", "really", "good", "great", "nice", "best",
    "experience", "fazyo", "this", "that", "have", "had", "from", "they", "them", "then", "than", "but",
    "not", "all", "one", "our", "you", "your", "its", "it's", "too", "much", "more", "also", "just",
  ]);
  const phraseMap = new Map<string, { reviews: Map<string, InsightReview>; topics: Map<string, number>; stars: number; complaints: Set<string> }>();
  // A phrase built only from filler praise words ("good service", "nice
  // collection", "customer service") restates a broad topic and buries
  // the specific phrases that name something actionable.
  const GENERIC_PHRASE_WORDS = new Set([
    "good", "nice", "great", "excellent", "best", "super", "awesome", "amazing", "wonderful", "fantastic",
    "customer", "service", "services", "staff", "collection", "collections", "quality", "price", "prices",
    "affordable", "reasonable", "friendly", "helpful", "selection", "experience", "store", "shop", "pricing",
  ]);
  const isFillerPhrase = (phrase: string): boolean =>
    phrase.split(" ").every((word) => GENERIC_PHRASE_WORDS.has(word));
  for (const review of current) {
    const seenInReview = new Set<string>();
    for (const excerpt of review.excerpts) {
      const tokens = excerpt.text
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2 && !PHRASE_STOP.has(token));
      for (let size = 2; size <= 3; size += 1) {
        for (let index = 0; index + size <= tokens.length; index += 1) {
          const phrase = `${excerpt.polarity}:${tokens.slice(index, index + size).join(" ")}`;
          if (seenInReview.has(phrase)) continue;
          seenInReview.add(phrase);
          const entry = phraseMap.get(phrase) ?? { reviews: new Map<string, InsightReview>(), topics: new Map<string, number>(), stars: 0, complaints: new Set<string>() };
          if (!entry.reviews.has(review.id)) {
            entry.reviews.set(review.id, review);
            entry.stars += review.stars;
          }
          if (excerpt.polarity === "complaint") entry.complaints.add(review.id);
          entry.topics.set(excerpt.topicCode, (entry.topics.get(excerpt.topicCode) ?? 0) + 1);
          phraseMap.set(phrase, entry);
        }
      }
    }
  }
  const taxonomyLabels = new Set(TAXONOMY_V2.map((node) => node.label.toLowerCase()));
  // Aspect phrases from extraction v2: the aspect in the customer's own
  // wording, attached to a topic code. Preferred over mined n-grams.
  const aspectMap = new Map<string, { reviews: Map<string, InsightReview>; topics: Map<string, number>; stars: number; complaints: Set<string> }>();
  for (const review of current) {
    const seenInReview = new Set<string>();
    for (const aspect of review.aspects ?? []) {
      const display = aspect.phrase.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const phrase = `${aspect.polarity}:${display}`;
      if (display.length < 6 || seenInReview.has(phrase)) continue;
      seenInReview.add(phrase);
      const entry = aspectMap.get(phrase) ?? { reviews: new Map<string, InsightReview>(), topics: new Map<string, number>(), stars: 0, complaints: new Set<string>() };
      if (!entry.reviews.has(review.id)) {
        entry.reviews.set(review.id, review);
        entry.stars += review.stars;
      }
      if (aspect.polarity === "complaint") entry.complaints.add(review.id);
      entry.topics.set(aspect.topicCode, (entry.topics.get(aspect.topicCode) ?? 0) + 1);
      aspectMap.set(phrase, entry);
    }
  }
  type MicroCandidate = { phrase: string; polarity: "praise" | "complaint"; reviews: InsightReview[]; topic: string; avg: number; complaints: number };
  const toCandidate = (key: string, entry: { reviews: Map<string, InsightReview>; topics: Map<string, number>; stars: number; complaints: Set<string> }): MicroCandidate => {
    const reviews = [...entry.reviews.values()];
    const topic = [...entry.topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const polarity = key.startsWith("praise:") ? "praise" : "complaint";
    const phrase = key.replace(/^(praise|complaint|neutral):/, "");
    return { phrase, polarity, reviews, topic, avg: reviews.length ? entry.stars / reviews.length : 0, complaints: entry.complaints.size };
  };
  // Ranked for signal, not applause: phrases carrying complaints first
  // (they name something fixable), then by reach, then by low rating.
  // Filler phrases are excluded outright so specific subjects surface.
  const bySignal = (a: MicroCandidate, b: MicroCandidate): number =>
    b.complaints - a.complaints || b.reviews.length - a.reviews.length || a.avg - b.avg;
  const aspectRanked = [...aspectMap.entries()]
    .map(([phrase, entry]) => toCandidate(phrase, entry))
    .filter((candidate) => candidate.reviews.length >= 3 && candidate.topic && !taxonomyLabels.has(candidate.phrase) && !isFillerPhrase(candidate.phrase));
  const ngramRanked = [...phraseMap.entries()]
    .map(([phrase, entry]) => toCandidate(phrase, entry))
    .filter((candidate) => candidate.reviews.length >= 3 && candidate.topic && !taxonomyLabels.has(candidate.phrase) && !isFillerPhrase(candidate.phrase));
  const microRanked = [...aspectRanked, ...ngramRanked].sort(bySignal);
  const microCandidates: MicroCandidate[] = [];
  for (const candidate of microRanked) {
    const candidateIds = new Set(candidate.reviews.map((review) => review.id));
    const redundant = microCandidates.some((kept) => {
      if (kept.polarity !== candidate.polarity) return false;
      if (kept.phrase.includes(candidate.phrase) || candidate.phrase.includes(kept.phrase)) return true;
      // Near-duplicates restating the same reviews ("good service" vs
      // "customer service") count once, whichever phrasing ranked first.
      const overlap = kept.reviews.filter((review) => candidateIds.has(review.id)).length;
      return candidate.reviews.length > 0 && overlap / candidate.reviews.length >= 0.7;
    });
    if (!redundant) microCandidates.push(candidate);
    if (microCandidates.length >= 6) break;
  }
  for (const candidate of microCandidates) {
    const finding = baseFinding(input, {
      category: "micro_topic",
      code: candidate.topic,
      locationIds: [...new Set(candidate.reviews.map((review) => review.locationId))],
      reviews: citeLowest(candidate.reviews),
      title: candidate.polarity === "praise"
        ? `Praise keeps mentioning "${candidate.phrase}"`
        : `Complaints keep mentioning "${candidate.phrase}"`,
      explanation: `${candidate.reviews.length} reviews use wording like "${candidate.phrase}". Most sit under ${label(candidate.topic)}. Their average rating is ${round2(candidate.avg)}.${candidate.complaints > 0 ? ` ${candidate.complaints} of them raise it as a complaint.` : ""} This phrase comes from the customers' own words, not the fixed topic list.`,
      whyItMatters: "Specific phrases name the exact subject behind a broad topic. Broad topics say what area; phrases say what happened.",
      action: `Read the cited reviews mentioning "${candidate.phrase}" and decide whether it deserves a fix or its own tracked topic.`,
      extraMetrics: [
        metric("phrase_review_count", candidate.reviews.length, candidate.reviews.length),
        metric("topic_average_rating", round2(candidate.avg), candidate.reviews.length),
      ],
    });
    drafts.push({ ...finding, key: keyFor("micro_topic", `${candidate.polarity}:${candidate.phrase}`, []) });
  }

  const findings = drafts
    .map((finding) => attachComplaintQuotes(finding, current))
    .map((finding) => ({ finding, kept: claimsMatch(finding, input) }))
    .filter((row) => row.kept)
    .map((row) => row.finding)
    .filter((finding, index, list) => list.findIndex((item) => item.key === finding.key) === index);

  if (findings.length === 0) {
    return {
      sourceHash,
      insufficient: true,
      insufficientReason: "The reviews in this window do not meet the evidence rules for a finding.",
      findings: [],
      recommendations: [],
    };
  }
  return {
    sourceHash,
    insufficient: false,
    insufficientReason: null,
    findings,
    recommendations: findings
      .filter((finding) => finding.action)
      .map((finding) => ({ findingKey: finding.key, action: finding.action as string })),
  };
}

export function claimsMatch(finding: InsightFinding, input: InsightInput): boolean {
  if (finding.evidenceCount !== finding.reviewIds.length) return false;
  if (finding.sampleSize !== input.summary.coverage.reviewCount) return false;
  const allowed = new Set(input.reviews.filter((review) => inScope(input, review)).map((review) => review.id));
  if (finding.reviewIds.some((id) => !allowed.has(id))) return false;
  const reviewCount = finding.metrics.find((item) => item.key === "review_count");
  if (!reviewCount || reviewCount.value !== input.summary.coverage.reviewCount) return false;
  const issueCount = finding.metrics.find((item) => item.key === "issue_reviews");
  if (!issueCount || issueCount.value !== finding.evidenceCount) return false;
  const rating = finding.metrics.find((item) => item.key === "average_rating");
  if (rating && rating.value !== input.summary.metrics.averageRating) return false;
  const delta = finding.metrics.find((item) => item.key === "average_rating_delta");
  if (delta && delta.value !== (input.summary.changes?.averageRatingDelta ?? null)) return false;
  if (/statistically significant|will improve|will raise|caused the/i.test(`${finding.explanation} ${finding.action ?? ""}`)) return false;
  return findingSchema.safeParse(finding).success;
}

export function allowedNumbers(finding: InsightFinding): Set<string> {
  const values = new Set<string>();
  for (const item of finding.metrics) {
    if (item.value === null) continue;
    values.add(String(item.value));
    values.add(String(item.sampleSize));
  }
  values.add(String(finding.evidenceCount));
  values.add(String(finding.sampleSize));
  return values;
}

/** Model prose may only repeat numbers already on the finding. Other numbers are dropped. */
export function applyModelProse(
  finding: InsightFinding,
  prose: { title?: string; explanation?: string; whyItMatters?: string; action?: string | null },
  modelId = finding.model
): InsightFinding {
  const allowed = allowedNumbers(finding);
  const safe = (text: string | undefined, fallback: string) => {
    if (!text?.trim()) return fallback;
    const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
    if (numbers.some((value) => !allowed.has(value))) return fallback;
    if (/statistically significant|will improve|will raise|caused the/i.test(text)) return fallback;
    return text.trim().slice(0, 800);
  };
  const next = {
    ...finding,
    title: safe(prose.title, finding.title).slice(0, 160),
    explanation: safe(prose.explanation, finding.explanation),
    whyItMatters: safe(prose.whyItMatters, finding.whyItMatters).slice(0, 400),
    action: prose.action === null ? null : safe(prose.action ?? undefined, finding.action ?? "").slice(0, 400) || finding.action,
  };
  const proseKept =
    next.title !== finding.title ||
    next.explanation !== finding.explanation ||
    next.whyItMatters !== finding.whyItMatters ||
    next.action !== finding.action;
  const withModel = { ...next, model: proseKept ? modelId : finding.model };
  const parsed = findingSchema.safeParse(withModel);
  return parsed.success ? parsed.data : finding;
}

export interface StoredInsight {
  id: string;
  sourceHash: string;
  version: number;
  status: "pending" | "ready" | "failed" | "stale";
  findings: InsightFinding[];
}

export function planInsightWrite(
  existing: readonly StoredInsight[],
  sourceHash: string,
  force: boolean,
  openJob: boolean
): { action: "reuse" | "processing" | "create"; version: number; id?: string } {
  if (openJob) return { action: "processing", version: 0 };
  const ready = existing.filter((report) => report.status === "ready" && report.sourceHash === sourceHash);
  const latest = ready.sort((a, b) => b.version - a.version)[0];
  if (latest && !force) return { action: "reuse", version: latest.version, id: latest.id };
  const max = existing.reduce((best, report) => Math.max(best, report.version), 0);
  return { action: "create", version: max + 1 };
}

/** A stale or failed report is not a current insight. */
export function presentInsight(report: StoredInsight | null): StoredInsight | null {
  if (!report || report.status !== "ready") return null;
  return report;
}
