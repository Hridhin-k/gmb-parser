import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { getMemberAccess } from "@/lib/services/access";
import { locationDisplayName } from "@/lib/ui/location-place";
import {
  firstParam,
  readScopeRequest,
  resolveScope,
  UNAVAILABLE_SCOPE_ID,
  visibleCatalog,
  type ResolvedScope,
  type ScopeCatalog,
} from "@/lib/scope";

export const loadScopeCatalog = cache(async (userId: string, workspaceId: string): Promise<ScopeCatalog | null> => {
  const access = await getMemberAccess(userId, workspaceId);
  if (!access?.enabled) return null;
  const admin = createAdminClient();
  const [workspace, clientsResult, groupsResult, locationsResult] = await Promise.all([
    admin.from("grm_workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    admin
      .from("grm_clients")
      .select("id, name, notes")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name"),
    admin.from("grm_groups").select("id, name, client_id, parent_id").eq("workspace_id", workspaceId).order("name"),
    admin
      .from("grm_google_locations")
      .select("id, client_id, group_id, location_title, store_code, address_formatted")
      .eq("workspace_id", workspaceId),
  ]);
  if (workspace.error) throw new Error(`Failed to load the organisation: ${workspace.error.message}`);
  if (clientsResult.error) throw new Error(`Failed to load organisations: ${clientsResult.error.message}`);
  if (groupsResult.error) throw new Error(`Failed to load groups: ${groupsResult.error.message}`);
  if (locationsResult.error) throw new Error(`Failed to load outlets: ${locationsResult.error.message}`);

  const clients = (clientsResult.data ?? [])
    .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
    .map((client) => ({ id: client.id, name: client.name }));
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const catalog: ScopeCatalog = {
    workspaceId,
    workspaceName: workspace.data?.name?.trim() || "Organisation",
    clients,
    groups: (groupsResult.data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      clientId: group.client_id,
      parentId: group.parent_id,
    })),
    locations: (locationsResult.data ?? [])
      .filter((location) => location.client_id && names.has(location.client_id))
      .map((location) => ({
        id: location.id,
        name: locationDisplayName({
          title: location.location_title,
          brand: names.get(location.client_id!),
          storeCode: location.store_code,
          address: location.address_formatted,
        }),
        clientId: location.client_id,
        groupId: location.group_id,
      })),
    lock: access.scope,
  };
  return visibleCatalog(catalog);
});

export async function readPageScope(
  userId: string,
  workspaceId: string,
  params: { client?: string | string[]; group?: string | string[]; location?: string | string[] }
): Promise<ResolvedScope> {
  const catalog = await loadScopeCatalog(userId, workspaceId);
  const request = readScopeRequest({
    client: firstParam(params.client),
    group: firstParam(params.group),
    location: firstParam(params.location),
  });
  if (!catalog) {
    return resolveScope(
      {
        workspaceId,
        workspaceName: "Organisation",
        clients: [],
        groups: [],
        locations: [],
        lock: { clientId: null, groupId: null, locationId: UNAVAILABLE_SCOPE_ID },
      },
      request
    );
  }
  return resolveScope(catalog, request);
}
