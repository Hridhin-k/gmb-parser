import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { APICallError } from "ai";
import { z } from "zod";
import { generateAi } from "@/lib/ai/service";
import { languageModel } from "@/lib/ai/registry";
import { getAiBudget, recordAiUsage } from "@/lib/services/ai-usage-ledger";
import { AuditService } from "@/lib/services/audit";

vi.mock("@/lib/ai/registry", async (original) => ({ ...await original<typeof import("@/lib/ai/registry")>(), languageModel: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/services/ai-usage-ledger", () => ({ getAiBudget: vi.fn(), recordAiUsage: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/audit", () => ({ AuditService: { log: vi.fn(async () => undefined) } }));

const input = { workspaceId: "ws", task: "reply" as const, operation: "reply_draft" as const, prompt: "Reply", maxOutputTokens: 1000, timeoutMs: 1000 };
function model(text = "Thank you!", finish: "stop" | "length" | "content-filter" = "stop") {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text }], finishReason: { unified: finish, raw: finish }, warnings: [],
    usage: { inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 50, text: 30, reasoning: 20 } },
  } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL", "gpt-6-luna"); vi.stubEnv("OPENAI_API_KEY", "test");
  vi.mocked(getAiBudget).mockResolvedValue({ spentUsd: 0, budgetUsd: 6, exceeded: false, tracked: true });
  vi.mocked(languageModel).mockReturnValue(model());
});
afterEach(() => vi.unstubAllEnvs());

