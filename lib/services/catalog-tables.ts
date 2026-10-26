import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { forgetPrefix, remember } from "@/lib/ttl-cache";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CatalogClientRow {
  id: string;
  name: string;
  notes: string | null;
}

export interface CatalogGroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  client_id: string | null;
}

export interface CatalogLocationRow {
  id: string;
  client_id: string | null;
  group_id: string | null;
  location_title: string;
  store_code: string | null;
  address_formatted: string | null;
  is_active: boolean;
  hold_reason: string | null;
  voice_of_merchant: boolean | null;
  last_synced_at: string | null;
}

export interface CatalogTables {
  clients: CatalogClientRow[];
  groups: CatalogGroupRow[];
  locations: CatalogLocationRow[];
}

/**
 * The workspace catalog (active clients, groups, locations) shared by the
 * layout, dashboard context, scope choices and settings. Two layers:
 * React `cache()` dedupes within one render, and `unstable_cache` reuses the
 * tables across requests for 30 seconds (tagged `catalog` so mutations can
 * bust it immediately). Catalog edits are rare; review data is never cached
 * here.
 */
async function fetchCatalogTables(workspaceId: string): Promise<CatalogTables> {
  const admin = createAdminClient();
  const [clientsResult, groupsResult, locationsResult] = await Promise.all([
    admin
      .from("grm_clients")
      .select("id, name, notes")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name"),
    admin.from("grm_groups").select("id, name, parent_id, client_id").eq("workspace_id", workspaceId).order("name"),
    admin
      .from("grm_google_locations")
      .select(
        "id, client_id, group_id, location_title, store_code, address_formatted, is_active, hold_reason, voice_of_merchant, last_synced_at"
      )
      .eq("workspace_id", workspaceId)
      .order("location_title"),
  ]);
  if (clientsResult.error) throw new Error(`Failed to load organisations: ${clientsResult.error.message}`);
  if (groupsResult.error) throw new Error(`Failed to load groups: ${groupsResult.error.message}`);
  if (locationsResult.error) throw new Error(`Failed to load outlets: ${locationsResult.error.message}`);
  return {
    clients: (clientsResult.data ?? []) as CatalogClientRow[],
    groups: (groupsResult.data ?? []) as CatalogGroupRow[],
    locations: (locationsResult.data ?? []) as CatalogLocationRow[],
  };
}

const getCachedCatalogTables = unstable_cache(fetchCatalogTables, ["catalog-tables-v1"], {
  revalidate: 30,
  tags: ["catalog"],
});

export const loadCatalogTables = cache(async function loadCatalogTables(
  workspaceId: string
): Promise<CatalogTables> {
  return remember(`catalog:${workspaceId}`, 60_000, () => getCachedCatalogTables(workspaceId));
});

/** Call after any mutation that changes clients, groups or locations. */
export function bustCatalogCache(): void {
  revalidateTag("catalog", "max");
  forgetPrefix("catalog:");
}
