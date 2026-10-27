import { afterEach, describe, expect, it, vi } from "vitest";
import { languageModel, providerOptions } from "@/lib/ai/registry";
import { resolveAiPrice } from "@/lib/ai-usage";
import { generateText, Output } from "ai";
import { z } from "zod";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("direct SDK provider registry", () => {
  it("uses the native OpenAI Responses provider without requiring a Google key or gateway", () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const result = languageModel({ provider: "openai", model: "gpt-6-luna" });
    expect(result.provider).toBe("openai.responses"); expect(result.modelId).toBe("gpt-6-luna");
  });
  it("uses Google directly with its own credentials", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test");
    expect(languageModel({ provider: "google", model: "gemini-3.8-flash" }).provider).toBe("google.generative-ai");
  });
  it("sends a structured Luna request directly to the OpenAI Responses API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      id: "resp_test", object: "response", created_at: 0, status: "completed", model: "gpt-6-luna",
      output: [{ id: "msg_test", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } },
    }), { headers: { "content-type": "application/json" } }));
    const route = { provider: "openai" as const, model: "gpt-6-luna" };
    const result = await generateText({ model: languageModel(route), prompt: "Extract", output: Output.object({ schema: z.object({ ok: z.boolean() }) }), providerOptions: providerOptions(route), maxRetries: 0 });
    expect(result.output).toEqual({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: "gpt-6-luna", store: false, reasoning: { effort: "low" }, text: { format: { type: "json_schema" } } });
    expect(result.totalUsage.outputTokens).toBe(20);
  });
  it("keeps Gemini thinking settings out of the OpenAI request", () => {
    expect(providerOptions({ provider: "openai", model: "gpt-6-luna" })).toEqual({ openai: { store: false, reasoningEffort: "low" } });
    expect(providerOptions({ provider: "google", model: "gemini-3.5-flash-lite" })).toMatchObject({ google: { thinkingConfig: { thinkingLevel: "minimal" } } });
  });
  it("accepts explicit prices for a new model and rejects invalid prices", () => {
    vi.stubEnv("AI_PRICES_JSON", '{"openai:new":{"input":0.2,"output":1}}');
    expect(resolveAiPrice("openai:new")).toEqual({ input: 0.2, output: 1 });
    vi.stubEnv("AI_PRICES_JSON", '{"openai:new":{"input":-1,"output":1}}');
    expect(() => resolveAiPrice("openai:new")).toThrow("AI_PRICES_JSON");
  });
});
