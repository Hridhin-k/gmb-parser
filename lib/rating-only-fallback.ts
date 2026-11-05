import { checkGeneratedReplyGuardrails } from "@/lib/reply-guardrails";
import { neverSayViolations } from "@/lib/reply-knowledge";
import type { DraftAdjustment } from "@/lib/reply-adjustments";

export const RATING_ONLY_TEMPLATE_MODEL = "template:rating-only-v1";

/** A vetted acknowledgement can replace a blocked initial draft, never the model's blocked text. */
export function ratingOnlyFallback(input: {
  comment: string | null;
  stars: number;
  previousDraft?: string | null;
  adjustment?: DraftAdjustment;
  neverSay: string[];
}): string | null {
  if (input.comment?.trim() || input.previousDraft?.trim()
    || (input.adjustment && input.adjustment.kind !== "regenerate")) return null;
  const choices = input.stars >= 4
    ? ["Thank you for taking the time to rate us. We look forward to welcoming you again.",
        "Thanks for leaving us a rating. We appreciate you choosing us."]
    : ["Thank you for leaving a rating. Please contact our team directly so we can understand how to improve.",
        "We appreciate you taking the time to rate us. Please let our team know how we can make your next visit better."];
  return choices.find((text) => !checkGeneratedReplyGuardrails(text).length && !neverSayViolations(text, input.neverSay).length) ?? null;
}
