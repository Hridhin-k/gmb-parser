import { describe, expect, it } from "vitest";
import { assertAiCredentials, resolveAiFallback, resolveAiRoute } from "@/lib/ai/config";

describe("AI environment routing", () => {
  const base = { AI_PROVIDER: "openai", AI_MODEL: "gpt-6-luna" };
  it("requires explicit routing and does not infer Gemini from an old key", () => {
    expect(() => resolveAiRoute("reply", false, { GEMINI_API_KEY: "old" })).toThrow("AI_PROVIDER");
  });
  it("routes every task and positive replies through the selected default", () => {
    for (const task of ["reply", "extract", "insight"] as const) expect(resolveAiRoute(task, true, base)).toEqual({ provider: "openai", model: "gpt-6-luna" });
  });
  it("supports independent task providers and an explicit fast reply profile", () => {
    const env = { ...base, AI_EXTRACT_PROVIDER: "google", AI_EXTRACT_MODEL: "custom-google-model", AI_REPLY_FAST_PROVIDER: "openai", AI_REPLY_FAST_MODEL: "custom-fast" };
    expect(resolveAiRoute("extract", false, env).provider).toBe("google");
    expect(resolveAiRoute("reply", true, env).model).toBe("custom-fast");
    expect(resolveAiRoute("reply", false, env).model).toBe("gpt-6-luna");
  });
  it("rejects incomplete or unsupported provider/model pairs", () => {
    expect(() => resolveAiRoute("reply", false, { AI_PROVIDER: "openai" })).toThrow("together");
    expect(() => resolveAiRoute("extract", false, { ...base, AI_EXTRACT_MODEL: "other" })).toThrow("together");
    expect(() => resolveAiRoute("reply", false, { AI_PROVIDER: "unknown", AI_MODEL: "other" })).toThrow("Unsupported");
  });
  it("ignores blank overrides and trims deployment values", () => {
    expect(resolveAiRoute("reply", false, { AI_PROVIDER: " openai ", AI_MODEL: " gpt-6-luna ", AI_REPLY_MODEL: " " }).model).toBe("gpt-6-luna");
  });
  it("requires only the selected provider's credentials", () => {
    expect(() => assertAiCredentials({ provider: "openai", model: "gpt-6-luna" }, { OPENAI_API_KEY: "test" })).not.toThrow();
    expect(() => assertAiCredentials({ provider: "google", model: "custom" }, { OPENAI_API_KEY: "test" })).toThrow("GOOGLE_GENERATIVE_AI_API_KEY");
  });
  it("does not enable fallback implicitly", () => {
    expect(resolveAiFallback(base)).toBeUndefined();
    expect(() => resolveAiFallback({ AI_FALLBACK_PROVIDER: "google" })).toThrow("together");
  });
});