describe("shared AI service through the real AI SDK", () => {
  it("returns provider-qualified provenance and does not double-count reasoning", async () => {
    const result = await generateAi(input);
    expect(result.model).toBe("openai:gpt-6-luna");
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, reasoningTokens: 20, cachedInputTokens: 20 });
    expect(recordAiUsage).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ model: result.model, outputTokens: 50, operation: "reply_draft" }));
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.request_completed",
      metadata: expect.objectContaining({ requestId: result.requestId, inputTokens: 100, outputTokens: 50, finishReason: "stop", attempt: 1 }) }));
  });
  it("requests structured output and preserves per-task accounting", async () => {
    const m = model('{"ok":true}'); vi.mocked(languageModel).mockReturnValue(m);
    const result = await generateAi({ ...input, task: "insight", operation: "insight_prose", schema: z.object({ ok: z.boolean() }) });
    expect(JSON.parse(result.text)).toEqual({ ok: true });
    expect(m.doGenerateCalls[0].responseFormat?.type).toBe("json");
    expect(recordAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: "insight_prose" }));
  });
  it("records usage for invalid JSON without paying for a repair automatically", async () => {
    const m = model('{"ok":"wrong"}'); vi.mocked(languageModel).mockReturnValue(m);
    await expect(generateAi({ ...input, schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(m.doGenerateCalls).toHaveLength(1);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAiUsage).mock.calls[0][1].outputTokens).toBe(50);
  });
  it.each(["length", "content-filter"] as const)("accounts for %s output and refuses to publish it", async (reason) => {
    vi.mocked(languageModel).mockReturnValue(model("partial answer", reason));
    await expect(generateAi(input)).rejects.toMatchObject({ code: reason === "length" ? "AI_INVALID_RESPONSE" : "AI_SAFETY_BLOCKED" });
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.request_failed",
      metadata: expect.objectContaining({ finishReason: reason, stage: "validate_output", retryable: false, model: "openai:gpt-6-luna" }) }));
  });
  it("blocks all tasks after the workspace budget is exhausted", async () => {
    vi.mocked(getAiBudget).mockResolvedValue({ spentUsd: 6, budgetUsd: 6, exceeded: true, tracked: true });
    await expect(generateAi(input)).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED" });
    expect(languageModel).not.toHaveBeenCalled(); expect(recordAiUsage).not.toHaveBeenCalled();
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.request_failed",
      metadata: expect.objectContaining({ stage: "budget", providerCalled: false, errorCode: "AI_BUDGET_EXCEEDED" }) }));
  });
  it("does not retry transient provider failures when fallback is disabled", async () => {
    const call = vi.fn(async () => { throw new APICallError({ message: "down", url: "https://example.test", requestBodyValues: {}, statusCode: 503 }); });
    vi.mocked(languageModel).mockReturnValue(new MockLanguageModelV4({ doGenerate: call }));
    await expect(generateAi(input)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it.each([402, 429])("pauses on exhausted provider credits (%s) without a paid fallback", async (statusCode) => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "google"); vi.stubEnv("AI_FALLBACK_MODEL", "gemini-3.8-flash"); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test");
    const call = vi.fn(async () => { throw new APICallError({ message: "Provider quota exhausted", url: "https://example.test", requestBodyValues: {}, statusCode,
      responseBody: JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota" } }) }); });
    vi.mocked(languageModel).mockReturnValue(new MockLanguageModelV4({ doGenerate: call }));
    await expect(generateAi(input)).rejects.toMatchObject({ code: "AI_CREDITS_EXHAUSTED", retryable: false });
    expect(call).toHaveBeenCalledTimes(1);
    expect(languageModel).toHaveBeenCalledTimes(1);
  });
  it("keeps ordinary provider throttling retryable", async () => {
    vi.mocked(languageModel).mockReturnValue(new MockLanguageModelV4({ doGenerate: async () => {
      throw new APICallError({ message: "Too many requests", url: "https://example.test", requestBodyValues: {}, statusCode: 429,
        responseBody: JSON.stringify({ error: { code: "rate_limit_exceeded" } }) });
    } }));
    await expect(generateAi(input)).rejects.toMatchObject({ code: "AI_QUOTA", retryable: true });
  });
  it("uses only an explicitly configured fallback and accounts for both attempts", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "google"); vi.stubEnv("AI_FALLBACK_MODEL", "gemini-3.8-flash"); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test");
    const primary = new MockLanguageModelV4({ doGenerate: async () => { throw new APICallError({ message: "down", url: "https://example.test", requestBodyValues: {}, statusCode: 503 }); } });
    vi.mocked(languageModel).mockReturnValueOnce(primary).mockReturnValueOnce(model());
    expect((await generateAi(input)).model).toBe("google:gemini-3.8-flash");
    expect(recordAiUsage).toHaveBeenCalledTimes(2); expect(getAiBudget).toHaveBeenCalledTimes(2);
    const entries = vi.mocked(AuditService.log).mock.calls.map(([entry]) => entry);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ action: "ai.request_failed", metadata: { attempt: 1, willFallback: true, providerStatus: 503 } });
    expect(entries[1]).toMatchObject({ action: "ai.request_completed", metadata: { attempt: 2, fallback: true } });
    expect(entries[0].metadata?.requestId).toBe(entries[1].metadata?.requestId);
  });
  it("never falls back after an unknown network outcome", async () => {
    vi.stubEnv("AI_FALLBACK_PROVIDER", "google"); vi.stubEnv("AI_FALLBACK_MODEL", "gemini-3.8-flash"); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test");
    vi.mocked(languageModel).mockReturnValue(new MockLanguageModelV4({ doGenerate: async () => { throw new Error("connection lost"); } }));
    await expect(generateAi(input)).rejects.toMatchObject({ retryable: false });
    expect(languageModel).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ usageKnown: false }));
  });
  it("rejects unknown model prices before the provider is invoked", async () => {
    vi.stubEnv("AI_MODEL", "unpriced");
    await expect(generateAi(input)).rejects.toThrow("AI_PRICES_JSON"); expect(languageModel).not.toHaveBeenCalled();
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.request_failed",
      metadata: expect.objectContaining({ stage: "configuration", providerCalled: false }) }));
  });

  it("records safe provider codes and request IDs with the affected review, without raw provider input", async () => {
    vi.mocked(languageModel).mockReturnValue(new MockLanguageModelV4({ doGenerate: async () => {
      throw new APICallError({ message: "raw private review", url: "https://example.test?key=private", requestBodyValues: { prompt: "private prompt" }, statusCode: 429,
        responseHeaders: { "x-request-id": "provider-request-a" }, responseBody: JSON.stringify({ error: { code: "rate_limit_exceeded", message: "private body" } }) });
    } }));
    await expect(generateAi({ ...input, audit: { userId: "user-a", reviewId: "review-a", locationId: "location-a" } })).rejects.toMatchObject({ code: "AI_QUOTA" });
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", entityType: "grm_reviews", entityId: "review-a",
      metadata: expect.objectContaining({ reviewId: "review-a", locationId: "location-a", providerStatus: 429, providerRequestId: "provider-request-a", providerErrorCode: "rate_limit_exceeded", retryable: true }) }));
    const saved = JSON.stringify(vi.mocked(AuditService.log).mock.calls);
    expect(saved).not.toContain("private");
  });
});
