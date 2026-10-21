import { detectReviewLanguage } from "@/lib/review-inbox";
import { COMPLAINT_WORD, excerptSupportsClaim } from "@/lib/intelligence/claim-support";
import {
  EXTRACT_ANALYSIS_VERSION,
  EXTRACT_PROMPT_VERSION,
  overallFrom,
  ratingBand,
  textSentimentFrom,
  type ExtractionQuotation,
  type ReviewExtraction,
} from "@/lib/intelligence/extraction";
import { TAXONOMY_VERSION, TAXONOMY_V2, isLeafTopic } from "@/lib/intelligence/taxonomy";

/**
 * Zero-token extraction. Phrases from taxonomy-v2 plus common review wording
 * are matched inside clauses of the comment. The excerpt is the clause itself,
 * copied from the stored comment, so every assignment stays a quotation.
 *
 * covered means the rules produced at least one praise or complaint quotation,
 * or the comment is too short to hold a topic at all ("Good", "Super"), in
 * which case a model call would find nothing either. Anything else is residue
 * for the batched model pass.
 */

type Polarity = ExtractionQuotation["polarity"];

interface Phrase {
  text: string;
  code: string;
  polarity: Polarity | "clause";
}

const P = (text: string, code: string, polarity: Phrase["polarity"] = "clause"): Phrase => ({ text, code, polarity });

const PHRASES: readonly Phrase[] = [
  // Staff
  P("staff were polite", "staff_politeness", "praise"),
  P("staff was polite", "staff_politeness", "praise"),
  P("polite staff", "staff_politeness", "praise"),
  P("rude staff", "staff_politeness", "complaint"),
  P("staff rude", "staff_politeness", "complaint"),
  P("friendly staff", "staff_politeness", "praise"),
  P("helpful staff", "staff_politeness", "praise"),
  P("good service", "staff_politeness", "praise"),
  P("excellent service", "staff_politeness", "praise"),
  P("great service", "staff_politeness", "praise"),
  P("bad service", "staff_politeness", "complaint"),
  P("poor service", "staff_politeness", "complaint"),
  P("worst service", "staff_politeness", "complaint"),
  P("customer service", "staff_politeness"),
  P("staff behaviour", "staff_politeness"),
  P("staff behavior", "staff_politeness"),
  P("staff", "staff_politeness"),
  P("knowledgeable", "staff_knowledge", "praise"),
  P("did not know", "staff_knowledge", "complaint"),
  P("no staff", "staff_availability", "complaint"),
  P("short staffed", "staff_availability", "complaint"),
  P("nobody to help", "staff_availability", "complaint"),
  P("no one attended", "staff_availability", "complaint"),
  P("ignored", "staff_availability", "complaint"),
  // Product
  P("good collection", "product_variety", "praise"),
  P("nice collection", "product_variety", "praise"),
  P("latest collection", "product_variety", "praise"),
  P("new collection", "product_variety", "praise"),
  P("collections", "product_variety"),
  P("collection", "product_variety"),
  P("variety", "product_variety"),
  P("selection", "product_variety"),
  P("designs", "product_variety"),
  P("poor quality", "product_quality", "complaint"),
  P("worst quality", "product_quality", "complaint"),
  P("bad quality", "product_quality", "complaint"),
  P("good quality", "product_quality", "praise"),
  P("quality is good", "product_quality", "praise"),
  P("after wash", "product_quality", "complaint"),
  P("after 1st wash", "product_quality", "complaint"),
  P("after first wash", "product_quality", "complaint"),
  P("damaged", "product_quality", "complaint"),
  P("torn", "product_quality", "complaint"),
  P("faded", "product_quality", "complaint"),
  P("shrink", "product_quality", "complaint"),
  P("defect", "product_quality", "complaint"),
  P("quality", "product_quality"),
  P("out of stock", "product_availability", "complaint"),
  P("sold out", "product_availability", "complaint"),
  P("not available", "product_availability", "complaint"),
  P("unavailable", "product_availability", "complaint"),
  // Store
  P("dirty", "cleanliness", "complaint"),
  P("unhygienic", "cleanliness", "complaint"),
  P("not clean", "cleanliness", "complaint"),
  P("very clean", "cleanliness", "praise"),
  P("clean and neat", "cleanliness", "praise"),
  P("neat and clean", "cleanliness", "praise"),
  P("clean", "cleanliness", "praise"),
  P("hygiene", "cleanliness"),
  P("trial room", "fitting_room"),
  P("changing room", "fitting_room"),
  P("fitting room", "fitting_room"),
  P("crowded", "layout_access", "complaint"),
  P("cramped", "layout_access", "complaint"),
  P("spacious", "layout_access", "praise"),
  // Waiting
  P("billing queue", "billing_delay", "complaint"),
  P("billing counter", "billing_delay"),
  P("billing", "billing_delay"),
  P("checkout", "billing_delay"),
  P("long queue", "queue_time", "complaint"),
  P("queue", "queue_time"),
  P("waiting time", "queue_time", "complaint"),
  P("long wait", "queue_time", "complaint"),
  P("waiting", "queue_time"),
  P("slow service", "service_delay", "complaint"),
  P("took forever", "service_delay", "complaint"),
  P("very slow", "service_delay", "complaint"),
  // Price and other leaf topics
  P("high price", "price", "complaint"),
  P("price is high", "price", "complaint"),
  P("prices are high", "price", "complaint"),
  P("price was high", "price", "complaint"),
  P("rate is high", "price", "complaint"),
  P("rates are high", "price", "complaint"),
  P("high rate", "price", "complaint"),
  P("overpriced", "price", "complaint"),
  P("expensive", "price", "complaint"),
  P("costly", "price", "complaint"),
  P("affordable", "price", "praise"),
  P("reasonable price", "price", "praise"),
  P("budget friendly", "price", "praise"),
  P("refund", "exchange", "complaint"),
  P("exchange", "exchange"),
  P("return policy", "exchange"),
  P("parking", "parking"),
];

