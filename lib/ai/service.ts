import { APICallError, NoObjectGeneratedError, Output, generateText, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createAdminClient } from "@/lib/db/client";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { resolveAiPrice, type AiOperation } from "@/lib/ai-usage";
import { logger } from "@/lib/logger";
import { AuditService } from "@/lib/services/audit";
import { auditErrorDetails } from "@/lib/audit-details";
import { assertAiCredentials, resolveAiFallback, resolveAiRoute, routeId, type AiRoute, type AiTask } from "./config";
import { languageModel, providerOptions } from "./registry";
import { contentBlock } from "./content-block";

export class AiError extends AppError {
  constructor(message: string, code: string, public readonly retryable = false, status = 502, metadata?: Record<string, unknown>) { super(message, code, status, metadata); }
}

function safeError(error: unknown, provider: string): AiError | AppError {
  if (error instanceof AppError) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === "length") return new AiError("The AI response was cut off before it finished. Please try again.", "AI_INVALID_RESPONSE");
    const block = contentBlock({ provider, finishReason: error.finishReason, responseBody: error.response?.body });
    if (block) return new AiError(block.message, block.code, false, 422, block.diagnostics);
    return new AiError("AI returned an invalid structured response. Please try again.", "AI_INVALID_RESPONSE");
  }
  if (APICallError.isInstance(error)) {
    const billing = `${error.responseBody ?? ""} ${error.message}`;
    if (error.statusCode === 402 || /insufficient_quota|billing_hard_limit|credit[_ ]balance|out of credits|insufficient credits|billing.*(?:disabled|exhausted)|quota.*limit[^\d]*0\b/i.test(billing)) {
      return new AiError("AI credits are exhausted. Add credits, then resume processing. Saved reviews and completed analysis are kept.", "AI_CREDITS_EXHAUSTED", false, 402);
    }
    if (error.statusCode === 429) return new AiError("AI generation quota exceeded. Please try again later.", "AI_QUOTA", true);
    if ([500, 502, 503, 504].includes(error.statusCode ?? 0)) return new AiError("AI service is temporarily unavailable. Please try again shortly.", "AI_UNAVAILABLE", true);
    if ([401, 403, 404].includes(error.statusCode ?? 0)) return new AiError("The AI credentials or model configuration is invalid.", "CONFIG_ERROR");
    return new AiError("The AI request was invalid. Check the selected model configuration.", "AI_INVALID_RESPONSE");
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return new AiError("AI generation timed out. Please try again.", "AI_TIMEOUT", false, 504);
  // Unknown network outcomes may already have been billed. Never auto-fallback.
  return new AiError("The AI result could not be confirmed. Progress is saved. Check the provider before resuming this request.", "AI_OUTCOME_UNKNOWN");
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

export interface AiAuditContext {
  userId?: string | null;
  reviewId?: string;
  locationId?: string | null;
  clientId?: string | null;
  runId?: string;
  reportId?: string;
  reviewIds?: string[];
  aiConfigVersion?: number;
}

interface GenerateInput {
  workspaceId: string; task: AiTask; operation: AiOperation; prompt: string;
  maxOutputTokens: number; timeoutMs: number; temperature?: number;
  schema?: z.ZodType; fast?: boolean;
  audit?: AiAuditContext;
}

function providerFailureDetails(error: unknown): Record<string, unknown> {
  if (!APICallError.isInstance(error)) return {};
  let providerErrorCode: string | undefined;
  let providerErrorType: string | undefined;
  try {
    const detail = JSON.parse(error.responseBody ?? "{}").error;
    // Provider messages/bodies can echo input. Keep only bounded machine identifiers.
    const identifier = (value: unknown) => typeof value === "string" && /^[\w.-]{1,100}$/.test(value) ? value : undefined;
    providerErrorCode = identifier(detail?.code);
    providerErrorType = identifier(detail?.type ?? detail?.status);
  } catch { /* The safe application error still explains the failure. */ }
  return {
    providerStatus: error.statusCode, providerErrorCode, providerErrorType,
    providerRequestId: error.responseHeaders?.["x-request-id"] ?? error.responseHeaders?.["request-id"] ?? error.responseHeaders?.["x-goog-request-id"],
  };
}

/** All paid calls pass through here, including previews and report synthesis. */
export async function generateAi(input: GenerateInput) {
  const admin = createAdminClient();
  const requestId = crypto.randomUUID();
  const { userId, ...context } = input.audit ?? {};
  async function audit(action: "ai.request_failed" | "ai.request_completed", detail: Record<string, unknown>) {
    await AuditService.log({
      workspaceId: input.workspaceId, userId, action,
      entityType: context.reviewId ? "grm_reviews" : context.runId ? "grm_analysis_runs" : context.reportId ? "grm_insight_reports" : "ai_request",
      entityId: context.reviewId ?? context.runId ?? context.reportId ?? requestId,
      metadata: { ...context, requestId, task: input.task, operation: input.operation, timeoutMs: input.timeoutMs, maxOutputTokens: input.maxOutputTokens, ...detail },
    });
  }
  let primary: AiRoute;
  let fallback: AiRoute | undefined;
  try {
    primary = resolveAiRoute(input.task, input.fast);
    fallback = resolveAiFallback();
    for (const route of [primary, ...(fallback ? [fallback] : [])]) {
      assertAiCredentials(route);
      resolveAiPrice(routeId(route)); // Unknown pricing must not silently become $0.
    }
  } catch (error) {
    await audit("ai.request_failed", { ...auditErrorDetails(error), stage: "configuration", retryable: false, providerCalled: false });
    throw error;
  }

  async function call(route: AiRoute, attempt: number) {
    const started = Date.now();
    let recorded = false;
    let providerCalled = false;
    let stage = "budget";
    let finishReason: string | undefined;
    let rawFinishReason: string | undefined;
    let providerRequestId: string | undefined;
    let providerResponseId: string | undefined;
    let usage = normalizeUsage(undefined);
    async function record(usageValue: LanguageModelUsage | undefined, status: string) {
      if (recorded) return;
      recorded = true;
      usage = normalizeUsage(usageValue);
      await recordAiUsage(admin, {
        workspaceId: input.workspaceId, operation: input.operation,
        model: routeId(route), ...usage, status,
      });
    }
    try {
      const budget = await getAiBudget(admin, input.workspaceId);
      if (budget.exceeded) throw new AiError("This workspace has reached its monthly AI budget.", "AI_BUDGET_EXCEEDED", false, 429);
      stage = "provider_request";
      providerCalled = true;
      const result = await generateText({
        model: languageModel(route), prompt: input.prompt,
        maxOutputTokens: input.maxOutputTokens,
        // Reasoning models differ in temperature support. Keep native OpenAI defaults.
        ...(route.provider === "google" && input.temperature !== undefined ? { temperature: input.temperature } : {}),
        providerOptions: providerOptions(route),
        output: input.schema ? Output.object({ schema: input.schema }) : Output.text(),
        abortSignal: AbortSignal.timeout(input.timeoutMs), maxRetries: 0,
      });
      stage = "validate_output";
      finishReason = result.finishReason;
      rawFinishReason = result.rawFinishReason;
      providerRequestId = result.response.headers?.["x-request-id"] ?? result.response.headers?.["x-goog-request-id"];
      providerResponseId = result.response.id;
      await record(result.totalUsage, result.finishReason);
      if (result.finishReason === "length") throw new AiError("The AI response was cut off before it finished. Please try again.", "AI_INVALID_RESPONSE");
      const block = contentBlock({ provider: route.provider, finishReason, rawFinishReason, providerMetadata: result.providerMetadata });
      if (block) throw new AiError(block.message, block.code, false, 422, block.diagnostics);
      const text = input.schema ? JSON.stringify(result.output) : result.text;
      if (!text?.trim()) throw new AiError("AI returned an empty or unusable response. Please try again.", "AI_INVALID_RESPONSE");
      if (result.finishReason !== "stop") throw new AiError("AI did not complete its response. Please try again.", "AI_INVALID_RESPONSE");
      await audit("ai.request_completed", { provider: route.provider, model: routeId(route), providerRequestId, providerResponseId, attempt, fallback: attempt > 1, durationMs: Date.now() - started, finishReason, rawFinishReason, ...usage });
      return {
        text, model: routeId(route), usage, requestId,
        generationParams: { provider: route.provider, model: route.model, maxOutputTokens: input.maxOutputTokens, providerOptions: providerOptions(route) },
      };
    } catch (error) {
      if (!recorded && providerCalled) await record(NoObjectGeneratedError.isInstance(error) ? error.usage : undefined, "failed");
      const safe = safeError(error, route.provider);
      await audit("ai.request_failed", {
        ...auditErrorDetails(safe), ...providerFailureDetails(error), provider: route.provider, model: routeId(route),
        attempt, fallback: attempt > 1, stage, providerCalled, durationMs: Date.now() - started,
        retryable: safe instanceof AiError && safe.retryable,
        willFallback: attempt === 1 && Boolean(fallback && routeId(fallback) !== routeId(primary) && safe instanceof AiError && safe.retryable),
        finishReason: finishReason ?? (NoObjectGeneratedError.isInstance(error) ? error.finishReason : undefined), rawFinishReason,
        ...(safe.metadata?.blockStage ? safe.metadata : {}),
        ...(providerRequestId ? { providerRequestId } : {}), ...(providerResponseId ? { providerResponseId } : {}), ...usage,
      });
      logger.warn("ai.call_failed", { requestId, workspaceId: input.workspaceId, operation: input.operation, provider: route.provider, model: route.model, errorCode: safe.code, durationMs: Date.now() - started });
      throw safe;
    }
  }

  try { return await call(primary, 1); } catch (error) {
    if (!fallback || routeId(fallback) === routeId(primary) || !(error instanceof AiError) || !error.retryable) throw error;
    return call(fallback, 2);
  }
}
