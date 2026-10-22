import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
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

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    }
  );
}
