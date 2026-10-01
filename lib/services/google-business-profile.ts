import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleApiError, AppError } from "@/lib/errors";
import { GoogleOAuthService } from "./google-oauth";
import { logger } from "@/lib/logger";
import {
  ensureUnassignedClient,
  listUnassignedClientIds,
  UNASSIGNED_CLIENT_MARKER,
} from "./unassigned-client";
import { autoProvisionClientsFromLocations } from "./auto-provision-clients";
import type {
  GoogleBusinessAccount,
  GoogleBusinessLocation,
  GoogleAccountsListResponse,
  GoogleLocationsListResponse,
  NormalizedGoogleAccount,
  NormalizedGoogleLocation,
  GoogleApiErrorBody,
} from "@/lib/types/google";

const ACCOUNT_MANAGEMENT_API =
  "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_API =
  "https://mybusinessbusinessinformation.googleapis.com/v1";

// Read mask for location fields we store — avoids pulling unnecessary data
const LOCATION_READ_MASK =
  "name,title,storeCode,storefrontAddress,phoneNumbers,websiteUri,metadata";

// ---------------------------------------------------------------------------
// Internal fetch helper — handles Google API error shapes consistently
// ---------------------------------------------------------------------------
async function googleFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GoogleApiErrorBody;
    const msg = body.error?.message ?? `HTTP ${response.status}`;
    const status = body.error?.status ?? "UNKNOWN";

    if (response.status === 403) {
      throw new GoogleApiError(
        `Insufficient permission: ${msg}`,
        response.status,
        { status, url }
      );
    }

    if (response.status === 429) {
      throw new GoogleApiError(
        "Google API quota exceeded. Please try again later.",
        response.status,
        { status, url }
      );
    }

    if (response.status === 404) {
      throw new GoogleApiError(
        `Resource not found: ${msg}`,
        response.status,
        { status, url }
      );
    }

    throw new GoogleApiError(msg, response.status, { status, url });
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Normalizers — convert raw Google shapes to application-safe objects
// ---------------------------------------------------------------------------
function normalizeAccount(
  account: GoogleBusinessAccount
): NormalizedGoogleAccount {
  return {
    googleAccountName: account.name,
    accountDisplayName: account.accountName,
    accountType: account.type,
    verificationState: account.state?.status ?? account.verificationState ?? null,
  };
}

function normalizeLocation(
  location: GoogleBusinessLocation
): NormalizedGoogleLocation {
  const addr = location.storefrontAddress;
  let addressFormatted: string | null = null;

  if (addr) {
    const parts = [
      ...(addr.addressLines ?? []),
      addr.locality,
      addr.administrativeArea,
      addr.postalCode,
      addr.regionCode,
    ].filter(Boolean);
    addressFormatted = parts.join(", ");
  }

  return {
    googleLocationName: location.name,
    locationTitle: location.title,
    storeCode: location.storeCode ?? null,
    addressFormatted,
    primaryPhone: location.phoneNumbers?.primaryPhone ?? null,
    websiteUri: location.websiteUri ?? null,
    placeId: location.metadata?.placeId ?? null,
  };
}

// ---------------------------------------------------------------------------
// GoogleBusinessProfileService
// ---------------------------------------------------------------------------
export class GoogleBusinessProfileService {
  /**
   * Lists all GBP accounts accessible to the given connection.
   * Handles pagination transparently.
   */
  static async listAccounts(
    accessToken: string
  ): Promise<GoogleBusinessAccount[]> {
    const accounts: GoogleBusinessAccount[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${ACCOUNT_MANAGEMENT_API}/accounts`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const data = await googleFetch<GoogleAccountsListResponse>(
        url.toString(),
        accessToken
      );

      if (data.accounts) accounts.push(...data.accounts);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return accounts;
  }

  /**
   * Lists all locations for a given account resource name.
   * Pass `accounts/-` to include locations owned or managed via a group.
   * https://developers.google.com/my-business/content/location-data#list_locations
   */
  static async listLocations(
    accessToken: string,
    accountName: string
  ): Promise<GoogleBusinessLocation[]> {
    const locations: GoogleBusinessLocation[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${BUSINESS_INFO_API}/${accountName}/locations`);
      url.searchParams.set("readMask", LOCATION_READ_MASK);
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      let data: GoogleLocationsListResponse;
      try {
        data = await googleFetch<GoogleLocationsListResponse>(
          url.toString(),
          accessToken
        );
      } catch (err) {
        // Some accounts may have PERMISSION_DENIED — skip them, don't fail all
        if (err instanceof GoogleApiError && err.googleErrorCode === 403) {
          break;
        }
        throw err;
      }

      if (data.locations) locations.push(...data.locations);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return locations;
  }

