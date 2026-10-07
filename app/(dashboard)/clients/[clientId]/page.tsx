import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { isUnassignedClient } from "@/lib/services/unassigned-client";
import { getLocationInsightView } from "@/lib/services/dashboard";
import { getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { LocationTable } from "@/components/location-table";
import { ProfileInsightPanel } from "@/components/profile-insight-panel";
import { UnlinkedLocationsPanel } from "@/components/unlinked-locations-panel";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { locationDisplayName } from "@/lib/ui/location-place";
import Link from "next/link";
import { validateFilterString } from "@/lib/validation";

interface ClientDetailPageProps {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: ClientDetailPageProps) {
  const [{ clientId }, { workspaceId }, query] = await Promise.all([
    params,
    getActiveWorkspace(),
    searchParams,
  ]);
  const admin = createAdminClient();

  const [
    { data: clientRow },
    { data: connections },
    connectedLocationsRaw,
    unlinkedLocations,
  ] = await Promise.all([
    admin
      .from("grm_clients")
      .select("id, name, notes, is_active, created_at")
      .eq("id", clientId)
      .eq("workspace_id", workspaceId)
      .single(),
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1),
    admin
      .from("grm_google_locations")
      .select(
        `id, google_location_name, location_title, address_formatted,
         primary_phone, store_code, is_active, last_synced_at, client_id`
      )
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .order("location_title"),
    GoogleBusinessProfileService.getUnlinkedLocations(workspaceId),
  ]);

  if (!clientRow || isUnassignedClient(clientRow.notes)) notFound();

  const connectionId = connections?.[0]?.id ?? null;

  if (connectedLocationsRaw.error) {
    throw new Error(
      `Failed to load locations: ${connectedLocationsRaw.error.message}`
    );
  }

  const connectedLocations = connectedLocationsRaw.data ?? [];
  const locationId = validateFilterString(query.location);
  const insight =
    locationId && connectedLocations.some((location) => location.id === locationId)
      ? await getLocationInsightView(workspaceId, locationId)
      : null;

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-2">
        <Link
          href="/clients"
          className="flex items-center gap-1 text-sm font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
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
          className="inline-flex h-10 items-center gap-1.5 rounded-full border-[1.5px] border-ink px-4 text-sm font-semibold text-ink hover:bg-paper"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          View reviews
        </Link>
      </PageHeader>

      {connectedLocations.length === 0 && (
        <div className="rounded-xl border border-silver bg-paper px-5 py-4 text-sm text-graphite">
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
            location_title: locationDisplayName({
              title: l.location_title,
              address: l.address_formatted,
            }),
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

      {insight ? (
        <div id="insight" className="scroll-mt-6">
          <Suspense>
            <ProfileInsightPanel
              profile={insight.profile}
              insight={insight.insight}
              heuristicSummary={insight.heuristicSummary}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
