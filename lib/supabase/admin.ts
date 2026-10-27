import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { getSupabaseAdminConfig } from "@/lib/supabase/config";
import { fetchWithTransientRetry } from "@/lib/supabase/transient-fetch";

const QUERY_TIMEOUT_MS = 20_000;

/**
 * A stuck database call must fail the page instead of holding it until the
 * browser times out, and a sporadic "JWT issued at future" gateway rejection
 * is retried instead of crashing the page.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTransientRetry(input, init, { timeoutMs: QUERY_TIMEOUT_MS });
}

function fetchWithBenchDiag(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  return fetchWithTimeout(input, init).then(async (response) => {
    try {
      const { resolveBenchDiagFromHeaders } = await import("@/lib/bench-diag");
      const state = await resolveBenchDiagFromHeaders();
      if (!state) return response;
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let name = "postgrest";
      try {
        const path = new URL(raw).pathname;
        const rpc = /\/rest\/v1\/rpc\/([^/?]+)/.exec(path);
        if (rpc) name = rpc[1];
        else {
          const table = /\/rest\/v1\/([^/?]+)/.exec(path);
          if (table) name = `table:${table[1]}`;
        }
      } catch {
        /* ignore parse */
      }
      if (state.rpcs.length < 80) {
        state.rpcs.push({ name: name.slice(0, 80), ms: Math.round(performance.now() - started), ok: response.ok });
      }
    } catch {
      /* diag must never break the page */
    }
    return response;
  });
}

export function createAdminClient() {
  const { url, serviceRoleKey } = getSupabaseAdminConfig();
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: fetchWithBenchDiag,
    },
  });
}
