import { LEAF_TOPIC_CODES, TAXONOMY_V2 } from "@/lib/intelligence/taxonomy";

/** Allowed leaf codes with descriptions, shared by single and batched prompts. */
export function taxonomyBlock(): string {
  return TAXONOMY_V2.filter((node) => LEAF_TOPIC_CODES.includes(node.code))
    .map((node) => {
      const aliases = node.aliases.length > 0 ? ` Also called: ${node.aliases.join(", ")}.` : "";
      return `${node.code}: ${node.description}${aliases}`;
    })
    .join("\n");
}

/** One review per request. Reviewer name, profile, and location title are not included. */
export function extractionPrompt(input: { comment: string; starRating: number; language: string }): string {
  const codes = taxonomyBlock();
  return `You extract structured facts from one store review. Return JSON only.

Review language code: ${input.language}
Star rating: ${input.starRating}
Review text:
"""
${input.comment}
"""

Allowed topic codes:
${codes}

JSON shape:
{
  "aspects": [
    {
      "topicCode": "one allowed code",
      "polarity": "praise" | "complaint" | "neutral",
      "phrase": "the aspect in the customer's own words, 2-6 words, e.g. kidswear selection limited",
      "excerpt": "an exact substring of the review text",
      "confidence": 0.0,
      "uncertain": false
    }
  ],
  "staff": ["staff member names exactly as written in the review"],
  "requests": ["a customer request or wish copied verbatim from the review"],
  "severity": "none" | "low" | "moderate" | "high",
  "urgency": "none" | "soon" | "immediate",
  "escalation": [{ "code": "safety" | "refund_or_billing" | "abuse" | "legal" | "unresolved", "excerpt": "exact substring" }],
  "entities": [{ "kind": "product" | "service" | "facility" | "staff_role" | "area", "label": "short role or place, not a person's name", "excerpt": "exact substring" }],
  "actionable": [{ "topicCode": "one allowed code", "excerpt": "exact substring" }],
  "uncertain": false,
  "note": "optional caution, max 240 characters"
}

Rules:
- A review may contain several aspects. Do not collapse them into one topic.
- Every excerpt must be copied verbatim from the review text. Do not paraphrase.
- Do not invent a theme the text does not support. If the wording is sarcastic or ambiguous, set uncertain true and use polarity neutral or omit the aspect.
- Complaint or praise must be true of that same excerpt. Do not take it from the star rating or from a different sentence.
- Do not treat the star rating as a topic. Stars are supplied separately.
- price is a complaint only when the customer says the price, rate, or cost is high, expensive, or not worth it. Stating the amount paid is not a price complaint.
- staff lists only people the review names as staff (praised or blamed). Never invent a name. requests copies the customer's own wording for anything they ask for or wish for; omit when there is none.
- Do not include phone numbers, email addresses, or health details.
- Severity high means safety, money loss, or the customer cannot use the service. Urgency immediate means they are waiting now or a safety issue is happening now.
- Use other only when the text supports a point and no other code fits, and still quote it.
- A dirty, unhygienic, or poorly cleaned trial room, fitting room, or changing area is both fitting_room and cleanliness. Quote each part.`;
}
