import { logger } from "@/lib/logger";

/** Replacement for gemini-2.0-flash, which Google shut down on 1 June 2026. */
export const GEMINI_MODEL_ID = "gemini-3.8-flash";

const GENERATE_CONTENT_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

export function geminiGenerateUrl(apiKey: string): string {
  return `${GENERATE_CONTENT_URL}?key=${apiKey}`;
}

/**
 * Hidden thinking tokens count against maxOutputTokens; at the default level
 * they can consume most of a small budget and truncate the visible answer.
 * This model rejects "minimal".
 */
export const GEMINI_THINKING_LOW = { thinkingLevel: "low" } as const;

export interface GeminiCandidateText {
  text: string;
  finishReason: string | null;
}

/** Joins every non-thought text part; reading only parts[0] can drop the answer. */
export function extractGeminiText(data: unknown): GeminiCandidateText {
  const candidate = (data as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: unknown; thought?: boolean }> };
    }>;
  })?.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
    .trim();
  return { text, finishReason: candidate?.finishReason ?? null };
}

export type GeminiErrorType =
  | "config"
  | "quota"
  | "timeout"
  | "invalid_response"
  | "safety_blocked"
  | "unavailable"
  | "unknown";

export function classifyGeminiError(
  status: number | null,
  body: string
): { type: GeminiErrorType; message: string } {
  const text = body.toLowerCase();
  if (status === 429) {
    return { type: "quota", message: "AI generation quota exceeded. Please try again later." };
  }
  if (status === 503 || status === 502) {
    return { type: "unavailable", message: "AI service is temporarily unavailable. Please try again shortly." };
  }
  if (body.includes("SAFETY")) {
    return {
      type: "safety_blocked",
      message: "The AI could not generate a response for this review due to content restrictions.",
    };
  }
  if (
    status === 404 ||
    text.includes("no longer available") ||
    text.includes("not found")
  ) {
    return {
      type: "config",
      message: "The AI model is no longer available. Update GRM to the current Gemini model.",
    };
  }
  if (status !== null && status >= 400 && status < 500) {
    return { type: "invalid_response", message: "AI request was invalid. Please try again." };
  }
  return { type: "unknown", message: "AI generation failed unexpectedly. Please try again." };
}

export function logGeminiFailure(
  action: string,
  status: number,
  body: string,
  extra?: Record<string, unknown>
): void {
  logger.warn(action, {
    status,
    body: body.slice(0, 300),
    ...extra,
  });
}
