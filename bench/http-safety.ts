import { readFileSync } from "node:fs";
import { PRODUCTION_REF, STAGING_REF } from "./safety";

export type HttpSafetyDecision = {
  ok: boolean;
  reason: string;
  baseUrl: string | null;
  projectRef: string | null;
};

export type CookieLoadResult =
  | { ok: true; cookieHeader: string; cookieNames: string[]; valueChars: number }
  | { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** Fail closed unless the app target is loopback (or an explicit staging app host) and cookies name the staging project. */
export function decideHttpTarget(input: {
  baseUrl?: string;
  confirm?: string;
  supabaseUrl?: string;
  allowAppHost?: string;
}): HttpSafetyDecision {
  const baseUrl = (input.baseUrl ?? "").trim();
  if (!baseUrl) {
    return { ok: false, reason: "BENCH_HTTP_BASE_URL is required.", baseUrl: null, projectRef: null };
  }

  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "BENCH_HTTP_BASE_URL is not a valid URL.", baseUrl, projectRef: null };
  }

  if (input.confirm !== "staging") {
    return {
      ok: false,
      reason: "BENCH_CONFIRM must be staging for authenticated HTTP benchmarks.",
      baseUrl,
      projectRef: null,
    };
  }

  const supabaseUrl = (input.supabaseUrl ?? "").trim().toLowerCase();
  if (supabaseUrl.includes(PRODUCTION_REF)) {
    return {
      ok: false,
      reason: `Refusing production project ${PRODUCTION_REF}.`,
      baseUrl,
      projectRef: PRODUCTION_REF,
    };
  }
  if (!supabaseUrl.includes(STAGING_REF)) {
    return {
      ok: false,
      reason: `NEXT_PUBLIC_SUPABASE_URL must include staging ref ${STAGING_REF}.`,
      baseUrl,
      projectRef: null,
    };
  }

  const loopback = LOOPBACK.has(host);
  const allowedHost = (input.allowAppHost ?? "").trim().toLowerCase();
  if (!loopback && host !== allowedHost) {
    return {
      ok: false,
      reason:
        "HTTP base host must be loopback or exactly BENCH_HTTP_ALLOW_HOST. Remote production app hosts are refused.",
      baseUrl,
      projectRef: STAGING_REF,
    };
  }

  return {
    ok: true,
    reason: loopback
      ? `Loopback app against staging ${STAGING_REF}.`
      : `Allowed staging app host ${host} against ${STAGING_REF}.`,
    baseUrl,
    projectRef: STAGING_REF,
  };
}

/**
 * Load a Playwright/CDP cookie dump or a raw Cookie header file.
 * Never logs cookie values.
 */
export function loadCookieHeader(filePath: string): CookieLoadResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, reason: `Cookie file not readable: ${filePath}` };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "Cookie file is empty." };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "Cookie JSON could not be parsed." };
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { chunks?: unknown }).chunks)
        ? (parsed as { chunks: unknown[] }).chunks
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? (parsed as { cookies: unknown[] }).cookies
          : null;
    if (!list) return { ok: false, reason: "Cookie JSON must be an array or { chunks|cookies: [] }." };

    const parts: string[] = [];
    const names: string[] = [];
    let valueChars = 0;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const name = String((item as { name?: unknown }).name ?? "");
      const value = String((item as { value?: unknown }).value ?? "");
      if (!name || !value) continue;
      names.push(name);
      valueChars += value.length;
      parts.push(`${name}=${value}`);
    }
    if (parts.length === 0) return { ok: false, reason: "Cookie JSON contained no name/value pairs." };
    if (!names.some((name) => name.includes(STAGING_REF))) {
      return {
        ok: false,
        reason: `Cookie names must include staging project ${STAGING_REF} (sb-${STAGING_REF}-auth-token).`,
      };
    }
    if (names.some((name) => name.includes(PRODUCTION_REF))) {
      return { ok: false, reason: `Refusing production auth cookie for ${PRODUCTION_REF}.` };
    }
    return { ok: true, cookieHeader: parts.join("; "), cookieNames: names, valueChars };
  }

  // Raw Cookie header: name=value; name2=value2
  if (!trimmed.includes(`${STAGING_REF}`)) {
    return {
      ok: false,
      reason: `Raw cookie header must name staging project ${STAGING_REF}.`,
    };
  }
  if (trimmed.includes(PRODUCTION_REF)) {
    return { ok: false, reason: `Refusing production auth cookie for ${PRODUCTION_REF}.` };
  }
  const names = trimmed
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter(Boolean);
  return {
    ok: true,
    cookieHeader: trimmed,
    cookieNames: names,
    valueChars: trimmed.length,
  };
}
