import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/supabase";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { fetchWithTransientRetry } from "@/lib/supabase/transient-fetch";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient<Database>(url, anonKey, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetchWithTransientRetry(input, init),
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll called from a Server Component — safe to ignore
        }
      },
    },
  });
}
