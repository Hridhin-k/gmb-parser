import { Download } from "lucide-react";
import { AnalyticsBoard, ANALYTICS_SECTIONS, type AnalyticsSection } from "@/components/analytics-board";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { PageHeader } from "@/components/page-header";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { getMemberAccess } from "@/lib/services/access";
import { clampListScope } from "@/lib/access";
import { getActiveWorkspace } from "@/lib/services/session";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { validateFilterString } from "@/lib/validation";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "6m";
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const range = parseDateRange(params, DEFAULT_RANGE);
  const access = await getMemberAccess(user.id, workspaceId);
  const bounded = clampListScope(
    {
      clientId: UUID.test(validateFilterString(params.client)) ? validateFilterString(params.client) : "",
      groupId: UUID.test(validateFilterString(params.group)) ? validateFilterString(params.group) : "",
      locationId: UUID.test(validateFilterString(params.location)) ? validateFilterString(params.location) : "",
    },
    access?.scope ?? { clientId: null, groupId: null, locationId: null }
  );
  const clientId = bounded.clientId || null;
  const groupId = bounded.groupId || null;
  const locationId = bounded.locationId || null;
  const requested = typeof params.section === "string" ? params.section : "performance";
  const section = ANALYTICS_SECTIONS.some((item) => item.id === requested)
    ? (requested as AnalyticsSection)
    : "performance";

  const [loaded, roster] = await Promise.all([
    getDashboardContext(workspaceId, range, { clientId, groupId, locationId }),
    getWorkspaceRoster(workspaceId),
  ]);
  const locationsInScope = loaded.locations.filter((location) => {
    if (locationId) return location.id === locationId;
    if (groupId) return location.groupId === groupId || location.parentGroupId === groupId;
    if (clientId) return location.clientId === clientId;
    return true;
  });
  const clientIdsInScope = new Set(locationsInScope.flatMap((location) => (location.clientId ? [location.clientId] : [])));
  const context = {
    ...loaded,
    clients: loaded.clients.filter((client) => (clientId ? client.id === clientId : !groupId && !locationId ? true : clientIdsInScope.has(client.id))),
    groups: loaded.groups.filter((group) => (groupId ? group.id === groupId : true)),
    locations: locationsInScope,
  };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: clientId ?? "",
    group: groupId ?? "",
    location: locationId ?? "",
    ...dateRangeParams(range, DEFAULT_RANGE),
  })) {
    if (value) query.set(key, value);
  }
  const exportParams = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientId) exportParams.set("client", clientId);
  if (locationId) exportParams.set("location", locationId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="The same review totals as Overview, split into performance, themes, profile, automation, and team."
      >
        <a
          href={`/api/reviews/export?${exportParams.toString()}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-silver bg-white px-4 text-sm font-medium text-navy hover:border-action-blue hover:bg-info-banner-bg"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export CSV
        </a>
      </PageHeader>
      <TransitionScope>
        <AnalyticsFilters
          range={{ key: range.key, from: range.from, to: range.to }}
          defaultRange={DEFAULT_RANGE}
          clientId={clientId ?? ""}
          clients={context.clients}
          groupId={groupId ?? ""}
          groups={context.groups}
          locationId={locationId ?? ""}
          locations={context.locations.map((location) => ({
            id: location.id,
            clientId: location.clientId ?? "",
            groupId: location.groupId,
            parentGroupId: location.parentGroupId,
            name: location.name,
          }))}
          hideClient
          hideRange
        />
        <PendingRegion label="Recalculating analytics…" className="mt-6">
          <AnalyticsBoard
            context={context}
            range={range}
            scope={{ clientId, groupId, locationId }}
            section={section}
            members={roster.members.map((member) => ({ userId: member.userId, email: member.email }))}
            query={query.toString()}
          />
        </PendingRegion>
      </TransitionScope>
    </div>
  );
}
