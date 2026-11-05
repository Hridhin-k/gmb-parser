import { StoreResolutionContacts } from "@/components/store-resolution-contacts";
import { createAdminClient } from "@/lib/db/client";
import { canAct } from "@/lib/access";
import { getMemberAccess } from "@/lib/services/access";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { EscalationContactStore } from "@/lib/services/escalations";

export async function ContactSection({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const [catalog, access, contact] = await Promise.all([
    loadScopeCatalog(userId, workspaceId), getMemberAccess(userId, workspaceId), EscalationContactStore.read(workspaceId),
  ]);
  const locations = catalog?.locations ?? [];
  const { data, error } = locations.length ? await createAdminClient().from("grm_google_locations")
    .select("id, resolution_phone, resolution_email").eq("workspace_id", workspaceId).in("id", locations.map((item) => item.id))
    : { data: [], error: null };
  if (error) throw new Error("Could not load store contacts.");
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  const editable = (resource: Parameters<typeof canAct>[0]["resource"]) => Boolean(access && canAct({
    role: access.role, enabled: access.enabled, scope: access.scope, actorWorkspaceId: workspaceId, permission: "edit_rules", resource,
  }));
  return <StoreResolutionContacts contact={contact} canEditDefault={editable({ workspaceId })}
    stores={locations.map((location) => ({
      id: location.id, name: location.name,
      contact: { phone: byId.get(location.id)?.resolution_phone ?? null, email: byId.get(location.id)?.resolution_email ?? null },
      canEdit: editable({ workspaceId, clientId: location.clientId, locationId: location.id, groupId: location.groupId,
        parentGroupId: catalog?.groups.find((group) => group.id === location.groupId)?.parentId ?? null }),
    }))} />;
}
