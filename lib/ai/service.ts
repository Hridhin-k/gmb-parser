import { APICallError, NoObjectGeneratedError, Output, generateText, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/db/client";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { resolveAiPrice, type AiOperation } from "@/lib/ai-usage";
import { logger } from "@/lib/logger";
import { assertAiCredentials, resolveAiFallback, resolveAiRoute, routeId, type AiRoute, type AiTask } from "./config";
import { languageModel, providerOptions } from "./registry";

export class AiError extends AppError {
  constructor(message: string, code: string, public readonly retryable = false, status = 502) { super(message, code, status); }
}

function safeError(error: unknown): AiError | AppError {
  if (error instanceof AppError) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "length") return new AiError("The AI response was cut off before it finished. Please try again.", "AI_INVALID_RESPONSE");
    if (error.finishReason === "content-filter") return new AiError("AI generation was blocked due to content restrictions.", "AI_SAFETY_BLOCKED");
    return new AiError("AI returned an invalid structured response. Please try again.", "AI_INVALID_RESPONSE");
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 429) return new AiError("AI generation quota exceeded. Please try again later.", "AI_QUOTA", true);
    if ([500, 502, 503, 504].includes(error.statusCode ?? 0)) return new AiError("AI service is temporarily unavailable. Please try again shortly.", "AI_UNAVAILABLE", true);
    if ([401, 403, 404].includes(error.statusCode ?? 0)) return new AiError("The AI credentials or model configuration is invalid.", "CONFIG_ERROR");
    return new AiError("The AI request was invalid. Check the selected model configuration.", "AI_INVALID_RESPONSE");
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return new AiError("AI generation timed out. Please try again.", "AI_TIMEOUT", false, 504);
  // Unknown network outcomes may already have been billed. Never auto-fallback.
  return new AiError("Failed to reach AI service. Please try again.", "AI_UNAVAILABLE");
}

export function normalizeUsage(usage: LanguageModelUsage | undefined) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0, // Includes reasoning: do not add it again.
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    usageKnown: usage?.inputTokens !== undefined && usage?.outputTokens !== undefined,
  };
}

interface GenerateInput {
  workspaceId: string; task: AiTask; operation: AiOperation; prompt: string;
  maxOutputTokens: number; timeoutMs: number; temperature?: number;
  schema?: z.ZodType; fast?: boolean;
}

/** All paid calls pass through here, including previews and report synthesis. */
export async function generateAi(input: GenerateInput) {
  const admin = createAdminClient();
  const primary = resolveAiRoute(input.task, input.fast);
  const fallback = resolveAiFallback();
  for (const route of [primary, ...(fallback ? [fallback] : [])]) {
    assertAiCredentials(route);
    resolveAiPrice(routeId(route)); // Unknown pricing must not silently become $0.
  }

  async function call(route: AiRoute) {
    const budget = await getAiBudget(admin, input.workspaceId);
    if (budget.exceeded) throw new AiError("This workspace has reached its monthly AI budget.", "AI_BUDGET_EXCEEDED", false, 429);
    const started = Date.now();
    let recorded = false;
    async function record(usage: LanguageModelUsage | undefined, status: string) {
      if (recorded) return;
      recorded = true;
      await recordAiUsage(admin, {
        workspaceId: input.workspaceId, operation: input.operation,
        model: routeId(route), ...normalizeUsage(usage), status,
      });
    }
    try {
      const result = await generateText({
        model: languageModel(route), prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
        // Reasoning models differ in temperature support. Keep native OpenAI defaults.
        ...(route.provider === "google" && input.temperature !== undefined ? { temperature: input.temperature } : {}),
        providerOptions: providerOptions(route),
        output: input.schema ? Output.object({ schema: input.schema }) : Output.text(),
        abortSignal: AbortSignal.timeout(input.timeoutMs), maxRetries: 0,
      });
      await record(result.totalUsage, result.finishReason);
      if (result.finishReason === "length") throw new AiError("The AI response was cut off before it finished. Please try again.", "AI_INVALID_RESPONSE");
      if (result.finishReason === "content-filter") throw new AiError("AI generation was blocked due to content restrictions.", "AI_SAFETY_BLOCKED");
      const text = input.schema ? JSON.stringify(result.output) : result.text;
      if (!text?.trim()) throw new AiError("AI returned an empty or unusable response. Please try again.", "AI_INVALID_RESPONSE");
      if (result.finishReason !== "stop") throw new AiError("AI did not complete its response. Please try again.", "AI_INVALID_RESPONSE");
      return {
        text, model: routeId(route), usage: normalizeUsage(result.totalUsage),
        generationParams: { provider: route.provider, model: route.model, maxOutputTokens: input.maxOutputTokens, providerOptions: providerOptions(route) },
      };
    } catch (error) {
      if (!recorded) await record(NoObjectGeneratedError.isInstance(error) ? error.usage : undefined, "failed");
      const safe = safeError(error);
      logger.warn("ai.call_failed", { workspaceId: input.workspaceId, operation: input.operation, provider: route.provider, model: route.model, errorCode: safe.code, durationMs: Date.now() - started });
      throw safe;
    }
  }

  try { return await call(primary); } catch (error) {
    if (!fallback || routeId(fallback) === routeId(primary) || !(error instanceof AiError) || !error.retryable) throw error;
    return call(fallback);
  }
}
