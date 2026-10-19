import { createAdminClient } from "@/lib/supabase/admin";
import { locationDisplayName } from "@/lib/ui/location-place";

export interface ReviewRequestLocation {
  id: string;
  name: string;
  placeId: string | null;
  clientId: string | null;
  clientName: string | null;
  storeCode: string | null;
  active: boolean;
  url: string | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function googleReviewRequestUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** Locations the workspace can ask a customer to review, with a Google link when one exists. */
export async function listReviewRequestLocations(
  workspaceId: string,
  clientId: string | null,
  scope: { locationId?: string | null; groupId?: string | null; locationIds?: string[] | null } = {}
): Promise<ReviewRequestLocation[]> {
  const admin = createAdminClient();
  let query = admin
    .from("grm_google_locations")
    .select(
      "id, location_title, store_code, address_formatted, place_id, is_active, client_id, grm_clients(name)"
    )
    .eq("workspace_id", workspaceId)
    .order("location_title", { ascending: true });

  if (scope.locationIds) {
    if (scope.locationIds.length === 0) return [];
    query = query.in("id", scope.locationIds);
  } else if (scope.locationId) {
    query = query.eq("id", scope.locationId);
  } else if (scope.groupId) {
    query = query.eq("group_id", scope.groupId);
  }
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load review links: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const client = one(row.grm_clients as { name: string } | { name: string }[] | null);
      const placeId = row.place_id?.trim() || null;
      return {
        id: row.id,
        name: locationDisplayName({
          title: row.location_title,
          brand: client?.name,
          storeCode: row.store_code,
          address: row.address_formatted,
        }),
        placeId,
        clientId: row.client_id,
        clientName: client?.name ?? null,
        storeCode: row.store_code,
        active: row.is_active,
        url: placeId ? googleReviewRequestUrl(placeId) : null,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}
