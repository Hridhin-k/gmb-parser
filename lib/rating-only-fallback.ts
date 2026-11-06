import { checkGeneratedReplyGuardrails } from "@/lib/reply-guardrails";
import { neverSayViolations } from "@/lib/reply-knowledge";
import type { ResolutionContact } from "@/lib/resolution-contact";
import type { DraftAdjustment } from "@/lib/reply-adjustments";

export const RATING_ONLY_TEMPLATE_MODEL = "template:rating-only-v1";

/** A vetted acknowledgement can replace a blocked initial draft, never the model's blocked text. */
export function ratingOnlyFallback(input: {
  comment: string | null;
  stars: number;
  previousDraft?: string | null;
  adjustment?: DraftAdjustment;
  neverSay: string[];
  contact?: ResolutionContact | null;
}): string | null {
  if (input.comment?.trim() || input.previousDraft?.trim()
    || (input.adjustment && input.adjustment.kind !== "regenerate")) return null;
  const choices = input.stars >= 4
    ? ["Thank you for taking the time to rate us. We look forward to welcoming you again.",
        "Thanks for leaving us a rating. We appreciate you choosing us."]
    : ["Thank you for leaving a rating. Please contact our team directly so we can understand how to improve.",
        "We appreciate you taking the time to rate us. Please let our team know how we can make your next visit better."];
  const reach = [input.contact?.phone, input.contact?.email].filter(Boolean).join(" or ");
  const prepared = reach ? choices.map((text) => input.stars >= 4
    ? `${text} If you need help, please reach our team at ${reach}.`
    : text.replace("Please contact our team directly", `Please contact our team at ${reach}`)
      .replace("Please let our team know how we can make your next visit better.", `Please reach our team at ${reach} so we can understand how to improve.`)) : choices;
  return prepared.find((text) => !checkGeneratedReplyGuardrails(text, input.contact).length && !neverSayViolations(text, input.neverSay).length) ?? null;
}