const POSITIVE_WORDS = [
  "good", "great", "excellent", "nice", "best", "amazing", "wonderful", "superb",
  "awesome", "happy", "satisfied", "loved", "love", "friendly", "helpful", "polite",
  "courteous", "neat", "reasonable", "affordable", "worth", "fantastic", "perfect",
];

const NEGATIVE_WORDS = [
  "poor", "bad", "worst", "waste", "dirty", "rude", "slow", "damaged", "damage",
  "torn", "faded", "expensive", "costly", "overpriced", "disappointed", "cheating",
  "pathetic", "horrible", "terrible", "useless", "shrink", "shrunk", "complaint",
  "issue", "problem", "not good", "not worth", "fraud", "fake",
];

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

interface Clause {
  text: string;
}

function clauses(comment: string): Clause[] {
  const parts = comment.match(/[^.!?;\n]+[.!?;]?/g) ?? [comment];
  return parts.map((part) => ({ text: part.trim() })).filter((part) => part.text.length > 0);
}

function clausePolarity(clause: string): Polarity {
  const negated = /\b(not|no|never|n't)\b/i.test(clause);
  const positive = POSITIVE_WORDS.some((word) => hasWord(clause, word)) && !negated;
  const negative = NEGATIVE_WORDS.some((word) => hasWord(clause, word)) || negated;
  if (negative && positive) return "neutral";
  if (negative) return "complaint";
  if (positive) return "praise";
  return "neutral";
}

export interface RulesExtractionResult {
  extraction: ReviewExtraction;
  covered: boolean;
  reason: "rating_only" | "topic_match" | "short_without_topic" | "residue";
}

const STAFF_NAME_PATTERNS: readonly RegExp[] = [
  /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss)\.?\s+([A-Z][a-z]{2,20})\b/g,
  /\b(?:[Ss]taff|[Ss]alesman|[Ss]aleswoman|[Ss]alesgirl|[Ss]alesboy|[Ee]xecutive|[Aa]ttendant|[Pp]erson|[Gg]uy|[Gg]irl|[Mm]adam|[Ss]ir)\s+(?:named\s+)?([A-Z][a-z]{2,20})\b/g,
  /\b[Ee]specially\s+(?:that\s+\w+\s+)?(?:named\s+)?([A-Z][a-z]{2,20})\b/g,
];

