import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/db/client";
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
import { LocationTable } from "@/components/location-table";
import { UnlinkedLocationsPanel } from "@/components/unlinked-locations-panel";
import { MessageSquareText } from "lucide-react";
import { locationDisplayName } from "@/lib/ui/location-place";
import { canOpenPath } from "@/lib/shell";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import Link from "next/link";

interface ClientDetailPageProps {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: ClientDetailPageProps) {
  const [{ clientId }, { user, workspaceId }, , role] = await Promise.all([
    params,
    getActiveWorkspace(),
    searchParams,
    getActiveRole(),
  ]);
  const access = await getMemberAccess(user.id, workspaceId);
  const allowed = await visibleClientIds(workspaceId, access?.scope);
  if (allowed && !allowed.includes(clientId)) notFound();
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
  const connectionState: "active" | "attention" | "waiting" =
    directConnection.data?.status === "active" ? "active" : directConnection.data ? "attention" : "waiting";
  const connectionLabel =
    connectionState === "active"
      ? "This client's Google account is connected."
      : connectionState === "attention"
        ? "This client's Google connection needs attention."
        : "Waiting for this client to connect Google.";
  const canEdit = workspaceGrant(role, "manage_locations") || access?.scope.clientId === clientId;
  const managers = canAssignManager
    ? (await getWorkspaceRoster(workspaceId)).members
        .filter((member) => member.accessEnabled)
        .map((member) => ({ id: member.userId, email: member.email }))
    : [];
  const displayName = clientRow.brand_name || clientRow.name;
  const activeLocations = connectedLocations.filter((location) => location.is_active).length;
  const googleReviews = connectedLocations.reduce((sum, location) => sum + (location.total_review_count ?? 0), 0);
  const syncProblems = connectedLocations.filter(
    (location) => location.sync_status === "partial" || location.sync_status === "failed"
  ).length;
  const neverSynced = connectedLocations.filter((location) => !location.last_synced_at).length;
  const workHref = `/overview?client=${encodeURIComponent(clientId)}`;
  const reviewsHref = `/reviews?client=${encodeURIComponent(clientId)}`;
  const portfolioCrumb = canOpenPath("/portfolio", role)
    ? { label: "Portfolio", href: "/portfolio" }
    : { label: "Locations", href: "/locations" };
  const n = (value: number) => value.toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={[portfolioCrumb, { label: displayName }]}
        title={displayName}
        eyebrow={
          <>
            <Badge variant={connectionState === "active" ? "ok" : connectionState === "attention" ? "bad" : "warn"}>
              {connectionState === "active" ? "Connected" : connectionState === "attention" ? "Connection issue" : "Waiting to connect"}
            </Badge>
            {clientRow.is_active === false ? <Badge variant="default">Inactive</Badge> : null}
          </>
        }
        description={[
          clientRow.brand_name && clientRow.brand_name !== clientRow.name ? clientRow.name : null,
          `${n(connectedLocations.length)} ${connectedLocations.length === 1 ? "location" : "locations"}`,
          connectionLabel,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Button variant="outline" nativeButton={false} render={<Link href={reviewsHref} />}>
          <MessageSquareText aria-hidden />
          View reviews
        </Button>
        <Button nativeButton={false} render={<Link href={workHref} />}>
          Work in this business ›
        </Button>
      </PageHeader>

      <Banner tone="neutral">
        This is the agency&apos;s view of a client: details, locations, Google connection and the client approval queue.
        Day-to-day work (reviews, escalations, analytics) happens in the Work pages with the scope set to this business.
      </Banner>

      {connectionState !== "active" && canEdit ? (
        <Banner
          tone={connectionState === "attention" ? "bad" : "warn"}
          title={connectionState === "attention" ? "Google connection needs attention." : "Waiting for the client to connect Google."}
        >
          Create a connection link under Business details and send it to the client. They sign in at Google; no password is
          shared here.
        </Banner>
      ) : null}

      <KpiGrid>
        <KpiTile
          label="Locations"
          value={n(connectedLocations.length)}
          detail={`${n(activeLocations)} active`}
          href="/locations"
        />
        <KpiTile label="Reviews on Google" value={n(googleReviews)} detail="Across these locations" href={reviewsHref} />
        <KpiTile
          label="Awaiting client approval"
          value={n(queue.length)}
          detail="Approving does not publish"
          href="#client-approval"
        />
        <KpiTile
          label="Sync problems"
          value={n(syncProblems)}
          detail={neverSynced > 0 ? `${n(neverSynced)} never synced` : "Failed or partial review syncs"}
          tone={syncProblems > 0 ? "bad" : undefined}
          href="#business-locations"
        />
      </KpiGrid>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div id="business-locations" className="flex min-w-0 scroll-mt-6 flex-col gap-4">
          {connectedLocations.length === 0 ? (
            <Banner
              tone="info"
              title="No locations on this business yet."
              actions={
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/locations" />}>
                  Open locations
                </Button>
              }
            >
              On the Locations page, assign profiles from the Unassigned pool to {clientRow.name}.
            </Banner>
          ) : null}

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
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section id="client-approval" className="scroll-mt-6 overflow-hidden rounded-lg border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                Client approval queue <span className="font-normal text-ink-3">· {n(queue.length)}</span>
              </h2>
              <span className="text-xs text-ink-3">Approving here does not publish to Google</span>
            </div>
            <ClientQueue clientId={clientId} items={queue} />
          </section>

          <section className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Business details</h2>
              {canEdit ? null : <span className="text-xs text-ink-3">Read only for your role</span>}
            </div>
            <div className="p-4">
              {canEdit ? (
                <AgencyClientForm
                  clientId={clientId}
                  canAssignManager={canAssignManager}
                  managers={managers}
                  initial={{
                    name: clientRow.name,
                    contactEmail: clientRow.contact_email ?? "",
                    website: clientRow.website ?? "",
                    brandName: clientRow.brand_name ?? "",
                    logoUrl: clientRow.logo_url ?? "",
                    accountManagerUserId: clientRow.account_manager_user_id,
                  }}
                />
              ) : (
                <dl className="space-y-2 text-[13px]">
                  {[
                    ["Name", clientRow.name],
                    ["Brand name", clientRow.brand_name],
                    ["Contact email", clientRow.contact_email],
                    ["Website", clientRow.website],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-ink-3">{label}</dt>
                      <dd className="text-right text-ink">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
