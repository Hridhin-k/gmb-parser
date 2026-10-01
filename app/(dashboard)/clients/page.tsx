import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CreateClientDialog } from "@/components/create-client-dialog";
import { UnassignedLocationsBoard } from "@/components/unassigned-locations-board";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, MapPin } from "lucide-react";
import Link from "next/link";

export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single();

  if (!membership) {
    return (
      <div className="space-y-6">
        <PageHeader title="Clients" />
        <EmptyState
          icon={Building2}
          title="No workspace found"
          description="Contact your administrator to be added to a workspace."
        />
      </div>
    );
  }

  const [{ data: connections }, clients, unassignedLocations] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", membership.workspace_id)
      .eq("status", "active")
      .limit(1),
    GoogleBusinessProfileService.getWorkspaceClients(membership.workspace_id),
    GoogleBusinessProfileService.getUnlinkedLocations(membership.workspace_id),
  ]);

  const connectionId = connections?.[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Click Sync profiles to pull every Google Business Profile you manage and create a client for each one automatically."
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
              ? "Click Sync profiles. We will create one client per Google Business Profile you manage."
              : "Connect a Google account in Settings first, then sync profiles."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const locationCount =
              (client.grm_google_locations as Array<{ count: number }> | null)?.[0]
                ?.count ?? 0;

            return (
              <Link key={client.id} href={`/clients/${client.id}`}>
                <Card className="cursor-pointer border-gray-200 shadow-none transition-shadow hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {client.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {locationCount === 0
                            ? "No locations yet"
                            : `${locationCount} location${locationCount === 1 ? "" : "s"}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
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