const NON_NAMES = new Set(["Good", "Very", "The", "This", "That", "Fazyo", "Google", "Onam", "Kerala", "India"]);

/** Staff names written with an honorific or role, exactly as written. */
export function detectStaffMentions(comment: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const pattern of STAFF_NAME_PATTERNS) {
    for (const match of comment.matchAll(pattern)) {
      const name = match[1];
      if (!name || NON_NAMES.has(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(name);
      if (found.length >= 4) return found;
    }
  }
  return found;
}

const REQUEST_PATTERN = /\b(?:wish|hope|hoping|need|needs|needed|please add|please bring|should have|if only|expecting more)\b[^.!?]{0,120}/gi;

/** Customer requests or wishes, copied from the comment. */
export function detectRequests(comment: string): string[] {
  const out: string[] = [];
  for (const match of comment.matchAll(REQUEST_PATTERN)) {
    const text = match[0].trim().replace(/\s+/g, " ");
    if (text.length >= 8 && !out.includes(text)) out.push(text.slice(0, 160));
    if (out.length >= 3) break;
  }
  return out;
}

const ROUTING_KEYWORDS = [
  "collection",
  "collections",
  "staff",
  "staffs",
  "service",
  ...TAXONOMY_V2.flatMap((node) => (isLeafTopic(node.code) ? [node.label, ...node.aliases] : [])),
].filter((word) => word.length >= 4);

/** A taxonomy word or a common review subject. Keyword hits are read by the model, not left on the phrase rules. */
export function mentionsRoutingKeyword(text: string): boolean {
  return ROUTING_KEYWORDS.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

function hasSubstantialNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.filter((letter) => !/[A-Za-z]/.test(letter)).length >= 12;
}

/**
 * Gemini reads the review when the text can carry a real complaint or a
 * real compliment that a phrase rule would flatten. Rating-only reviews
 * and short praise with no topic word ("Loved it", "Nice") stay on the rules.
 * Routed: any negative wording, any 1–3 star review with text, a long
 * positive or neutral review, a taxonomy keyword, a named person, a
 * request, or a review the rules cannot read because it is not Latin text.
 */
export function requiresAiReview(comment: string | null, starRating: number, rules: RulesExtractionResult): boolean {
  const text = comment?.trim() ?? "";
  if (!text) return false;
  if (starRating <= 3) return true;
  if (hasSubstantialNonLatin(text)) return true;
  if (rules.extraction.interpretation.textSentiment === "negative") return true;
  if (rules.extraction.facts.quotations.some((item) => item.polarity === "complaint")) return true;
  if (COMPLAINT_WORD.test(text)) return true;
  if (detectStaffMentions(text).length > 0) return true;
  if (text.length > 80) return true;
  const polarities = new Set(rules.extraction.facts.quotations.map((item) => item.polarity));
  if (polarities.has("praise") && polarities.has("complaint")) return true;
  if (detectRequests(text).length > 0) return true;
  if (mentionsRoutingKeyword(text)) return true;
  return false;
}

export function buildRulesExtraction(comment: string | null, starRating: number): RulesExtractionResult {
  const band = ratingBand(starRating);
  if (!comment?.trim()) {
    return {
      covered: true,
      reason: "rating_only",
      extraction: {
        analysisVersion: EXTRACT_ANALYSIS_VERSION,
        taxonomyVersion: TAXONOMY_VERSION,
        promptVersion: EXTRACT_PROMPT_VERSION,
        repaired: false,
        reused: false,
        facts: { rating: { stars: starRating, band }, language: "none", quotations: [] },
        interpretation: {
          textSentiment: "unknown",
          overall: "unknown",
          severity: "none",
          urgency: "none",
          escalation: [],
          staffMentions: [],
          requests: [],
          actionable: [],
          entities: [],
          uncertain: false,
          note: "",
        },
      },
    };
  }

  const text = comment.trim();
  const byCode = new Map<string, ExtractionQuotation>();
  for (const clause of clauses(text)) {
    const lower = clause.text.toLowerCase();
    for (const phrase of PHRASES) {
      if (!lower.includes(phrase.text)) continue;
      if (byCode.has(phrase.code)) continue;
      let polarity: Polarity;
      let confidence: number;
      if (phrase.polarity === "clause") {
        polarity = clausePolarity(clause.text);
        confidence = 0.7;
        if (polarity !== "neutral" && !excerptSupportsClaim(phrase.code, polarity, clause.text)) continue;
      } else {
        polarity = phrase.polarity;
        confidence = 0.9;
      }
      // A negated praise phrase is a complaint ("not clean", "not polite").
      if (polarity === "praise" && /\b(not|no|never)\s+\w{0,12}$/.test(lower.slice(0, lower.indexOf(phrase.text) + 1))) {
        polarity = "complaint";
        confidence = 0.8;
      }
      const excerpt = clause.text.slice(0, 240);
      if (!text.includes(excerpt)) continue;
      byCode.set(phrase.code, {
        topicCode: phrase.code,
        polarity,
        excerpt,
        phrase: phrase.text,
        rank: "secondary",
        confidence,
        uncertain: polarity === "neutral",
      });
    }
  }

  const quotations = [...byCode.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  if (quotations[0]) quotations[0].rank = "primary";
  const hasComplaint = quotations.some((item) => item.polarity === "complaint");
  const complaintText = quotations.filter((item) => item.polarity === "complaint").map((item) => item.excerpt).join(" ").toLowerCase();
  const severity: ReviewExtraction["interpretation"]["severity"] = !hasComplaint
    ? "none"
    : /refund|cheat|fraud|safety|injur|money/.test(complaintText)
      ? "high"
      : /poor|worst|damaged|torn|faded|shrink|disappointed/.test(complaintText)
        ? "moderate"
        : "low";
  const textSentiment = textSentimentFrom(quotations);
  const supported = quotations.some((item) => item.polarity !== "neutral");
  const shortWithoutTopic = quotations.length === 0 && (text.length <= 40 || text.split(/\s+/).length <= 6);

  return {
    covered: supported || shortWithoutTopic,
    reason: supported ? "topic_match" : shortWithoutTopic ? "short_without_topic" : "residue",
    extraction: {
      analysisVersion: EXTRACT_ANALYSIS_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      promptVersion: EXTRACT_PROMPT_VERSION,
      repaired: false,
      reused: false,
      facts: {
        rating: { stars: starRating, band },
        language: detectReviewLanguage(text),
        quotations,
      },
      interpretation: {
        textSentiment,
        overall: overallFrom(textSentiment, band),
        severity,
        urgency: severity === "high" ? "soon" : "none",
        escalation: /refund/.test(text.toLowerCase()) && quotations.some((item) => item.topicCode === "exchange")
          ? [{ code: "refund_or_billing" as const, excerpt: quotations.find((item) => item.topicCode === "exchange")!.excerpt }]
          : [],
        actionable: quotations
          .filter((item) => item.polarity === "complaint")
          .map((item) => ({ topicCode: item.topicCode, excerpt: item.excerpt })),
        entities: [],
        staffMentions: detectStaffMentions(text),
        requests: detectRequests(text),
        uncertain: textSentiment === "unknown",
        note: "",
      },
    },
  };
}