  /**
   * Reviews API still expects accounts/{accountId}/locations/{locationId}.
   * Business Information often returns locations/{locationId} only.
   */
  static resolveLocationResourceName(
    locationName: string,
    fallbackAccountName: string
  ): string {
    if (locationName.startsWith("accounts/")) return locationName;
    if (locationName.startsWith("locations/")) {
      return `${fallbackAccountName}/${locationName}`;
    }
    return `${fallbackAccountName}/locations/${locationName}`;
  }

  /**
   * Synchronizes all accounts and locations for a workspace connection,
   * then auto-creates one client per newly discovered profile.
   *
   * Idempotent. Skips Google location API calls when a recent sync exists
   * unless `force` is true (saves GBP quota).
   */
  static async syncConnectionAccounts(
    connectionId: string,
    workspaceId: string,
    options: { force?: boolean; userId?: string } = {}
  ): Promise<{
    accountsUpserted: number;
    locationsUpserted: number;
    clientsCreated: number;
    clientsReused: number;
    locationsLinked: number;
    skippedGoogleFetch: boolean;
  }> {
    const supabase = createAdminClient();
    const force = options.force === true;

    // Quota guard: reuse DB state if locations were synced recently
    const COOLDOWN_MS = 10 * 60 * 1000;
    if (!force) {
      const { data: recent } = await supabase
        .from("grm_google_locations")
        .select("last_synced_at")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .not("last_synced_at", "is", null)
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent?.last_synced_at) {
        const age = Date.now() - new Date(recent.last_synced_at).getTime();
        if (age < COOLDOWN_MS) {
          const provision = options.userId
            ? await autoProvisionClientsFromLocations(workspaceId, options.userId)
            : { clientsCreated: 0, clientsReused: 0, locationsLinked: 0 };

          logger.info("gbp.sync.skipped_google_cooldown", {
            workspaceId,
            connectionId,
            ageMs: age,
          });

          return {
            accountsUpserted: 0,
            locationsUpserted: 0,
            clientsCreated: provision.clientsCreated,
            clientsReused: provision.clientsReused,
            locationsLinked: provision.locationsLinked,
            skippedGoogleFetch: true,
          };
        }
      }
    }

    const accessToken =
      await GoogleOAuthService.getValidAccessToken(connectionId);

    let rawAccounts: GoogleBusinessAccount[];
    try {
      rawAccounts = await this.listAccounts(accessToken);
    } catch (err) {
      if (err instanceof GoogleApiError && err.googleErrorCode === 403) {
        throw new AppError(
          "The connected Google account does not have access to any Business Profile accounts. Please verify the account has the required permissions.",
          "GBP_INSUFFICIENT_PERMISSION",
          403
        );
      }
      throw err;
    }

    let accountsUpserted = 0;
    let locationsUpserted = 0;

    // google_account_name → row id
    const accountIdByName = new Map<string, string>();
    let fallbackAccountName: string | null = null;
    let fallbackAccountId: string | null = null;

    for (const rawAccount of rawAccounts) {
      const normalized = normalizeAccount(rawAccount);

      // Upsert account — idempotent on (workspace_id, google_account_name)
      const { data: accountRow, error: accountError } = await supabase
        .from("grm_google_accounts")
        .upsert(
          {
            workspace_id: workspaceId,
            connection_id: connectionId,
            google_account_name: normalized.googleAccountName,
            account_display_name: normalized.accountDisplayName,
            account_type: normalized.accountType,
            verification_state: normalized.verificationState,
          },
          { onConflict: "workspace_id,google_account_name" }
        )
        .select("id")
        .single();

      if (accountError || !accountRow) {
        logger.error("gbp.sync.upsert_account_failed", {
          googleAccountName: normalized.googleAccountName,
          dbError: accountError?.message,
        });
        continue;
      }

      accountsUpserted += 1;
      accountIdByName.set(normalized.googleAccountName, accountRow.id);
      if (!fallbackAccountName) {
        fallbackAccountName = normalized.googleAccountName;
        fallbackAccountId = accountRow.id;
      }
    }

