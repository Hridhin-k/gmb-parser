import { Suspense } from "react";
import Link from "next/link";
import {
  OverviewAiInsightPanel,
  OverviewMetricsPanel,
  OverviewOutletsPanel,
} from "@/components/client-overview";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { SectionLoading } from "@/components/section-loading";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange, type DateRange } from "@/lib/date-range";
import { buildAttention, EMPTY_FACTS, reviewDrillHref } from "@/lib/metrics";
import {
  buildOverviewBoard,
  overviewQueryKey,
  type BoardLinks,
  type BoardPlace,
} from "@/lib/overview-board";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { getLatestReportForScope, getReportByCacheKey, reportCacheKey } from "@/lib/services/insight-report";
import { loadOverviewSignals } from "@/lib/services/overview";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { scopeSummary, type ResolvedScope } from "@/lib/scope";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function overviewLinks(resolved: ResolvedScope, range: DateRange): BoardLinks {
  const { clientId, groupId, locationId } = resolved;
  const scope = { clientId, groupId, locationId };
  const reviews = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);
  const escalations = (extra?: Record<string, string>) => {
    const query = new URLSearchParams({ ...dateRangeParams(range, "all"), ...extra });
    if (clientId) query.set("client", clientId);
    if (groupId) query.set("group", groupId);
    if (locationId) query.set("location", locationId);
    const qs = query.toString();
    return qs ? `/escalations?${qs}` : "/escalations";
  };
  const reports = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientId) reports.set("client", clientId);
  if (groupId) reports.set("group", groupId);
  if (locationId) reports.set("location", locationId);
  const analytics = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
  if (clientId) analytics.set("client", clientId);
  if (groupId) analytics.set("group", groupId);
  if (locationId) analytics.set("location", locationId);
  const insightParams = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
  if (clientId) insightParams.set("client", clientId);
  if (groupId) insightParams.set("group", groupId);
  if (locationId) insightParams.set("location", locationId);
  return {
    reviews,
    escalations,
    location: (place) => {
      const query = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
      if (place.clientId) query.set("client", place.clientId);
      query.set("location", place.id);
      const qs = query.toString();
      return qs ? `/overview?${qs}` : "/overview";
    },
    analytics: analytics.size ? `/analytics?${analytics.toString()}` : "/analytics",
    insights: insightParams.size ? `/insights?${insightParams.toString()}` : "/insights",
    reports: reports.size ? `/reports?${reports.toString()}` : "/reports",
    settings: "/settings",
  };
}

function boardPlacesFromContext(
  loaded: Awaited<ReturnType<typeof getDashboardContext>>,
  resolved: ResolvedScope
): BoardPlace[] {
  const { clientId, groupId, locationId } = resolved;
  const groupNames = new Map(loaded.groups.map((group) => [group.id, group.name]));
  return loaded.locations
    .filter((location) => {
      if (locationId) return location.id === locationId;
      if (groupId) return location.groupId === groupId || location.parentGroupId === groupId;
      if (clientId) return location.clientId === clientId;
      return true;
    })
    .map((location) => ({
      id: location.id,
      name: location.name,
      clientId: location.clientId,
      groupName: location.groupId ? groupNames.get(location.groupId) ?? null : null,
    }));
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const [resolved, gate] = await Promise.all([
    readPageScope(user.id, workspaceId, params),
    isManager(role) ? getOnboardingGate(workspaceId) : Promise.resolve(null),
  ]);
  const showSetup = gate
    ? !gate.completed && (gate.started || (gate.connections === 0 && gate.locations === 0))
    : false;
  const range = parseDateRange(params, DEFAULT_RANGE);
  const summary = scopeSummary(resolved);
  const rendered = overviewQueryKey((key) => param(params[key]) || null);
  const links = overviewLinks(resolved, range);

  return (
    <TransitionScope>
      <div className="space-y-4">
        <PageHeader
          title="Overview"
          description={[summary.eyebrow, summary.title, summary.trail, range.label].filter(Boolean).join(" · ")}
        >
          <Link
            href={links.reports}
            className="inline-flex h-9 items-center rounded-full bg-[#163a7a] px-4 text-sm font-medium text-white hover:bg-[#0f2c5e]"
          >
            Send digest
          </Link>
        </PageHeader>
        {resolved.dropped ? (
          <p className="text-sm text-slate" role="status">
            That place is not available. Showing {resolved.title}.
          </p>
        ) : null}
        {showSetup ? (
          <p className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-3 text-sm text-graphite">
            <Link href="/onboarding" className="font-medium text-ink underline underline-offset-4">
              Continue setup
            </Link>{" "}
            to connect Google, import locations, confirm groups, set a reply tone, and invite the team.
          </p>
        ) : null}
        <PendingRegion label="Updating overview…">
          <FreshMetrics rendered={rendered} surface="overview">
            <div className="space-y-4">
              <Suspense fallback={<SectionLoading page="overview" variant="tiles" />}>
                <OverviewMetricsSection workspaceId={workspaceId} resolved={resolved} range={range} links={links} />
              </Suspense>
              <Suspense fallback={<SectionLoading page="overview" variant="panel" title="Loading AI insight…" detail="Reading analysed themes and any saved report for this scope." />}>
                <OverviewInsightSection workspaceId={workspaceId} resolved={resolved} range={range} links={links} />
              </Suspense>
              <Suspense fallback={<SectionLoading page="overview" variant="rows" title="Loading outlets…" detail="Ranking locations and listing what needs attention." />}>
                <OverviewOutletsSection workspaceId={workspaceId} resolved={resolved} range={range} links={links} />
              </Suspense>
            </div>
          </FreshMetrics>
        </PendingRegion>
      </div>
    </TransitionScope>
  );
}

