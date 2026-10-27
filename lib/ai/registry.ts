import { createProviderRegistry, type generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { assertAiCredentials, routeId, type AiRoute } from "./config";

/** Explicit direct providers: no Vercel gateway, account or hosting required. */
export function languageModel(route: AiRoute) {
  assertAiCredentials(route);
  const registry = createProviderRegistry({
    openai: createOpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() }),
    google: createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() }),
  });
  return registry.languageModel(routeId(route) as `openai:${string}` | `google:${string}`);
}

export function providerOptions(route: AiRoute): NonNullable<Parameters<typeof generateText>[0]["providerOptions"]> {
  if (route.provider === "openai") {
    return { openai: { store: false, ...(route.model === "gpt-6-luna" ? { reasoningEffort: "low" } : {}) } };
  }
  // Known Gemini 3 configurations. Do not guess options for arbitrary models.
  if (/^gemini-3\./.test(route.model)) {
    return { google: { thinkingConfig: { thinkingLevel: route.model.includes("lite") ? "minimal" : "low" } } };
  }
  return {};
}
