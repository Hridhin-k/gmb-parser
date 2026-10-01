import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { isUnassignedClient } from "@/lib/services/unassigned-client";
import { PageHeader } from "@/components/page-header";
import { LocationTable } from "@/components/location-table";
import { UnlinkedLocationsPanel } from "@/components/unlinked-locations-panel";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import Link from "next/link";

interface ClientDetailPageProps {
  params: Promise<{ clientId: string }>;
}

export default async function ClientDetailPage({
  params,
}: ClientDetailPageProps) {
  const { clientId } = await params;

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

  if (!membership) notFound();

  const { data: clientRow } = await admin
    .from("grm_clients")
    .select("id, name, notes, is_active, created_at")
    .eq("id", clientId)
    .eq("workspace_id", membership.workspace_id)
    .single();

  if (!clientRow || isUnassignedClient(clientRow.notes)) notFound();

  const { data: connections } = await admin
    .from("grm_google_connections")
    .select("id")
    .eq("workspace_id", membership.workspace_id)
    .eq("status", "active")
    .limit(1);

  const connectionId = connections?.[0]?.id ?? null;

  const [connectedLocationsRaw, unlinkedLocations] = await Promise.all([
    admin
      .from("grm_google_locations")
      .select(
        `id, google_location_name, location_title, address_formatted,
         primary_phone, store_code, is_active, last_synced_at, client_id`
      )
      .eq("workspace_id", membership.workspace_id)
      .eq("client_id", clientId)
      .order("location_title"),
    GoogleBusinessProfileService.getUnlinkedLocations(membership.workspace_id),
  ]);

  if (connectedLocationsRaw.error) {
    throw new Error(
      `Failed to load locations: ${connectedLocationsRaw.error.message}`
    );
  }

  const connectedLocations = connectedLocationsRaw.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/clients"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Clients
        </Link>
      </div>

      <PageHeader
        title={clientRow.name}
        description="Locations assigned to this business. Sync reviews, then reply from the Reviews page."
      >
        <Link
          href={`/reviews?client=${clientId}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          View reviews
        </Link>
      </PageHeader>

      {connectedLocations.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No locations on this client yet. On the{" "}
          <Link href="/clients" className="font-medium underline">
            Clients
          </Link>{" "}
          page, assign profiles from the Unassigned pool to{" "}
          <span className="font-medium">{clientRow.name}</span>.
        </div>
      )}

      {unlinkedLocations.length > 0 && (
        <UnlinkedLocationsPanel
          clientId={clientId}
          locations={unlinkedLocations.map((l) => ({
            id: l.id,
            location_title: l.location_title,
            address_formatted: l.address_formatted,
            google_location_name: l.google_location_name,
            grm_google_accounts: Array.isArray(l.grm_google_accounts)
              ? (l.grm_google_accounts[0] as {
                  account_display_name: string;
                } | null)
              : (l.grm_google_accounts as {
                  account_display_name: string;
                } | null),
          }))}
        />
      )}

      <LocationTable
        clientId={clientId}
        connectionId={connectionId ?? ""}
        locations={connectedLocations.map((l) => ({
          id: l.id,
          google_location_name: l.google_location_name,
          location_title: l.location_title,
          address_formatted: l.address_formatted,
          primary_phone: l.primary_phone,
          store_code: l.store_code,
          is_active: l.is_active,
          last_synced_at: l.last_synced_at,
          client_id: l.client_id,
        }))}
      />
    </div>
  );
}
