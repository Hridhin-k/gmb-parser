import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { isUnassignedClient } from "@/lib/services/unassigned-client";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { isOrgScope, workspaceGrant } from "@/lib/access";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { AgencyClientForm } from "@/components/agency-client-form";
import { ClientQueue } from "@/components/client-queue";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { PageHeader } from "@/components/page-header";
import { SectionLoading } from "@/components/section-loading";
import { LocationTable } from "@/components/location-table";
import { UnlinkedLocationsPanel } from "@/components/unlinked-locations-panel";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { locationDisplayName } from "@/lib/ui/location-place";
import Link from "next/link";

interface ClientDetailPageProps {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: ClientDetailPageProps) {
  const [{ clientId }, { user, workspaceId }, query, role] = await Promise.all([
    params,
    getActiveWorkspace(),
    searchParams,
    getActiveRole(),
  ]);
  const access = await getMemberAccess(user.id, workspaceId);
  const allowed = await visibleClientIds(workspaceId, access?.scope);
  if (allowed && !allowed.includes(clientId)) notFound();

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-2">
        <Link
          href="/clients"
          className="flex items-center gap-1 text-sm font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Locations
        </Link>
      </div>
      <Suspense fallback={<SectionLoading page="client" variant="panel" />}>
        <ClientDetailBody workspaceId={workspaceId} clientId={clientId} role={role} access={access} />
      </Suspense>
    </div>
  );
}

async function ClientDetailBody({
  workspaceId,
  clientId,
  role,
  access,
}: {
  workspaceId: string;
  clientId: string;
  role: Awaited<ReturnType<typeof getActiveRole>>;
  access: Awaited<ReturnType<typeof getMemberAccess>>;
}) {
  const admin = createAdminClient();

  const [
    { data: clientRow },
    { data: connections },
    connectedLocationsRaw,
    unlinkedLocations,
  ] = await Promise.all([
    admin
      .from("grm_clients")
      .select("id, name, notes, is_active, created_at, contact_email, website, brand_name, logo_url, account_manager_user_id")
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
         primary_phone, store_code, is_active, last_synced_at, client_id,
         total_review_count, sync_status`
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
  const locationIds = connectedLocations.map((location) => location.id);
  const [directConnection, reviewRows] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .eq("client_id", clientId)
      .limit(1)
      .maybeSingle(),
    locationIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; reviewer_display_name: string; star_rating: number }> })
      : admin
          .from("grm_reviews")
          .select("id, reviewer_display_name, star_rating")
          .eq("workspace_id", workspaceId)
          .is("missing_on_google_at", null)
          .in("location_id", locationIds)
          .limit(200),
  ]);
  const reviewIds = (reviewRows.data ?? []).map((review) => review.id);
  const waiting = reviewIds.length
    ? await admin
        .from("grm_review_replies")
        .select("review_id")
        .eq("workspace_id", workspaceId)
        .eq("client_approval", "requested")
        .in("review_id", reviewIds)
    : { data: [] as Array<{ review_id: string }> };
  const waitingIds = new Set((waiting.data ?? []).map((row) => row.review_id));
  const queue = (reviewRows.data ?? [])
    .filter((review) => waitingIds.has(review.id))
    .map((review) => ({
      reviewId: review.id,
      label: `${review.reviewer_display_name} · ${review.star_rating} stars`,
    }));
  const canAssignManager = Boolean(access && isOrgScope(access.scope) && workspaceGrant(role, "manage_locations"));
  const connectionLabel = directConnection.data?.status === "active"
    ? "This client's Google account is connected."
    : directConnection.data
      ? "This client's Google connection needs attention."
      : "Waiting for this client to connect Google.";

  return (
    <>
      <section className="rounded-xl border border-silver bg-white p-4">
        <h2 className="text-sm font-semibold text-graphite">{clientRow.brand_name || clientRow.name}</h2>
        <p className="mt-1 mb-3 text-xs text-slate">
          {connectionLabel}
        </p>
        {workspaceGrant(role, "manage_locations") || access?.scope.clientId === clientId ? (
          <AgencyClientForm
            clientId={clientId}
            canAssignManager={canAssignManager}
            managers={canAssignManager
              ? (await getWorkspaceRoster(workspaceId)).members
                  .filter((member) => member.accessEnabled)
                  .map((member) => ({ id: member.userId, email: member.email }))
              : []}
            initial={{
              name: clientRow.name,
              contactEmail: clientRow.contact_email ?? "",
              website: clientRow.website ?? "",
              brandName: clientRow.brand_name ?? "",
              logoUrl: clientRow.logo_url ?? "",
              accountManagerUserId: clientRow.account_manager_user_id,
            }}
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-graphite">Client approval queue</h2>
        <ClientQueue clientId={clientId} items={queue} />
      </section>

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
            Locations
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
        canSync={canSyncWorkspace(role)}
        locations={connectedLocations.map((l) => ({
          id: l.id,
          google_location_name: l.google_location_name,
          location_title: l.location_title,
          address_formatted: l.address_formatted,
          primary_phone: l.primary_phone,
          store_code: l.store_code,
          is_active: l.is_active,
          last_synced_at: l.last_synced_at,
          total_review_count: l.total_review_count,
          sync_status: l.sync_status,
          client_id: l.client_id,
        }))}
      />

    </>
  );
}
