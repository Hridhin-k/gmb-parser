import { COMPLAINT_THEMES } from "@/lib/review-inbox";
import { canonicalReviewText } from "@/lib/intelligence/fingerprint";

const THEME_TO_ISSUE: Record<string, string> = {
  wait: "billing",
  staff: "staff",
  price: "price",
  cleanliness: "cleanliness",
  quality: "quality",
};

export type RulesSentiment = "positive" | "neutral" | "negative";

export interface RulesIntelligenceDraft {
  sentiment: RulesSentiment;
  issueCode: string | null;
  excerpt: string | null;
}

export function rulesSentiment(starRating: number): RulesSentiment {
  if (starRating >= 4) return "positive";
  if (starRating <= 2) return "negative";
  return "neutral";
}

function excerptForWords(comment: string, words: readonly string[]): string | null {
  const lower = comment.toLowerCase();
  for (const word of words) {
    const at = lower.indexOf(word);
    if (at >= 0) return comment.slice(at, at + word.length);
  }
  return null;
}

/**
 * Star sentiment for every review. A 1–3 star review with a known complaint word
 * also records that issue. The excerpt is a slice of the stored comment.
 */
export function buildRulesIntelligence(input: {
  starRating: number;
  comment: string | null;
}): RulesIntelligenceDraft {
  const sentiment = rulesSentiment(input.starRating);
  const comment = canonicalReviewText(input.comment);
  if (!comment || input.starRating > 3) {
    return { sentiment, issueCode: null, excerpt: null };
  }
  for (const theme of COMPLAINT_THEMES) {
    if (theme.id === "unspecified") continue;
    const excerpt = excerptForWords(comment, theme.words);
    const issueCode = THEME_TO_ISSUE[theme.id];
    if (excerpt && issueCode && comment.includes(excerpt)) {
      return { sentiment, issueCode, excerpt };
    }
  }
  return { sentiment, issueCode: null, excerpt: null };
}
