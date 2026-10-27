/**
 * Central Supabase URL/key resolution for browser, server, and admin clients.
 * In local development this refuses the known production project and requires
 * the staging project. Non-development runtimes are unchanged aside from a
 * hard check that the public anon key is not a service-role credential.
 */

export const STAGING_SUPABASE_REF = "yrmlbimuupirmttngxys";
export const PRODUCTION_SUPABASE_REF = "yzagcxdzlsjpowokqewm";

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
  projectRef: string;
};

export type SupabaseAdminConfig = {
  url: string;
  serviceRoleKey: string;
  projectRef: string;
};

export type SupabaseConfigInput = {
  url?: string | null;
  anonKey?: string | null;
  serviceRoleKey?: string | null;
  nodeEnv?: string | null;
};

export function projectRefFromSupabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(payload: string): string {
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  // Node 16+ and browsers both provide atob.
  return atob(normalized);
}

function jwtClaim(token: string, claim: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const data = JSON.parse(decodeJwtPayload(payload)) as Record<string, unknown>;
    const value = data[claim];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function assertPublicKeyIsNotServiceRole(anonKey: string): void {
  if (jwtClaim(anonKey, "role") === "service_role") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY must not be a service-role credential."
    );
  }
}

function assertDevelopmentTarget(projectRef: string | null, nodeEnv: string): void {
  if (nodeEnv !== "development") return;

  if (!projectRef) {
    throw new Error(
      "Local development requires NEXT_PUBLIC_SUPABASE_URL for the RevuPilot staging project."
    );
  }

  if (projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error(
      "Local development refuses the production Supabase project. Point NEXT_PUBLIC_SUPABASE_URL at staging."
    );
  }

  if (projectRef !== STAGING_SUPABASE_REF) {
    throw new Error(
      `Local development expects staging project ${STAGING_SUPABASE_REF}.`
    );
  }
}

function resolveUrlAndRef(input: SupabaseConfigInput): {
  url: string;
  projectRef: string;
  nodeEnv: string;
} {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "";
  const url = (input.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!url) {
    if (nodeEnv === "development") {
      throw new Error(
        "Local development requires NEXT_PUBLIC_SUPABASE_URL for the RevuPilot staging project."
      );
    }
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  const projectRef = projectRefFromSupabaseUrl(url);
  assertDevelopmentTarget(projectRef, nodeEnv);
  if (!projectRef) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a *.supabase.co project URL.");
  }

  return { url, projectRef, nodeEnv };
}

/** Browser / cookie-bound clients: URL + anon key only. */
export function getSupabasePublicConfig(
  input: SupabaseConfigInput = {}
): SupabasePublicConfig {
  const { url, projectRef } = resolveUrlAndRef(input);
  const anonKey = (input.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.");
  }
  assertPublicKeyIsNotServiceRole(anonKey);
  return { url, anonKey, projectRef };
}

/** Server-only privileged client: URL + service-role key. */
export function getSupabaseAdminConfig(
  input: SupabaseConfigInput = {}
): SupabaseAdminConfig {
  const { url, projectRef } = resolveUrlAndRef(input);
  const serviceRoleKey = (
    input.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  ).trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return { url, serviceRoleKey, projectRef };
}
