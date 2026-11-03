import { createAdminClient } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { connectionView, sharedPlaceIds, type ConnectionView } from "@/lib/hierarchy";
import { parseShellProfileCounts } from "@/lib/shell-profile";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { locationDisplayName } from "@/lib/ui/location-place";

export interface LocationCardRow {
  id: string;
  name: string;
  address: string | null;
  rating: number | null;
  unreplied: number;
  connection: ConnectionView;
}

export interface BusinessCard {
  id: string;
  name: string;
  rating: number | null;
  unreplied: number;
  locations: LocationCardRow[];
}

export interface LocationsBoard {
  businesses: BusinessCard[];
  locationCount: number;
  lastSyncedAt: string | null;
}

const CHUNK = 150;

/** Unreplied reviews per location, from the same Postgres function as the sidebar counts. */
async function unrepliedByLocation(workspaceId: string, locationIds: string[]): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const counts = new Map<string, number>();
  for (let index = 0; index < locationIds.length; index += CHUNK) {
    const { data, error } = await admin.rpc("grm_shell_profile_attention", {
      p_workspace_id: workspaceId,
      p_location_ids: locationIds.slice(index, index + CHUNK),
    });
    if (error) throw new AppError("Could not load reply counts.", "DB_ERROR", 500);
    for (const row of parseShellProfileCounts(data)) counts.set(row.locationId, row.unreplied);
  }
  return counts;
}

function averageRating(rows: LocationCardRow[]): number | null {
  const rated = rows.filter((row) => row.rating != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, row) => sum + (row.rating ?? 0), 0) / rated.length;
}

/**
 * Businesses with their Google locations for the Locations page: rating, reviews
 * waiting for a reply and whether Google access still works. `allowedClientIds`
 * limits it to the businesses a scoped person covers; `locationIds` to the
 * place chosen in the sidebar.
 */
export async function loadLocationsBoard(
  workspaceId: string,
  allowedClientIds: string[] | null,
  locationIds: string[] | null = null
): Promise<LocationsBoard> {
  const admin = createAdminClient();
  const [clients, locations, accounts, connections] = await Promise.all([
    admin.from("grm_clients").select("id, name, notes").eq("workspace_id", workspaceId).eq("is_active", true).order("name"),
    admin
      .from("grm_google_locations")
      .select(
        "id, client_id, location_title, store_code, address_formatted, is_active, hold_reason, voice_of_merchant, google_duplicate_of, place_id, average_rating, google_account_id, last_synced_at"
      )
      .eq("workspace_id", workspaceId)
      .order("location_title"),
    admin.from("grm_google_accounts").select("id, connection_id").eq("workspace_id", workspaceId),
    admin.from("grm_google_connections").select("id, status").eq("workspace_id", workspaceId),
  ]);
  for (const result of [clients, locations, accounts, connections]) {
    if (result.error) throw new AppError("Could not load locations.", "DB_ERROR", 500);
  }

  const allow = allowedClientIds ? new Set(allowedClientIds) : null;
  const only = locationIds ? new Set(locationIds) : null;
  const businesses = (clients.data ?? []).filter(
    (client) => client.notes !== UNASSIGNED_CLIENT_MARKER && (!allow || allow.has(client.id))
  );
  const businessIds = new Set(businesses.map((business) => business.id));
  const rows = (locations.data ?? []).filter(
    (location) => location.client_id && businessIds.has(location.client_id) && (!only || only.has(location.id))
  );
  const statusByConnection = new Map((connections.data ?? []).map((row) => [row.id, row.status]));
  const statusByAccount = new Map(
    (accounts.data ?? []).map((account) => [account.id, statusByConnection.get(account.connection_id) ?? null])
  );
  const shared = sharedPlaceIds(rows.map((row) => ({ id: row.id, placeId: row.place_id })));
  const unreplied = await unrepliedByLocation(
    workspaceId,
    rows.map((row) => row.id)
  );

  const byBusiness = new Map<string, LocationCardRow[]>();
  let lastSyncedAt: string | null = null;
  for (const row of rows) {
    if (row.last_synced_at && (!lastSyncedAt || row.last_synced_at > lastSyncedAt)) lastSyncedAt = row.last_synced_at;
    const status = row.google_account_id ? statusByAccount.get(row.google_account_id) ?? null : null;
    const list = byBusiness.get(row.client_id as string) ?? [];
    list.push({
      id: row.id,
      name: locationDisplayName({ title: row.location_title ?? "", storeCode: row.store_code, address: row.address_formatted }),
      address: row.address_formatted,
      rating: row.average_rating == null ? null : Number(row.average_rating),
      unreplied: unreplied.get(row.id) ?? 0,
      connection: connectionView({
        connectionStatus: status as "active" | "expired" | "revoked" | null,
        isActive: row.is_active,
        holdReason: row.hold_reason as "duplicate" | "unverified" | null,
        voiceOfMerchant: row.voice_of_merchant,
        googleDuplicateOf: row.google_duplicate_of,
        sharedPlace: Boolean(row.place_id && shared.has(row.place_id.trim())),
      }),
    });
    byBusiness.set(row.client_id as string, list);
  }

  const cards = businesses
    .map((business) => {
      const list = byBusiness.get(business.id) ?? [];
      return {
        id: business.id,
        name: business.name,
        rating: averageRating(list),
        unreplied: list.reduce((sum, row) => sum + row.unreplied, 0),
        locations: list,
      };
    })
    // A place chosen in the sidebar hides the businesses outside it.
    .filter((card) => !only || card.locations.length > 0);

  return { businesses: cards, locationCount: rows.length, lastSyncedAt };
}
