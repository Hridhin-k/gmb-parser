// Type-only query inference for the existing fluent service layer. No PostgREST
// client, HTTP gateway, Supabase SDK, or service-role key is used at runtime.
import type { PostgrestClient } from "@supabase/postgrest-js";
import type { Database } from "@/lib/types/database-schema";
import { SqlQuery, callFunction } from "./query";

export function createAdminClient(): PostgrestClient<Database> {
  return { from: (table: string) => new SqlQuery(table), rpc: callFunction } as unknown as PostgrestClient<Database>;
}
