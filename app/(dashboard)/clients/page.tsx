import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CreateClientDialog } from "@/components/create-client-dialog";
import { UnassignedLocationsBoard } from "@/components/unassigned-locations-board";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, MapPin } from "lucide-react";
import Link from "next/link";

export default async function ClientsPage() {
  const { workspaceId } = await getActiveWorkspace();
  const admin = createAdminClient();

  const [{ data: connections }, clients, unassignedLocations] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1),
    GoogleBusinessProfileService.getWorkspaceClients(workspaceId),
    GoogleBusinessProfileService.getUnlinkedLocations(workspaceId),
  ]);

  const connectionId = connections?.[0]?.id ?? null;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Clients"
        description="Sync profiles to pull every Google Business Profile you manage. Shops from the same brand (for example every Fazyo location) are grouped under one client."
      >
        <div className="flex flex-wrap items-center gap-2">
          {connectionId && <SyncLocationsButton connectionId={connectionId} />}
          <CreateClientDialog />
        </div>
      </PageHeader>

      {unassignedLocations.length > 0 && (
        <UnassignedLocationsBoard
          connectionId={connectionId}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          locations={unassignedLocations.map((l) => ({
            id: l.id,
            location_title: l.location_title,
            address_formatted: l.address_formatted,
          }))}
        />
      )}

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description={
            connectionId
              ? "Click Sync profiles. We will create one client per organisation and put every shop under it."
              : "Connect a Google account in Settings first, then sync profiles."
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const locationCount =
              (client.grm_google_locations as Array<{ count: number }> | null)?.[0]
                ?.count ?? 0;

            return (
              <Link key={client.id} href={`/clients/${client.id}`}>
                <Card className="cursor-pointer transition-colors hover:border-[#1a73e8]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-[#202124]">
                          {client.name}
                        </p>
                        <p className="mt-1 text-sm font-light text-[#5f6368]">
                          {locationCount === 0
                            ? "No locations yet"
                            : `${locationCount} location${locationCount === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-[#e8f0fe] px-2.5 py-1 text-xs font-semibold text-[#1a73e8]">
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
      )}
    </div>
  );
}