    if (!fallbackAccountName || !fallbackAccountId) {
      return {
        accountsUpserted,
        locationsUpserted: 0,
        clientsCreated: 0,
        clientsReused: 0,
        locationsLinked: 0,
        skippedGoogleFetch: false,
      };
    }

    const unassigned = await ensureUnassignedClient(workspaceId);

    // Prefer accounts/- so manager access via groups is included (1 API call).
    // Fall back to per-account lists only if the wildcard returns nothing.
    const locationByName = new Map<string, GoogleBusinessLocation>();

    try {
      const wildcardLocations = await this.listLocations(
        accessToken,
        "accounts/-"
      );
      for (const loc of wildcardLocations) {
        locationByName.set(loc.name, loc);
      }
    } catch (fetchErr) {
      logger.warn("gbp.sync.wildcard_locations_failed", {
        message: fetchErr instanceof Error ? fetchErr.message : "Unknown",
      });
    }

    if (locationByName.size === 0) {
      for (const accountName of accountIdByName.keys()) {
        try {
          const rawLocations = await this.listLocations(
            accessToken,
            accountName
          );
          for (const loc of rawLocations) {
            locationByName.set(loc.name, loc);
          }
        } catch (fetchErr) {
          logger.warn("gbp.sync.locations_fetch_failed", {
            googleAccountName: accountName,
            message: fetchErr instanceof Error ? fetchErr.message : "Unknown",
          });
        }
      }
    }

    for (const rawLocation of locationByName.values()) {
      const loc = normalizeLocation(rawLocation);
      const accountMatch = loc.googleLocationName.match(
        /^(accounts\/[^/]+)\//
      );
      const owningAccountName = accountMatch?.[1] ?? fallbackAccountName;
      const googleAccountId =
        accountIdByName.get(owningAccountName) ?? fallbackAccountId;
      const googleLocationName = this.resolveLocationResourceName(
        loc.googleLocationName,
        owningAccountName
      );

      const { data: existing } = await supabase
        .from("grm_google_locations")
        .select("id, client_id")
        .eq("workspace_id", workspaceId)
        .eq("google_location_name", googleLocationName)
        .maybeSingle();

      const payload = {
        workspace_id: workspaceId,
        google_account_id: googleAccountId,
        google_location_name: googleLocationName,
        location_title: loc.locationTitle,
        store_code: loc.storeCode,
        address_formatted: loc.addressFormatted,
        primary_phone: loc.primaryPhone,
        website_uri: loc.websiteUri,
        place_id: loc.placeId,
        is_active: true,
        last_synced_at: new Date().toISOString(),
        // Keep existing client mapping. New rows start unassigned, then
        // auto-provision creates/links clients without extra Google calls.
        client_id: existing?.client_id ?? unassigned.id,
      };

      const { error: locError } = existing
        ? await supabase
            .from("grm_google_locations")
            .update(payload)
            .eq("id", existing.id)
        : await supabase.from("grm_google_locations").insert(payload);

      if (locError) {
        logger.error("gbp.sync.upsert_location_failed", {
          googleLocationName,
          dbError: locError.message,
        });
      } else {
        locationsUpserted += 1;
      }
    }

    const provision = options.userId
      ? await autoProvisionClientsFromLocations(workspaceId, options.userId)
      : { clientsCreated: 0, clientsReused: 0, locationsLinked: 0 };

