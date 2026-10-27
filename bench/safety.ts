export const PRODUCTION_REF = "yzagcxdzlsjpowokqewm";
export const STAGING_REF = "yrmlbimuupirmttngxys";

/** Always blocked — production, Google, Gemini. Hosted Supabase is blocked unless the explicit staging allow path matches first. */
export const BLOCKED_FRAGMENTS = [
  PRODUCTION_REF,
  "supabase.co",
  "supabase.com",
  "pooler.supabase",
  "googleapis.com",
  "generativelanguage.googleapis.com",
] as const;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export type SafetyDecision = {
  ok: boolean;
  reason: string;
  host: string | null;
};

export type SafetyEnv = {
  databaseUrl?: string;
  confirm?: string;
  stagingHost?: string;
  allowLarge?: string;
};

export function redactDatabaseUrl(url: string): string {
  return url.replace(/\/\/([^:/?#]+):([^@/]+)@/, "//$1:***@");
}

export function parseDatabaseHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

/**
 * A published Docker port keeps the URL on 127.0.0.1 while Postgres reports
 * the container bridge address. That private address is accepted only when
 * the URL host is loopback. A public address still has to match the URL host.
 */
export function serverAddressAllowed(addr: string | null, urlHost: string | null): boolean {
  if (!addr) return true;
  const bare = addr.split("/")[0];
  if (bare === "127.0.0.1" || bare === "::1" || bare === urlHost) return true;
  const loopbackUrl = urlHost === "127.0.0.1" || urlHost === "localhost" || urlHost === "::1";
  return loopbackUrl && isPrivateIpv4(bare);
}

/** Staging hosted DB: confirm + exact host match + staging project ref in the URL. Production never qualifies. */
export function isExplicitStagingTarget(env: SafetyEnv, host: string, url: string): boolean {
  if (env.confirm !== "staging") return false;
  if (!env.stagingHost || host !== env.stagingHost) return false;
  const haystack = url.toLowerCase();
  if (haystack.includes(PRODUCTION_REF)) return false;
  return haystack.includes(STAGING_REF);
}

export function decideTarget(env: SafetyEnv): SafetyDecision {
  const url = env.databaseUrl?.trim() ?? "";
  if (!url) {
    return {
      ok: false,
      host: null,
      reason: "BENCH_DATABASE_URL is not set. The suite does not read .env or the production Supabase URL.",
    };
  }
  const host = parseDatabaseHost(url);
  if (!host) {
    return { ok: false, host: null, reason: "BENCH_DATABASE_URL is not a valid URL." };
  }
  const haystack = url.toLowerCase();

  if (haystack.includes(PRODUCTION_REF)) {
    return {
      ok: false,
      host,
      reason: `Refusing ${PRODUCTION_REF}. Load tests cannot target the known production project.`,
    };
  }

  for (const fragment of ["googleapis.com", "generativelanguage.googleapis.com"] as const) {
    if (haystack.includes(fragment)) {
      return {
        ok: false,
        host,
        reason: `Refusing ${fragment}. Load tests cannot target Google or Gemini.`,
      };
    }
  }

  // Explicit staging carve-out before the blanket hosted-Supabase deny.
  if (isExplicitStagingTarget(env, host, url)) {
    return { ok: true, host, reason: "Explicit staging host confirmed." };
  }

  for (const fragment of ["supabase.co", "supabase.com", "pooler.supabase"] as const) {
    if (haystack.includes(fragment)) {
      return {
        ok: false,
        host,
        reason: `Refusing ${fragment}. Hosted Supabase requires BENCH_CONFIRM=staging, BENCH_STAGING_HOST exact match, and staging project ${STAGING_REF} in the URL.`,
      };
    }
  }

  if (LOOPBACK.has(host)) {
    if (env.confirm !== "local") {
      return {
        ok: false,
        host,
        reason: "Loopback is allowed only when BENCH_CONFIRM=local.",
      };
    }
    return { ok: true, host, reason: "Loopback database confirmed." };
  }

  if (env.stagingHost && host === env.stagingHost) {
    if (env.confirm !== "staging") {
      return {
        ok: false,
        host,
        reason: "A staging host is allowed only when BENCH_CONFIRM=staging and BENCH_STAGING_HOST matches exactly.",
      };
    }
    return { ok: true, host, reason: "Explicit staging host confirmed." };
  }

  return {
    ok: false,
    host,
    reason: "Host is not loopback and does not match BENCH_STAGING_HOST. Set a dedicated database before seeding or loading.",
  };
}

export function largeVolumeAllowed(reviews: number, analyses: string, env: SafetyEnv): string | null {
  if (reviews < 10_000_000 && analyses !== "full") return null;
  if (reviews < 10_000_000) return null;
  if (env.allowLarge === "1" && env.confirm === "local") return null;
  if (env.allowLarge === "1" && env.confirm === "staging") return null;
  return "Datasets of 10 million and 50 million reviews require BENCH_ALLOW_LARGE=1 in addition to BENCH_CONFIRM.";
}

/** Drop every Gemini variable so a loaded shell key cannot be used to write fixture evidence. */
export function discardGeminiCredentials(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (key === "GEMINI_API_KEY" || key.startsWith("GEMINI_")) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}

export function assertSeedHasNoModelCall(sql: string): void {
  const lowered = sql.toLowerCase();
  const banned = ["gemini_api_key", "generativelanguage", "generatecontent", "googleapis"];
  for (const token of banned) {
    if (lowered.includes(token)) {
      throw new Error(`Bench seed SQL references ${token}. Fixture evidence must be copied from the lexicon.`);
    }
  }
}

export function fullAnalysisOnLargeAllowed(reviews: number, analyses: string, env: SafetyEnv): string | null {
  if (reviews < 10_000_000 || analyses !== "full") return null;
  if (env.allowLarge === "1") return null;
  return "Full analysis above 1,000,000 reviews requires BENCH_ALLOW_LARGE=1.";
}
