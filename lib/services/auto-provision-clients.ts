import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  ensureUnassignedClient,
  UNASSIGNED_CLIENT_MARKER,
  listUnassignedClientIds,
} from "@/lib/services/unassigned-client";

const AUTO_LOC_PREFIX = "grm:auto:loc:";
const AUTO_ORG_PREFIX = "grm:auto:org:";

/** @deprecated per-location clients; kept so old rows can be merged into orgs. */
export function autoClientMarker(googleLocationName: string): string {
  return `${AUTO_LOC_PREFIX}${googleLocationName}`;
}

export function isAutoLocMarker(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith(AUTO_LOC_PREFIX);
}

export function isAutoOrgMarker(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith(AUTO_ORG_PREFIX);
}

export function isAutoClientMarker(notes: string | null | undefined): boolean {
  return isAutoLocMarker(notes) || isAutoOrgMarker(notes);
}

export function autoOrgMarker(orgName: string): string {
  const key =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "org";
  return `${AUTO_ORG_PREFIX}${key}`;
}

/**
 * Brand / organisation name from a Google profile title.
 * "Fazyo (FAZ-KTYM)" and "Fazyo (0693…)" both become "Fazyo".
 * Legal names like "Norms Management (Pvt) Ltd - …" keep the inner "(Pvt)".
 */
export function organizationNameFromTitle(title: string, fallback = "Google location"): string {
  let name = title.replace(/\s+/g, " ").trim();
  if (!name) return fallback.slice(0, 255);

  while (true) {
    const match = name.match(/^(.*) \(([^)]+)\)$/);
    if (!match) break;
    const head = match[1].trim();
    const inner = match[2].trim();
    if (!head || !shouldStripTrailingQualifier(inner)) break;
    name = head;
  }

  return name.slice(0, 255);
}

function shouldStripTrailingQualifier(inner: string): boolean {
  if (/^\d+$/.test(inner)) return true;
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(inner)) return true;
  if (/^\d{8,}$/.test(inner)) return true;
  if (/^[A-Za-z0-9]{8,}$/.test(inner)) return true;
  return false;
}

export interface AutoProvisionResult {
  clientsCreated: number;
  clientsReused: number;
  locationsLinked: number;
}

type ClientRow = { id: string; name: string; notes: string | null };
type LocationRow = {
  id: string;
  google_location_name: string;
  location_title: string;
  store_code: string | null;
  client_id: string | null;
  is_active: boolean;
};

/**
 * Groups Google profiles into one client per organisation.
 * Shops named "Fazyo", "Fazyo (FAZ-TCR)", "Fazyo (id)" all land on client Fazyo.
 * Re-homes leftover per-location auto clients from older syncs.
 */
export async function autoProvisionClientsFromLocations(
  workspaceId: string,
  userId: string
): Promise<AutoProvisionResult> {
  const supabase = createAdminClient();
  await ensureUnassignedClient(workspaceId);
  const unassignedIds = new Set(await listUnassignedClientIds(workspaceId));

  const { data: locations, error: locError } = await supabase
    .from("grm_google_locations")
    .select(
      "id, google_location_name, location_title, store_code, client_id, is_active"
    )
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (locError) {
    throw new AppError(
      "Failed to load locations for client provisioning",
      "DB_ERROR",
      500
    );
  }

  const { data: existingClients, error: clientError } = await supabase
    .from("grm_clients")
    .select("id, name, notes")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (clientError) {
    throw new AppError(
      "Failed to load clients for provisioning",
      "DB_ERROR",
      500
    );
  }

  const clients = (existingClients ?? []) as ClientRow[];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const byOrgMarker = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const c of clients) {
    if (c.notes === UNASSIGNED_CLIENT_MARKER) continue;
    if (c.name) byName.set(c.name.toLowerCase(), c.id);
    if (isAutoOrgMarker(c.notes)) byOrgMarker.set(c.notes!, c.id);
  }

  const toProvision = ((locations ?? []) as LocationRow[]).filter((loc) =>
    shouldProvisionLocation(loc, clientById, unassignedIds)
  );

  if (!toProvision.length) {
    return { clientsCreated: 0, clientsReused: 0, locationsLinked: 0 };
  }

  let clientsCreated = 0;
  let clientsReused = 0;
  let locationsLinked = 0;
  const emptiedClientIds = new Set<string>();

  for (const loc of toProvision) {
    const orgName = organizationNameFromTitle(
      loc.location_title,
      loc.store_code ? `Location ${loc.store_code}` : "Google location"
    );
    const marker = autoOrgMarker(orgName);

    let clientId = byOrgMarker.get(marker) ?? byName.get(orgName.toLowerCase());

    if (clientId) {
      clientsReused += 1;
      const existing = clientById.get(clientId);
      if (existing && !isAutoOrgMarker(existing.notes)) {
        await supabase
          .from("grm_clients")
          .update({ notes: marker })
          .eq("id", clientId)
          .eq("workspace_id", workspaceId);
        existing.notes = marker;
        byOrgMarker.set(marker, clientId);
      }
    } else {
      const { data: created, error: createError } = await supabase
        .from("grm_clients")
        .insert({
          workspace_id: workspaceId,
          name: orgName,
          notes: marker,
          is_active: true,
          created_by: userId,
        })
        .select("id")
        .single();

      if (createError || !created) {
        const { data: raced } = await supabase
          .from("grm_clients")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("notes", marker)
          .maybeSingle();

        if (!raced) {
          logger.error("client.auto_provision.create_failed", {
            googleLocationName: loc.google_location_name,
            orgName,
            dbError: createError?.message,
          });
          continue;
        }
        clientId = raced.id;
        clientsReused += 1;
      } else {
        clientId = created.id;
        clientsCreated += 1;
      }

      byOrgMarker.set(marker, clientId);
      byName.set(orgName.toLowerCase(), clientId);
      clientById.set(clientId, { id: clientId, name: orgName, notes: marker });
    }

    if (loc.client_id && loc.client_id !== clientId) {
      emptiedClientIds.add(loc.client_id);
    }

    const { error: linkError } = await supabase
      .from("grm_google_locations")
      .update({ client_id: clientId })
      .eq("id", loc.id)
      .eq("workspace_id", workspaceId);

    if (linkError) {
      logger.error("client.auto_provision.link_failed", {
        locationId: loc.id,
        clientId,
        dbError: linkError.message,
      });
      continue;
    }

    locationsLinked += 1;
  }

  const leftoverAutoLoc = [...emptiedClientIds].filter((id) => {
    const row = clientById.get(id);
    return row && isAutoLocMarker(row.notes);
  });

  if (leftoverAutoLoc.length > 0) {
    await supabase
      .from("grm_clients")
      .update({ is_active: false })
      .eq("workspace_id", workspaceId)
      .in("id", leftoverAutoLoc);
  }

  return { clientsCreated, clientsReused, locationsLinked };
}

function shouldProvisionLocation(
  loc: LocationRow,
  clientById: Map<string, ClientRow>,
  unassignedIds: Set<string>
): boolean {
  if (!loc.client_id || unassignedIds.has(loc.client_id)) return true;
  const client = clientById.get(loc.client_id);
  if (!client || client.notes === UNASSIGNED_CLIENT_MARKER) return true;
  if (isAutoLocMarker(client.notes)) return true;
  if (isAutoOrgMarker(client.notes)) {
    const orgName = organizationNameFromTitle(loc.location_title);
    return autoOrgMarker(orgName) !== client.notes;
  }
  return false;
}
