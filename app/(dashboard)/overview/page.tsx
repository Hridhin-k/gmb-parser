import Link from "next/link";
import { ClientOverviewView } from "@/components/client-overview";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { buildAttention, reviewDrillHref } from "@/lib/metrics";
import { buildOverviewBoard, overviewQueryKey, type BoardPlace } from "@/lib/overview-board";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { loadOverviewSignals } from "@/lib/services/overview";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { scopeSummary } from "@/lib/scope";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const [resolved, gate] = await Promise.all([
    readPageScope(user.id, workspaceId, params),
    getOnboardingGate(workspaceId),
  ]);
  const showSetup =
    isManager(role) && !gate.completed && (gate.started || (gate.connections === 0 && gate.locations === 0));
  const clientId = resolved.clientId;
  const groupId = resolved.groupId;
  const locationId = resolved.locationId;
  const range = parseDateRange(params, DEFAULT_RANGE);
  const scope = { clientId, groupId, locationId };
  const [loaded, signals, insights] = await Promise.all([
    getDashboardContext(workspaceId, range, scope),
    loadOverviewSignals(workspaceId, resolved.locationIds, range),
    loadInsightDashboard(workspaceId, {
      locationIds: resolved.locationIds,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    }),
  ]);

  const places = new Map(loaded.locations.map((location) => [location.id, location]));
  const groupNames = new Map(loaded.groups.map((group) => [group.id, group.name]));
  const boardPlaces: BoardPlace[] = loaded.locations
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

  const heldLocations = boardPlaces.filter((place) => places.get(place.id)?.holdReason).length;
  const inactiveLocations = boardPlaces.filter((place) => places.get(place.id)?.isActive === false).length;
  const attention = buildAttention({
    facts: loaded.facts,
    expiredConnections: loaded.expiredConnections,
    revokedConnections: loaded.revokedConnections,
    heldLocations,
    inactiveLocations,
    href: reviews,
    escalationHref: escalations({ queue: "past_sla" }),
  });
  if (signals.oldestOverdue) {
    const place = places.get(signals.oldestOverdue.locationId);
    attention.unshift({
      id: "oldest-overdue",
      title: "Oldest escalation past SLA",
      detail: place ? place.name : "Open the case",
      href: `${escalations({ queue: "past_sla" })}#case-${signals.oldestOverdue.id}`,
    });
  }
  if (signals.recentNegative) {
    const place = places.get(signals.recentNegative.locationId);
    if (place) {
      attention.unshift({
        id: "recent-negative",
        title: `${signals.recentNegative.count.toLocaleString("en-US")} reviews of 1–3 stars in 48 hours`,
        detail: `${place.name}. The inbox opens the calendar days covering that window.`,
        href: reviews({
          location: place.id,
          stars: "low",
          range: "custom",
          from: signals.recentNegative.fromDay,
          to: signals.recentNegative.toDay,
        }),
      });
    }
  }

  const board = buildOverviewBoard({
    facts: loaded.facts,
    previous: loaded.previous,
    places: boardPlaces,
    complaints: signals.complaints,
    topics: insights.aggregates.negative,
    coverage: {
      analysed: insights.counts.alreadyAnalysed,
      ratingOnly: insights.counts.ratingOnly,
    },
    links: {
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
    },
    attention,
  });

  const summary = scopeSummary(resolved);
  const rendered = overviewQueryKey((key) => param(params[key]) || null);
  return (
    <TransitionScope>
      <div className="space-y-4">
        <PageHeader
          title="Overview"
          description={[summary.eyebrow, summary.title, summary.trail].filter(Boolean).join(" · ")}
        >
          <Link
            href={board.reportsHref}
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
            <ClientOverviewView
              board={board}
              reviewsHref={reviews()}
              negativeHref={reviews({ stars: "low" })}
              unansweredHref={reviews({ filter: "unanswered" })}
              escalationsHref={escalations()}
            />
          </FreshMetrics>
        </PendingRegion>
      </div>
    </TransitionScope>
  );
}
