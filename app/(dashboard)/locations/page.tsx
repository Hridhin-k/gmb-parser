import { createAdminClient } from "@/lib/db/client";
import { relativeTime } from "@/lib/mobile-work";
import { loadLocationsBoard } from "@/lib/services/locations-board";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { GoogleBusinessProfileService } from "@/lib/services/google-business-profile";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { allows, isOrgScope, workspaceGrant } from "@/lib/access";
import { isManager } from "@/lib/shell";
import { PageHeader, PageTabs } from "@/components/page-header";
import { AddBusinessButton } from "@/components/add-business-button";
import { LocationBusinessCards } from "@/components/location-business-cards";
import { EmptyState } from "@/components/empty-state";
import { UnassignedLocationsBoard } from "@/components/unassigned-locations-board";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";
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

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

export default async function LocationsPage({
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
  // Groups is the structure board. Its old links (?attention, ?brand, ?ungrouped) still open it.
  const view = params.view === "groups" || attention || params.brand || params.ungrouped ? "groups" : "businesses";
  const resolved = await readPageScope(user.id, workspaceId, params);
  const scopedLocationIds = resolved.blocked || resolved.level !== "organisation" ? resolved.locationIds : null;
  const canAddBusiness = Boolean(access && isOrgScope(access.scope) && workspaceGrant(role, "manage_locations"));

  const [{ data: connections }, clients, unassignedLocations, hierarchy, board, managers] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id, google_email")
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    GoogleBusinessProfileService.getWorkspaceClients(workspaceId),
    GoogleBusinessProfileService.getUnlinkedLocations(workspaceId),
    view === "groups"
      ? loadHierarchy(workspaceId, {
          brandId: queryId(params.brand),
          groupId: queryId(params.group),
          locationId: queryId(params.location),
          ungroupedClientId: queryId(params.ungrouped),
          attention: attention ?? null,
        }, allowedClientIds)
      : null,
    view === "businesses" ? loadLocationsBoard(workspaceId, allowedClientIds, scopedLocationIds) : null,
    canAddBusiness
      ? getWorkspaceRoster(workspaceId).then((roster) =>
          roster.members.filter((member) => member.accessEnabled).map((member) => ({ id: member.userId, email: member.email }))
        )
      : Promise.resolve([] as Array<{ id: string; email: string }>),
  ]);

  const connectionId = connections?.[0]?.id ?? null;
  const visibleClients = allowedClientIds
    ? clients.filter((client) => allowedClientIds.includes(client.id))
    : clients;

  const totalLocations = visibleClients.reduce((sum, client) => sum + locationCountFor(client), 0);
  const showUnassigned = !allowedClientIds && unassignedLocations.length > 0;
  const syncedAgo = board?.lastSyncedAt ? relativeTime(board.lastSyncedAt) : "";
  const summary = [
    plural(visibleClients.length, "business", "businesses"),
    plural(totalLocations, "Google location", "Google locations"),
    syncedAgo ? `synced ${syncedAgo === "Just now" ? "just now" : syncedAgo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tabHref = (next: "businesses" | "groups") => (next === "groups" ? "/locations?view=groups" : "/locations");
  const unassignedNames = unassignedLocations
    .slice(0, 3)
    .map((location) => location.location_title);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Locations"
        description={
          visibleClients.length > 0
            ? summary
            : "Organise Google profiles into businesses and groups."
        }
      >
        {connectionId && canSync ? (
          <SyncLocationsButton connectionIds={(connections ?? []).map((item) => item.id)} accountNames={Object.fromEntries((connections ?? []).map((item) => [item.id, item.google_email]))} label="Sync all Google accounts" pill />
        ) : connectionId || !isManager(role) ? null : (
          <Button variant="outline" nativeButton={false} render={<Link href="/settings?section=integrations" />}>
            Connect Google
          </Button>
        )}
        {canAddBusiness ? <AddBusinessButton managers={managers} canAssignManager={canAddBusiness} /> : null}
      </PageHeader>

      {showUnassigned ? (
        <section
          aria-label="New locations from Google"
          className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-warn-line bg-warn-tint px-5 py-4 text-warn"
        >
          <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
            <span className="text-sm font-semibold">
              {plural(unassignedLocations.length, "new location", "new locations")} from Google
            </span>
            <span className="text-[13px]">
              {unassignedNames.join(", ")}
              {unassignedLocations.length > unassignedNames.length ? ", …" : ""} · pick which business they belong to
            </span>
          </span>
          <a
            href="#unassigned"
            className="inline-flex h-10 items-center rounded-full border border-warn-line bg-white px-4 text-sm font-semibold text-warn outline-none hover:bg-[#fffaf3] focus-visible:ring-2 focus-visible:ring-brand-line"
          >
            Assign
          </a>
        </section>
      ) : null}

      {visibleClients.length > 0 ? (
        <PageTabs
          tabs={[
            { label: "Businesses", href: tabHref("businesses"), active: view === "businesses", count: visibleClients.length },
            {
              label: "Groups and rules",
              href: tabHref("groups"),
              active: view === "groups",
              count: hierarchy ? hierarchy.attention.expired + hierarchy.attention.duplicates + hierarchy.attention.unverified || null : null,
              tone: "bad",
            },
          ]}
        />
      ) : null}

      {visibleClients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No businesses yet"
          description={
            connectionId
              ? "Sync profiles. We will create one business per Google organisation and put every location under it."
              : isManager(role)
                ? "Connect a Google account in Settings first, then sync profiles."
                : "An owner needs to connect Google before locations show up here."
          }
        >
          {!connectionId && isManager(role) ? (
            <Button nativeButton={false} render={<Link href="/settings?section=integrations" />}>
              Connect Google
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      {view === "businesses" && board && visibleClients.length > 0 ? (
        board.businesses.length > 0 ? (
          <LocationBusinessCards businesses={board.businesses} canManage={allows(role, "manage_locations")} />
        ) : (
          <EmptyState
            bare
            icon={Building2}
            title="No locations in this place"
            description="Choose all businesses in the sidebar to see every business."
          />
        )
      ) : null}

      {view === "groups" && hierarchy ? (
        <>
          <div className="flex flex-wrap items-center gap-2" aria-label="Connection health">
            {hierarchy.attention.expired > 0 ? (
              <Badge variant="bad" render={<Link href="/locations?attention=expired" />}>
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {hierarchy.attention.expired.toLocaleString("en-US")} with access expired
              </Badge>
            ) : null}
            {hierarchy.attention.unverified > 0 ? (
              <Badge variant="warn" render={<Link href="/locations?attention=unverified" />}>
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {plural(hierarchy.attention.unverified, "verification hold", "verification holds")}
              </Badge>
            ) : null}
            {hierarchy.attention.duplicates > 0 ? (
              <Badge variant="warn" render={<Link href="/locations?attention=duplicate" />}>
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {plural(hierarchy.attention.duplicates, "possible duplicate", "possible duplicates")}
              </Badge>
            ) : null}
            {hierarchy.attention.expired + hierarchy.attention.duplicates + hierarchy.attention.unverified === 0 ? (
              <Badge variant="ok">
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                No connection problems
              </Badge>
            ) : null}
            <span className="text-xs text-ink-3">Groups appear in the sidebar place picker.</span>
          </div>
          {visibleClients.length > 0 || hierarchy.loose.length > 0 ? (
            <HierarchyBoardLoader
              canManage={allows(role, "manage_locations")}
              canEditRules={allows(role, "edit_rules") && !workspaceGrant(role, "manage_locations")}
              brands={visibleClients.map((client) => ({ id: client.id, name: client.name, count: locationCountFor(client) }))}
              tree={hierarchy}
            />
          ) : null}
        </>
      ) : null}

      {showUnassigned ? (
        <div id="unassigned" className="scroll-mt-20">
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
        </div>
      ) : null}
    </div>
  );
}