async function OverviewMetricsSection({
  workspaceId,
  resolved,
  range,
  links,
}: {
  workspaceId: string;
  resolved: ResolvedScope;
  range: DateRange;
  links: BoardLinks;
}) {
  const scope = { clientId: resolved.clientId, groupId: resolved.groupId, locationId: resolved.locationId };
  const loaded = await getDashboardContext(workspaceId, range, scope);
  const board = buildOverviewBoard({
    facts: loaded.facts,
    previous: loaded.previous,
    places: boardPlacesFromContext(loaded, resolved),
    complaints: [],
    topics: [],
    coverage: { analysed: 0, ratingOnly: 0 },
    links,
    attention: [],
    periodLabel: range.label,
  });
  return (
    <OverviewMetricsPanel
      board={board}
      reviewsHref={links.reviews()}
      negativeHref={links.reviews({ stars: "low" })}
      unansweredHref={links.reviews({ filter: "unanswered" })}
      escalationsHref={links.escalations()}
    />
  );
}

async function OverviewInsightSection({
  workspaceId,
  resolved,
  range,
  links,
}: {
  workspaceId: string;
  resolved: ResolvedScope;
  range: DateRange;
  links: BoardLinks;
}) {
  const start = range.start?.toISOString() ?? null;
  const end = range.end?.toISOString() ?? null;
  const insightScope = {
    locationIds: resolved.locationIds,
    clientId: resolved.clientId,
    groupId: resolved.groupId,
    locationId: resolved.locationId,
    start,
    end,
  };
  const [insights, exactReport] = await Promise.all([
    loadInsightDashboard(workspaceId, { locationIds: resolved.locationIds, start, end }),
    getReportByCacheKey(workspaceId, reportCacheKey(workspaceId, insightScope)),
  ]);
  const exactUsable =
    exactReport && (exactReport.status === "completed" || exactReport.status === "partial")
      ? exactReport
      : null;
  const latestReport = exactUsable
    ? null
    : await getLatestReportForScope(workspaceId, {
        clientId: resolved.clientId,
        groupId: resolved.groupId,
        locationId: resolved.locationId,
        locationIds: resolved.locationIds,
        rangeStart: start,
        rangeEnd: end,
      });
  const savedReport =
    exactUsable ??
    (latestReport && (latestReport.status === "completed" || latestReport.status === "partial")
      ? latestReport
      : null);
  const severeLead = insights.severeIncidents[0];

  const board = buildOverviewBoard({
    facts: EMPTY_FACTS,
    previous: null,
    places: [],
    complaints: [],
    topics: insights.aggregates.negative,
    praise: insights.aggregates.positive,
    staff: insights.aggregates.staffPraise,
    severeCount: insights.severeCount,
    severeExcerpt: severeLead?.evidenceExcerpt ?? null,
    severeStars: severeLead ? severeLead.starRating : null,
    reportInsights: savedReport?.insights ?? null,
    reportStatus: savedReport ? String(savedReport.status) : null,
    reportFinishedAt: typeof savedReport?.finished_at === "string" ? savedReport.finished_at : null,
    periodLabel: range.label,
    coverage: {
      analysed: insights.counts.alreadyAnalysed,
      ratingOnly: insights.counts.ratingOnly,
    },
    links,
    attention: [],
  });

  return <OverviewAiInsightPanel board={board} />;
}

async function OverviewOutletsSection({
  workspaceId,
  resolved,
  range,
  links,
}: {
  workspaceId: string;
  resolved: ResolvedScope;
  range: DateRange;
  links: BoardLinks;
}) {
  const scope = { clientId: resolved.clientId, groupId: resolved.groupId, locationId: resolved.locationId };
  const [loaded, signals] = await Promise.all([
    getDashboardContext(workspaceId, range, scope),
    loadOverviewSignals(workspaceId, resolved.locationIds, range),
  ]);
  const places = boardPlacesFromContext(loaded, resolved);
  const placeMap = new Map(loaded.locations.map((location) => [location.id, location]));
  const heldLocations = places.filter((place) => placeMap.get(place.id)?.holdReason).length;
  const inactiveLocations = places.filter((place) => placeMap.get(place.id)?.isActive === false).length;
  const attention = buildAttention({
    facts: loaded.facts,
    expiredConnections: loaded.expiredConnections,
    revokedConnections: loaded.revokedConnections,
    heldLocations,
    inactiveLocations,
    href: links.reviews,
    escalationHref: links.escalations({ queue: "past_sla" }),
  });
  if (signals.oldestOverdue) {
    const place = placeMap.get(signals.oldestOverdue.locationId);
    attention.unshift({
      id: "oldest-overdue",
      title: "Oldest escalation past SLA",
      detail: place ? place.name : "Open the case",
      href: `${links.escalations({ queue: "past_sla" })}#case-${signals.oldestOverdue.id}`,
    });
  }
  if (signals.recentNegative) {
    const place = placeMap.get(signals.recentNegative.locationId);
    if (place) {
      attention.unshift({
        id: "recent-negative",
        title: `${signals.recentNegative.count.toLocaleString("en-US")} reviews of 1–3 stars in 48 hours`,
        detail: `${place.name}. The inbox opens the calendar days covering that window.`,
        href: links.reviews({
          location: place.id,
          stars: "low",
          focusFrom: signals.recentNegative.fromDay,
          focusTo: signals.recentNegative.toDay,
        }),
      });
    }
  }

  const board = buildOverviewBoard({
    facts: loaded.facts,
    previous: loaded.previous,
    places,
    complaints: signals.complaints,
    topics: [],
    coverage: { analysed: 0, ratingOnly: 0 },
    links,
    attention,
    periodLabel: range.label,
  });

  return <OverviewOutletsPanel board={board} />;
}
