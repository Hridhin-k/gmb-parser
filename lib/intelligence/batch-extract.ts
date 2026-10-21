import { taxonomyBlock } from "@/lib/intelligence/extract-prompt";

export interface BatchReviewInput {
  id: string;
  comment: string;
  starRating: number;
  language: string;
}

/**
 * Reviews per Gemini call. 3.8 Flash thinks before it answers, and those
 * tokens share the output budget, so a larger chunk truncates the JSON.
 */
export const BATCH_SIZE = 10;

/**
 * One prompt for many reviews. The taxonomy is stated once per batch instead
 * of once per review, which is most of the per-review token cost.
 */
export function batchExtractionPrompt(reviews: readonly BatchReviewInput[]): string {
  const items = reviews
    .map(
      (review, index) =>
        `Review ${index}: stars=${review.starRating} language=${review.language}\n"""\n${review.comment.slice(0, 1000)}\n"""`
    )
    .join("\n\n");
  return `You extract structured facts from store reviews. Return JSON only.

Allowed topic codes:
${taxonomyBlock()}

Return one result per review, using the same index:
{ "results": [ { "index": 0, "aspects": [ { "topicCode": "one allowed code", "polarity": "praise" | "complaint" | "neutral", "phrase": "the aspect in the customer's own words, 2-6 words, e.g. kidswear selection limited", "excerpt": "an exact substring of that review", "confidence": 0.0, "uncertain": false } ], "staff": ["staff member names exactly as written in the review, e.g. Neenu"], "requests": ["a customer request or wish copied verbatim from the review"], "severity": "none" | "low" | "moderate" | "high", "urgency": "none" | "soon" | "immediate", "escalation": [], "entities": [], "actionable": [], "uncertain": false, "note": null } ] }

Rules:
- Every excerpt must be copied verbatim from its own review. Do not move text between reviews.
- Do not invent a theme the text does not support. Omit the aspect instead.
- Complaint or praise must be true of that same excerpt. Do not take it from the star rating or from a different sentence.
- Do not treat the star rating as a topic.
- price is a complaint only when the customer says the price, rate, or cost is high, expensive, or not worth it. Stating the amount paid is not a price complaint.
- The phrase names the specific subject behind the topic code: prefer "sizes missing in mens tees" over "product availability".
- staff lists only people the review names as staff (praised or blamed). Never invent a name.
- requests copies the customer's own wording for anything they ask for, wish for, or want more of. Omit when there is none.
- Do not include phone numbers or email addresses.
- A dirty trial room or fitting room is both fitting_room and cleanliness.

${items}`;
}

/**
 * Splits a batched payload back into per-review model payloads, as JSON text
 * for validateModelExtraction. Reviews the model skipped or answered with a
 * malformed entry are absent from the map and stay failed for a later retry.
 */
export function parseBatchResults(text: string, count: number): Map<number, string> {
  const out = new Map<number, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  const results = (parsed as { results?: unknown })?.results;
  if (!Array.isArray(results)) return out;
  for (let position = 0; position < results.length; position += 1) {
    const item = results[position] as { index?: unknown } | null;
    if (!item || typeof item !== "object") continue;
    // An entry without an explicit index cannot be trusted to belong to any
    // particular review, so it is dropped rather than guessed positionally.
    const index = typeof item.index === "number" ? item.index : -1;
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    out.set(index, JSON.stringify(item));
  }
  return out;
}
