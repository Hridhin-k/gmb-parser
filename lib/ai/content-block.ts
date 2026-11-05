function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reason(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined;
}

/** Keep provider rejection diagnostics without copying its text, prompt, or raw response. */
export function contentBlock(input: {
  provider: string;
  finishReason?: string;
  rawFinishReason?: string;
  providerMetadata?: unknown;
  responseBody?: unknown;
}) {
  if (input.finishReason !== "content-filter") return null;
  let body = input.responseBody;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = undefined; }
  }
  const response = record(body);
  const google = input.provider === "google" ? record(record(input.providerMetadata).google) : {};
  const feedback = record(google.promptFeedback ?? response.promptFeedback);
  const candidate = Array.isArray(response.candidates) ? record(response.candidates[0]) : {};
  const raw = reason(input.rawFinishReason) ?? reason(candidate.finishReason) ?? reason(feedback.blockReason);
  const feedbackReason = reason(feedback.blockReason);
  const blockReason = feedbackReason === "BLOCK_REASON_UNSPECIFIED" ? undefined : feedbackReason;
  const ratings = google.safetyRatings ?? candidate.safetyRatings ?? feedback.safetyRatings;
  const safetyRatings = Array.isArray(ratings) ? ratings.map((item) => {
    const rating = record(item);
    return { category: reason(rating.category), probability: reason(rating.probability),
      ...(typeof rating.blocked === "boolean" ? { blocked: rating.blocked } : {}) };
  }).filter((rating) => rating.category) : [];
  const recitation = input.provider === "google" && raw === "RECITATION";
  return {
    code: recitation ? "AI_RECITATION_BLOCKED" : "AI_SAFETY_BLOCKED",
    message: recitation
      ? "The AI provider stopped this draft because it detected possible copied wording. Use a template or write a reply manually."
      : "The AI provider blocked this draft due to content restrictions. Use a template or write a reply manually.",
    diagnostics: { rawFinishReason: raw, providerBlockReason: blockReason, blockStage: blockReason ? "prompt" : "output", safetyRatings },
  };
}