    return {
      accountsUpserted,
      locationsUpserted,
      clientsCreated: provision.clientsCreated,
      clientsReused: provision.clientsReused,
      locationsLinked: provision.locationsLinked,
      skippedGoogleFetch: false,
    };
  }

  /**
   * Returns all synced locations for a workspace with optional client filter.
   * Never returns token data.
   */
  static async getWorkspaceLocations(
    workspaceId: string,
    clientId?: string
  ) {
    const supabase = createAdminClient();
    let query = supabase
      .from("grm_google_locations")
      .select(
        `id, workspace_id, google_account_id, google_location_name,
         location_title, store_code, address_formatted, primary_phone,
         website_uri, place_id, is_active, last_synced_at,
         total_review_count, average_rating, client_id,
         grm_clients(id, name)`
      )
      .eq("workspace_id", workspaceId)
      .order("location_title");

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;

    if (error) {
      throw new AppError("Failed to fetch locations", "DB_ERROR", 500);
    }

    return data;
  }

  /**
   * Maps a discovered Google location to an application client.
   * Does not delete Google data — only sets the client_id FK.
   */
  static async connectLocationToClient(
    locationId: string,
    clientId: string,
    workspaceId: string
  ): Promise<void> {
    const supabase = createAdminClient();

    // Verify both belong to the same workspace
    const [{ data: location }, { data: client }] = await Promise.all([
      supabase
        .from("grm_google_locations")
        .select("id")
        .eq("id", locationId)
        .eq("workspace_id", workspaceId)
        .single(),
      supabase
        .from("grm_clients")
        .select("id")
        .eq("id", clientId)
        .eq("workspace_id", workspaceId)
        .single(),
    ]);

    if (!location) {
      throw new AppError("Location not found", "NOT_FOUND", 404);
    }
    if (!client) {
      throw new AppError("Client not found", "NOT_FOUND", 404);
    }

    const { error } = await supabase
      .from("grm_google_locations")
      .update({ client_id: clientId })
      .eq("id", locationId)
      .eq("workspace_id", workspaceId);

    if (error) {
      throw new AppError("Failed to connect location to client", "DB_ERROR", 500);
    }
  }

  /**
   * Removes the client association from a location (moves it to the unassigned pool).
   */
  static async disconnectLocation(
    locationId: string,
    workspaceId: string
  ): Promise<void> {
    const supabase = createAdminClient();
    const unassigned = await ensureUnassignedClient(workspaceId);

    const { error } = await supabase
      .from("grm_google_locations")
      .update({ client_id: unassigned.id })
      .eq("id", locationId)
      .eq("workspace_id", workspaceId);

    if (error) {
      throw new AppError("Failed to disconnect location", "DB_ERROR", 500);
    }
  }

  /**
   * Lists all clients for a workspace, with location counts.
   * Excludes the system Unassigned holding client.
   */
  static async getWorkspaceClients(workspaceId: string) {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("grm_clients")
      .select(
        `id, name, notes, is_active, created_at,
         grm_google_locations(count)`
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
      .order("name");

    if (error) {
      throw new AppError("Failed to fetch clients", "DB_ERROR", 500);
    }

    return data;
  }

  /**
   * Creates a new client in the workspace.
   */
  static async createClient(
    workspaceId: string,
    userId: string,
    name: string,
    notes?: string
  ) {
    const trimmedNotes = notes?.trim() ?? null;
    if (
      trimmedNotes === UNASSIGNED_CLIENT_MARKER ||
      (trimmedNotes?.startsWith("grm:auto:loc:") ?? false)
    ) {
      throw new AppError("Invalid client notes", "VALIDATION_ERROR", 400);
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("grm_clients")
      .insert({
        workspace_id: workspaceId,
        name: name.trim(),
        notes: trimmedNotes,
        created_by: userId,
      })
      .select("id, name, notes, is_active, created_at")
      .single();

    if (error) {
      throw new AppError("Failed to create client", "DB_ERROR", 500);
    }

    return data;
  }

  /**
   * Gets unlinked locations (in the Unassigned pool, or client_id null).
   */
  static async getUnlinkedLocations(workspaceId: string) {
    const supabase = createAdminClient();
    const unassigned = await ensureUnassignedClient(workspaceId);
    const unassignedIds = await listUnassignedClientIds(workspaceId);
    const ids = unassignedIds.length ? unassignedIds : [unassigned.id];

    const { data, error } = await supabase
      .from("grm_google_locations")
      .select(
        `id, google_location_name, location_title, address_formatted,
         primary_phone, store_code, is_active, last_synced_at, client_id,
         grm_google_accounts(google_account_name, account_display_name)`
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .in("client_id", ids)
      .order("location_title");

    if (error) {
      throw new AppError("Failed to fetch unlinked locations", "DB_ERROR", 500);
    }

    return data;
  }

  /**
   * Moves every location currently on real clients back into the Unassigned pool.
   * Used once to recover from the old "auto-assign to first client" behavior.
   */
  static async resetAllLocationsToUnassigned(workspaceId: string): Promise<number> {
    const supabase = createAdminClient();
    const unassigned = await ensureUnassignedClient(workspaceId);

    const { data, error } = await supabase
      .from("grm_google_locations")
      .update({ client_id: unassigned.id })
      .eq("workspace_id", workspaceId)
      .neq("client_id", unassigned.id)
      .select("id");

    if (error) {
      throw new AppError("Failed to reset location assignments", "DB_ERROR", 500);
    }

    return data?.length ?? 0;
  }
}
