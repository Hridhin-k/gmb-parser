import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { allows, workspaceGrant } from "@/lib/access";
import { isManager } from "@/lib/shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { UnassignedLocationsBoard } from "@/components/unassigned-locations-board";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, MapPin } from "lucide-react";
import { locationDisplayName } from "@/lib/ui/location-place";
import { loadHierarchy } from "@/lib/services/hierarchy";
import { HierarchyBoard } from "@/components/hierarchy-board";
import Link from "next/link";

function queryId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const access = await getMemberAccess(user.id, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const canSync = canSyncWorkspace(role);
  const admin = createAdminClient();

  const attention = Array.isArray(params.attention) ? params.attention[0] : params.attention;
  const [{ data: connections }, clients, unassignedLocations, hierarchy] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1),
    GoogleBusinessProfileService.getWorkspaceClients(workspaceId),
    GoogleBusinessProfileService.getUnlinkedLocations(workspaceId),
    loadHierarchy(workspaceId, {
      brandId: queryId(params.brand),
      groupId: queryId(params.group),
      locationId: queryId(params.location),
      attention: attention ?? null,
    }, allowedClientIds),
  ]);

  const connectionId = connections?.[0]?.id ?? null;
  const visibleClients = allowedClientIds
    ? clients.filter((client) => allowedClientIds.includes(client.id))
    : clients;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Locations and groups"
        description="Shops sync from Google under each client. Make a group, tick shops, and move them — then filter Inbox by that group."
      >
        {connectionId && canSync ? (
          <SyncLocationsButton connectionId={connectionId} />
        ) : connectionId || !isManager(role) ? null : (
          <Link
            href="/settings"
            className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-graphite"
          >
            Connect Google
          </Link>
        )}
      </PageHeader>

      <HierarchyBoard
        canManage={allows(role, "manage_locations")}
        canEditRules={allows(role, "edit_rules") && !workspaceGrant(role, "manage_locations")}
        brands={visibleClients.map((client) => ({ id: client.id, name: client.name }))}
        tree={hierarchy}
      />

      {!allowedClientIds && unassignedLocations.length > 0 && (
        <UnassignedLocationsBoard
          connectionId={connectionId}
          clients={visibleClients.map((c) => ({ id: c.id, name: c.name }))}
          locations={unassignedLocations.map((l) => ({
            id: l.id,
            location_title: locationDisplayName({
              title: l.location_title,
              address: l.address_formatted,
            }),
            address_formatted: l.address_formatted,
          }))}
        />
      )}

      {visibleClients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description={
            connectionId
              ? "Click Sync profiles. We will create one client per organisation and put every shop under it."
              : isManager(role)
                ? "Connect a Google account in Settings first, then sync profiles."
                : "An owner needs to connect Google before locations show up here."
          }
        />
      ) : (
        <details className="rounded-2xl border border-silver">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-graphite">
            Open client pages ({visibleClients.length})
          </summary>
          <div className="grid gap-4 border-t border-silver p-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleClients.map((client) => {
              const locationCount =
                (client.grm_google_locations as Array<{ count: number }> | null)?.[0]
                  ?.count ?? 0;

              return (
                <Link key={client.id} href={`/clients/${client.id}`}>
                  <Card className="cursor-pointer transition-colors hover:border-ink">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-base font-medium text-graphite">
                            {client.name}
                          </p>
                          <p className="mt-1 text-sm font-light text-slate">
                            {locationCount === 0
                              ? "No locations yet"
                              : `${locationCount} location${locationCount === 1 ? "" : "s"}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-ink">
                          <MapPin className="h-3 w-3" />
                          {locationCount}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
