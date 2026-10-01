import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  ensureUnassignedClient,
  UNASSIGNED_CLIENT_MARKER,
  listUnassignedClientIds,
} from "@/lib/services/unassigned-client";

/** Notes marker: one auto client per Google location resource name. */
export function autoClientMarker(googleLocationName: string): string {
  return `grm:auto:loc:${googleLocationName}`;
}

export function isAutoClientMarker(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith("grm:auto:loc:");
}

function sanitizeClientName(title: string, fallback: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback.slice(0, 255);
  return cleaned.slice(0, 255);
}

function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base.toLowerCase())) {
    used.add(base.toLowerCase());
    return base;
  }
  let i = 2;
  while (used.has(`${base} (${i})`.toLowerCase())) i += 1;
  const next = `${base} (${i})`.slice(0, 255);
  used.add(next.toLowerCase());
  return next;
}

export interface AutoProvisionResult {
  clientsCreated: number;
  clientsReused: number;
  locationsLinked: number;
}

/**
 * Creates one client per managed Google location that is still unassigned.
 * Idempotent: reuses the client previously auto-created for that location
 * (matched via notes marker). Never calls Google APIs — DB only.
 */
export async function autoProvisionClientsFromLocations(
  workspaceId: string,
  userId: string
): Promise<AutoProvisionResult> {
  const supabase = createAdminClient();
  // Collapse duplicate Unassigned pools first
  const unassigned = await ensureUnassignedClient(workspaceId);
  const unassignedIds = await listUnassignedClientIds(workspaceId);

  const { data: locations, error: locError } = await supabase
    .from("grm_google_locations")
    .select(
      "id, google_location_name, location_title, store_code, client_id, is_active"
    )
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .in("client_id", unassignedIds.length ? unassignedIds : [unassigned.id]);

  if (locError) {
    throw new AppError(
      "Failed to load locations for client provisioning",
      "DB_ERROR",
      500
    );
  }

  const { data: nullClientLocs } = await supabase
    .from("grm_google_locations")
    .select(
      "id, google_location_name, location_title, store_code, client_id, is_active"
    )
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .is("client_id", null);

  const pending = [...(locations ?? []), ...(nullClientLocs ?? [])];
  const byId = new Map(pending.map((l) => [l.id, l]));
  const toProvision = [...byId.values()];

  if (!toProvision.length) {
    return { clientsCreated: 0, clientsReused: 0, locationsLinked: 0 };
  }

  const { data: existingClients } = await supabase
    .from("grm_clients")
    .select("id, name, notes")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  const byMarker = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const c of existingClients ?? []) {
    if (c.notes === UNASSIGNED_CLIENT_MARKER) continue;
    if (c.name) usedNames.add(c.name.toLowerCase());
    if (isAutoClientMarker(c.notes)) {
      byMarker.set(c.notes!, c.id);
    }
  }

  let clientsCreated = 0;
  let clientsReused = 0;
  let locationsLinked = 0;

  for (const loc of toProvision) {
    const marker = autoClientMarker(loc.google_location_name);
    let clientId = byMarker.get(marker);

    if (clientId) {
      clientsReused += 1;
    } else {
      const baseName = sanitizeClientName(
        loc.location_title,
        loc.store_code ? `Location ${loc.store_code}` : "Google location"
      );
      const preferred =
        usedNames.has(baseName.toLowerCase()) && loc.store_code
          ? sanitizeClientName(`${baseName} (${loc.store_code})`, baseName)
          : baseName;
      const name = uniqueName(preferred, usedNames);

      const { data: created, error: createError } = await supabase
        .from("grm_clients")
        .insert({
          workspace_id: workspaceId,
          name,
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
            dbError: createError?.message,
          });
          continue;
        }
        clientId = raced.id;
        clientsReused += 1;
      } else {
        clientId = created.id;
        byMarker.set(marker, clientId);
        clientsCreated += 1;
      }
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

  return { clientsCreated, clientsReused, locationsLinked };
}
