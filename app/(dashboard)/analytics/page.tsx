import { Download } from "lucide-react";
import { AnalyticsBoard } from "@/components/analytics-board";
import { ANALYTICS_SECTIONS, type AnalyticsSection } from "@/lib/analytics-sections";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { loadAnalyticsSlice } from "@/lib/services/analytics-slice";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import type { AnalyticsCompare, RankBy, RankShow } from "@/lib/analytics-metrics";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveWorkspace } from "@/lib/services/session";
import { overviewQueryKey } from "@/lib/overview-board";
import { getWorkspaceRoster } from "@/lib/services/workspace";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const range = parseDateRange(params, DEFAULT_RANGE);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientId = resolved.clientId;
  const groupId = resolved.groupId;
  const locationId = resolved.locationId;
  const rankBy: RankBy =
    params.rankBy === "reviews" || params.rankBy === "reply" || params.rankBy === "time" ? params.rankBy : "rating";
  const show: RankShow = params.show === "groups" ? "groups" : "locations";
  const compare: AnalyticsCompare = params.compare === "onboarding" ? "onboarding" : "previous";
  const requested = typeof params.section === "string" ? params.section : "performance";
  const section = ANALYTICS_SECTIONS.some((item) => item.id === requested)
    ? (requested as AnalyticsSection)
    : "performance";

  const [loaded, roster, slice, insights] = await Promise.all([
    getDashboardContext(workspaceId, range, { clientId, groupId, locationId }),
    getWorkspaceRoster(workspaceId),
    loadAnalyticsSlice({
      workspaceId,
      locationIds: resolved.locationIds,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    }),
    loadInsightDashboard(workspaceId, {
      locationIds: resolved.locationIds,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    }),
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
    groups: loaded.groups,
    locations: locationsInScope,
  };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: clientId ?? "",
    group: groupId ?? "",
    location: locationId ?? "",
    ...dateRangeParams(range, DEFAULT_RANGE),
    rankBy: rankBy === "rating" ? "" : rankBy,
    show: show === "locations" ? "" : show,
    compare: compare === "previous" ? "" : compare,
  })) {
    if (value) query.set(key, value);
  }
  const exportParams = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientId) exportParams.set("client", clientId);
  if (groupId) exportParams.set("group", groupId);
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
        <PendingRegion label="Calculating review trends for the selected locations…" className="mt-6">
          <FreshMetrics
            rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
            surface="analytics"
          >
          <AnalyticsBoard
            context={context}
            range={range}
            scope={{ clientId, groupId, locationId }}
            section={section}
            members={roster.members.map((member) => ({ userId: member.userId, email: member.email }))}
            query={query.toString()}
            slice={slice}
            insights={insights}
            rankBy={rankBy}
            show={show}
            compare={compare}
          />
          </FreshMetrics>
        </PendingRegion>
      </TransitionScope>
    </div>
  );
}
