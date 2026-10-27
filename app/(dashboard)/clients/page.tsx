import { createAdminClient } from "@/lib/db/client";
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
import { AlertTriangle, Building2, FolderTree, MapPin } from "lucide-react";
import { locationDisplayName } from "@/lib/ui/location-place";
import { loadHierarchy } from "@/lib/services/hierarchy";
import { HierarchyBoardLoader } from "@/components/hierarchy-board-loader";
import Link from "next/link";

function queryId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

function locationCountFor(client: {
  grm_google_locations?: Array<{ count: number }> | null;
}): number {
  return (client.grm_google_locations as Array<{ count: number }> | null)?.[0]?.count ?? 0;
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
      ungroupedClientId: queryId(params.ungrouped),
      attention: attention ?? null,
    }, allowedClientIds),
  ]);

  const connectionId = connections?.[0]?.id ?? null;
  const visibleClients = allowedClientIds
    ? clients.filter((client) => allowedClientIds.includes(client.id))
    : clients;

  const totalLocations = visibleClients.reduce((sum, client) => sum + locationCountFor(client), 0);
  const groupCount =
    hierarchy.brands.reduce(
      (sum, brand) =>
        sum + brand.regions.reduce((inner, region) => inner + 1 + region.cities.length, 0),
      0
    ) + hierarchy.loose.length;
  const attentionTotal =
    hierarchy.attention.expired + hierarchy.attention.duplicates + hierarchy.attention.unverified;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations and groups"
        description="Organise Google profiles into organisations and groups. Groups appear in the scope selector across Overview, Inbox, and Analytics."
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

      {visibleClients.length > 0 ? (
        <section className="rounded-2xl border border-[#e6ebf2] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Workspace map</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Building2} label="Organisations" value={String(visibleClients.length)} />
            <Stat icon={MapPin} label="Locations" value={String(totalLocations)} />
            <Stat icon={FolderTree} label="Groups" value={String(groupCount)} />
            <Stat
              icon={AlertTriangle}
              label="Needs attention"
              value={String(attentionTotal)}
              href={attentionTotal > 0 ? "/clients?attention=expired" : undefined}
              muted={attentionTotal === 0}
            />
          </dl>
        </section>
      ) : null}

      <HierarchyBoardLoader
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
        <section className="rounded-2xl border border-[#e6ebf2] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg text-ink">Organisations</h2>
              <p className="mt-1 text-sm text-slate">
                Open a client page for profile details, or use the structure board above to manage groups.
              </p>
            </div>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleClients.map((client) => {
              const count = locationCountFor(client);
              return (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex h-full items-start justify-between gap-3 rounded-xl border border-[#e6ebf2] bg-[#f4f7fb]/40 p-4 transition-colors hover:border-[#163a7a] hover:bg-[#f4f7fb]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-ink">{client.name}</p>
                      <p className="mt-1 text-sm text-slate">
                        {count === 0
                          ? "No locations yet"
                          : `${count} location${count === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#163a7a] ring-1 ring-[#e6ebf2]">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {count}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  href,
  muted = false,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  href?: string;
  muted?: boolean;
}) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-xs text-slate">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </dt>
      <dd className={`mt-2 font-heading text-2xl leading-none ${muted ? "text-slate" : "text-ink"}`}>
        {value}
      </dd>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="rounded-xl border border-[#e6ebf2] px-3 py-3 hover:border-[#163a7a]">
        {body}
      </Link>
    );
  }
  return <div className="rounded-xl border border-[#e6ebf2] px-3 py-3">{body}</div>;
}
