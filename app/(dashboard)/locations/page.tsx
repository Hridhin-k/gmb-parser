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
  const showUnassigned = !allowedClientIds && unassignedLocations.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Locations"
        description={
          visibleClients.length > 0
            ? `${plural(visibleClients.length, "business", "businesses")} · ${plural(totalLocations, "location", "locations")} · ${plural(groupCount, "group", "groups")}. Structure, Google connections and verification holds. Groups appear in the scope bar on Overview, Reviews and Analytics.`
            : "Organise Google profiles into businesses and groups. Groups appear in the scope bar on Overview, Reviews and Analytics."
        }
      >
        {connectionId && canSync ? (
          <SyncLocationsButton connectionId={connectionId} />
        ) : connectionId || !isManager(role) ? null : (
          <Button nativeButton={false} render={<Link href="/settings" />}>
            Connect Google
          </Button>
        )}
      </PageHeader>

      {visibleClients.length > 0 ? (
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
          {attentionTotal === 0 ? (
            <Badge variant="ok">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              No connection problems
            </Badge>
          ) : null}
          {showUnassigned ? (
            <Badge variant="info" render={<a href="#unassigned" />}>
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              {plural(unassignedLocations.length, "unassigned profile", "unassigned profiles")}
            </Badge>
          ) : null}
          <span className="text-xs text-ink-3">The scope bar doesn’t filter this page; use the structure and search.</span>
        </div>
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
            <Button nativeButton={false} render={<Link href="/settings" />}>
              Connect Google
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      {visibleClients.length > 0 || hierarchy.loose.length > 0 ? (
        <HierarchyBoardLoader
          canManage={allows(role, "manage_locations")}
          canEditRules={allows(role, "edit_rules") && !workspaceGrant(role, "manage_locations")}
          brands={visibleClients.map((client) => ({ id: client.id, name: client.name, count: locationCountFor(client) }))}
          tree={hierarchy}
        />
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
