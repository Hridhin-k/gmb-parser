"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/supabase";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { fetchWithTransientRetry } from "@/lib/supabase/transient-fetch";

export function createClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient<Database>(url, anonKey, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetchWithTransientRetry(input, init),
    },
  });
}
