import { AppError } from "@/lib/errors";

export type AiProvider = "openai" | "google";
export type AiTask = "extract" | "reply" | "insight";
export interface AiRoute { provider: AiProvider; model: string }
type Env = Record<string, string | undefined>;

const value = (env: Env, name: string) => env[name]?.trim() || undefined;

function pair(env: Env, prefix: string): AiRoute | undefined {
  const provider = value(env, `${prefix}_PROVIDER`);
  const model = value(env, `${prefix}_MODEL`);
  if (!provider && !model) return;
  if (!provider || !model) throw new AppError(`${prefix}_PROVIDER and ${prefix}_MODEL must be configured together.`, "CONFIG_ERROR");
  if (provider !== "openai" && provider !== "google") throw new AppError(`Unsupported ${prefix}_PROVIDER. Use openai or google.`, "CONFIG_ERROR");
  return { provider, model };
}

/** Resolve at request time. No credentials are retained in a route or cache key. */
export function resolveAiRoute(task: AiTask, fast = false, env: Env = process.env): AiRoute {
  const base = pair(env, "AI");
  const override = pair(env, `AI_${task.toUpperCase()}`);
  const fastRoute = pair(env, "AI_REPLY_FAST");
  const route = task === "reply" && fast && fastRoute ? fastRoute : override ?? base;
  if (!route) throw new AppError("Configure AI_PROVIDER and AI_MODEL (or a complete task override).", "CONFIG_ERROR");
  return route;
}

export function resolveAiFallback(env: Env = process.env): AiRoute | undefined {
  return pair(env, "AI_FALLBACK");
}

export function assertAiCredentials(route: AiRoute, env: Env = process.env): void {
  const name = route.provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_GENERATIVE_AI_API_KEY";
  if (!value(env, name)) throw new AppError(`${name} is not configured for the selected AI provider.`, "CONFIG_ERROR");
}

export function aiConfigured(task: AiTask): boolean {
  try { assertAiCredentials(resolveAiRoute(task)); return true; } catch { return false; }
}

export function routeId(route: AiRoute): string { return `${route.provider}:${route.model}`; }

/** Includes task overrides and fallback, without key material. */
export function aiRouteIdentity(task: AiTask): string {
  return JSON.stringify({ primary: resolveAiRoute(task), fallback: resolveAiFallback() ?? null });
}
