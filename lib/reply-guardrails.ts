export type GuardrailCode =
  | "compensation"
  | "medical"
  | "legal"
  | "personal_contact";

export interface GuardrailViolation {
  code: GuardrailCode;
  message: string;
}

const RULES: Array<{ code: GuardrailCode; pattern: RegExp; message: string }> = [
  {
    code: "compensation",
    pattern:
      /\b(refund|discount|coupon|voucher|gift\s*card|compensate|compensation|money\s*back|complimentary|on\s+the\s+house|%\s*off|percent\s+off)\b/i,
    message: "A public reply cannot promise a refund, discount, or other compensation.",
  },
  {
    code: "medical",
    pattern: /\b(diagnos\w*|prescription|medical\s+advice|cure\s+your|guaranteed\s+to\s+heal)\b/i,
    message: "A public reply cannot make a medical claim.",
  },
  {
    code: "legal",
    pattern:
      /\b(legal\s+advice|accept(?:ing)?\s+liability|admit(?:ting)?\s+liability|you\s+should\s+sue|our\s+lawyer|our\s+attorney)\b/i,
    message: "A public reply cannot make a legal claim or admit liability.",
  },
  {
    code: "personal_contact",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{8,}\d/i,
    message: "A public reply cannot include an email address or phone number.",
  },
];

/** Blocks text that must not be posted publicly. This is not a quality score and cannot approve a reply. */
export function checkReplyGuardrails(content: string): GuardrailViolation[] {
  const text = content.trim();
  if (!text) return [];
  const found: GuardrailViolation[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(text)) found.push({ code: rule.code, message: rule.message });
  }
  return found;
}

/** 1–3 star reviews stay in draft until an owner or admin approves them. */
export function negativeReviewNeedsApproval(starRating: number): boolean {
  return starRating <= 3;
}
