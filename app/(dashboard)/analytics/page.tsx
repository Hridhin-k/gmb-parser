import { Suspense } from "react";
import { Download } from "lucide-react";
import { AnalyticsBoard } from "@/components/analytics-board";
import { ANALYTICS_SECTIONS, type AnalyticsSection } from "@/lib/analytics-sections";
import { analyticsSectionLoads } from "@/lib/analytics-section-loads";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { SectionLoading } from "@/components/section-loading";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange, type DateRange } from "@/lib/date-range";
import { emptyAnalyticsSlice, loadAnalyticsSlice } from "@/lib/services/analytics-slice";
import { emptyInsightDashboard } from "@/lib/insight-dashboard";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import type { AnalyticsCompare, RankBy, RankShow } from "@/lib/analytics-metrics";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveWorkspace } from "@/lib/services/session";
import { overviewQueryKey } from "@/lib/overview-board";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { type ResolvedScope } from "@/lib/scope";
import Link from "next/link";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

function sectionHref(query: string, section: AnalyticsSection): string {
  const params = new URLSearchParams(query);
  if (section === "performance") params.delete("section");
  else params.set("section", section);
  const text = params.toString();
  return text ? `/analytics?${text}` : "/analytics";
}

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

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: clientId ?? "",
    group: groupId ?? "",
    location: locationId ?? "",
    ...dateRangeParams(range, DEFAULT_RANGE),
    rankBy: rankBy === "rating" ? "" : rankBy,
    show: show === "locations" ? "" : show,
    compare: compare === "previous" ? "" : compare,
    section: section === "performance" ? "" : section,
  })) {
    if (value) query.set(key, value);
  }
  const exportParams = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientId) exportParams.set("client", clientId);
  if (groupId) exportParams.set("group", groupId);
  if (locationId) exportParams.set("location", locationId);
  const tabQuery = query.toString();

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

      <nav className="flex flex-wrap gap-2" aria-label="Analytics sections">
        {ANALYTICS_SECTIONS.map((item) => {
          const active = item.id === section;
          return (
            <Link
              key={item.id}
              href={sectionHref(tabQuery, item.id)}
              className={
                active
                  ? "inline-flex h-9 items-center rounded-full bg-[#163a7a] px-4 text-sm font-medium text-white"
                  : "inline-flex h-9 items-center rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
              }
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <TransitionScope>
        <PendingRegion label="Calculating review trends for the selected locations…">
          <FreshMetrics
            rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
            surface="analytics"
          >
            <Suspense fallback={<SectionLoading page="analytics" variant="charts" />}>
              <AnalyticsBoardSection
                workspaceId={workspaceId}
                resolved={resolved}
                range={range}
                section={section}
                rankBy={rankBy}
                show={show}
                compare={compare}
                query={tabQuery}
              />
            </Suspense>
          </FreshMetrics>
        </PendingRegion>
      </TransitionScope>
    </div>
  );
}

async function AnalyticsBoardSection({
  workspaceId,
  resolved,
  range,
  section,
  rankBy,
  show,
  compare,
  query,
}: {
  workspaceId: string;
  resolved: ResolvedScope;
  range: DateRange;
  section: AnalyticsSection;
  rankBy: RankBy;
  show: RankShow;
  compare: AnalyticsCompare;
  query: string;
}) {
  const clientId = resolved.clientId;
  const groupId = resolved.groupId;
  const locationId = resolved.locationId;
  const { needsSlice, needsInsights, needsRoster } = analyticsSectionLoads(section);

  const [loaded, roster, slice, insights] = await Promise.all([
    getDashboardContext(workspaceId, range, { clientId, groupId, locationId }),
    needsRoster
      ? getWorkspaceRoster(workspaceId)
      : Promise.resolve({ members: [] as Array<{ userId: string; email: string }> }),
    needsSlice
      ? loadAnalyticsSlice({
          workspaceId,
          locationIds: resolved.locationIds,
          start: range.start?.toISOString() ?? null,
          end: range.end?.toISOString() ?? null,
        })
      : Promise.resolve(emptyAnalyticsSlice()),
    needsInsights
      ? loadInsightDashboard(workspaceId, {
          locationIds: resolved.locationIds,
          start: range.start?.toISOString() ?? null,
          end: range.end?.toISOString() ?? null,
        })
      : Promise.resolve(emptyInsightDashboard()),
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
    clients: loaded.clients.filter((client) =>
      clientId ? client.id === clientId : !groupId && !locationId ? true : clientIdsInScope.has(client.id)
    ),
    groups: loaded.groups,
    locations: locationsInScope,
  };

  return (
    <AnalyticsBoard
      context={context}
      range={range}
      scope={{ clientId, groupId, locationId }}
      section={section}
      members={roster.members.map((member) => ({ userId: member.userId, email: member.email }))}
      query={query}
      slice={slice}
      insights={insights}
      rankBy={rankBy}
      show={show}
      compare={compare}
      hideSectionNav
    />
  );
}
