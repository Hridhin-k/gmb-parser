import { createAdminClient } from "@/lib/db/client";
import { getPool } from "@/lib/db/pool";
import { createHash } from "node:crypto";
import { AuditService } from "@/lib/services/audit";
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
  // Preserve Unicode and punctuation; ASCII slugs merged unrelated businesses.
  return `${AUTO_ORG_PREFIX}v2:${createHash("sha256").update(businessKey(orgName)).digest("hex")}`;
}

function businessKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function businessNameForLocation(loc: LocationRow): string {
  return organizationNameFromTitle(loc.location_title,
    loc.store_code ? `Location ${loc.store_code}` : `Google location ${loc.google_location_name}`);
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
  if (/^(?=.*\d)[A-Za-z0-9]{8,}$/.test(inner)) return true;
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
  hold_reason: string | null;
  group_id: string | null;
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
  const db = createAdminClient();
  await ensureUnassignedClient(workspaceId);
  const unassignedIds = new Set(await listUnassignedClientIds(workspaceId));

  const { data: locations, error: locError } = await db
    .from("grm_google_locations")
    .select(
      "id, google_location_name, location_title, store_code, client_id, is_active, hold_reason, group_id"
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

  const { data: existingClients, error: clientError } = await db
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
  const byName = new Map<string, string | null>();

  for (const c of clients) {
    if (c.notes === UNASSIGNED_CLIENT_MARKER || isAutoLocMarker(c.notes)) continue;
    const key = businessKey(c.name);
    // Ambiguous existing names need an explicit choice, not an arbitrary owner.
    byName.set(key, byName.has(key) ? null : c.id);
    if (isAutoOrgMarker(c.notes) && c.notes === autoOrgMarker(c.name)) byOrgMarker.set(c.notes, c.id);
  }

  const toProvision = ((locations ?? []) as LocationRow[]).filter(
    (loc) => !loc.hold_reason && !loc.group_id && shouldProvisionLocation(loc, clientById, unassignedIds)
  );

  if (!toProvision.length) {
    return { clientsCreated: 0, clientsReused: 0, locationsLinked: 0 };
  }

  let clientsCreated = 0;
  let clientsReused = 0;
  let locationsLinked = 0;
  const emptiedClientIds = new Set<string>();

  for (const loc of toProvision) {
    const orgName = businessNameForLocation(loc);
    const marker = autoOrgMarker(orgName);

    let clientId = byOrgMarker.get(marker) ?? byName.get(businessKey(orgName));

    if (clientId) {
      clientsReused += 1;
      // Reusing a manually created business must preserve its notes and ownership.
    } else {
      const { data: created, error: createError } = await db
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
        const { data: raced } = await db
          .from("grm_clients")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("notes", marker)
          .eq("is_active", true)
          .maybeSingle();

        if (!raced) {
          logger.error("client.auto_provision.create_failed", {
            googleLocationName: loc.google_location_name,
            orgName,
            dbError: createError?.message,
          });
          await AuditService.log({ workspaceId, userId, action: "location.grouping_failed",
            entityType: "grm_google_locations", entityId: loc.id,
            metadata: { stage: "create_business", businessName: orgName, errorCode: createError?.code,
              error: createError?.message, previousClientId: loc.client_id } });
          continue;
        }
        clientId = raced.id;
        clientsReused += 1;
      } else {
        clientId = created.id;
        clientsCreated += 1;
        await AuditService.log({ workspaceId, userId, action: "client.created", entityType: "grm_clients", entityId: clientId,
          metadata: { source: "google_business_grouping", name: orgName } });
      }

      byOrgMarker.set(marker, clientId);
      byName.set(businessKey(orgName), clientId);
      clientById.set(clientId, { id: clientId, name: orgName, notes: marker });
    }

    let link = db
      .from("grm_google_locations")
      .update({ client_id: clientId, group_id: null })
      .eq("id", loc.id)
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("hold_reason", null)
      .is("group_id", null);
    // A concurrent manual assignment wins over this discovery snapshot.
    link = loc.client_id ? link.eq("client_id", loc.client_id) : link.is("client_id", null);
    const { data: linked, error: linkError } = await link.select("id").maybeSingle();

    if (linkError) {
      logger.error("client.auto_provision.link_failed", {
        locationId: loc.id,
        clientId,
        dbError: linkError.message,
      });
      await AuditService.log({ workspaceId, userId, action: "location.grouping_failed",
        entityType: "grm_google_locations", entityId: loc.id,
        metadata: { stage: "link_store", businessName: orgName, errorCode: linkError.code, error: linkError.message,
          before: { clientId: loc.client_id }, targetClientId: clientId } });
      continue;
    }

    if (!linked) continue;
    locationsLinked += 1;
    if (loc.client_id && loc.client_id !== clientId) emptiedClientIds.add(loc.client_id);
    await AuditService.log({
      workspaceId, userId, action: "location.moved", entityType: "grm_google_locations", entityId: loc.id,
      metadata: { source: "google_business_grouping", businessName: orgName,
        before: { clientId: loc.client_id, groupId: loc.group_id ?? null },
        after: { clientId, groupId: null } },
    });
  }

  const leftoverAutoLoc = [...emptiedClientIds].filter((id) => {
    const row = clientById.get(id);
    return row && isAutoLocMarker(row.notes);
  });

  if (leftoverAutoLoc.length > 0) {
    // Include held and inactive stores; a legacy business with any store stays visible.
    const { rows: archived } = await getPool().query<{ id: string; name: string }>(`UPDATE grm_clients c SET is_active=false
      WHERE c.workspace_id=$1 AND c.is_active AND c.id=ANY($2::uuid[]) AND c.notes LIKE 'grm:auto:loc:%'
      AND NOT EXISTS (SELECT 1 FROM grm_google_locations l WHERE l.workspace_id=c.workspace_id AND l.client_id=c.id)
      RETURNING c.id,c.name`,
    [workspaceId, leftoverAutoLoc]);
    for (const business of archived) {
      await AuditService.log({ workspaceId, userId, action: "client.updated", entityType: "grm_clients", entityId: business.id,
        metadata: { source: "google_business_grouping", name: business.name, reason: "empty_legacy_business",
          before: { isActive: true }, after: { isActive: false } } });
    }
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
    const orgName = businessNameForLocation(loc);
    // Old slug markers remain valid when the actual business name matches.
    return businessKey(orgName) !== businessKey(client.name);
  }
  return false;
}
