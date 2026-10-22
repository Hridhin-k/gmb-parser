"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/supabase";
import { fetchWithTransientRetry } from "@/lib/supabase/transient-fetch";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetchWithTransientRetry(input, init),
      },
    }
  );
}
