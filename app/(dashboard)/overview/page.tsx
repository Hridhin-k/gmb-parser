import Link from "next/link";
import { ClientOverviewView, type OverviewRecentChange } from "@/components/client-overview";
import { EmptyState } from "@/components/empty-state";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { scopeKindLabel } from "@/lib/ui/vocabulary";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { buildAttention, reviewDrillHref } from "@/lib/metrics";
import { buildOverviewBoard, overviewQueryKey, type BoardPlace } from "@/lib/overview-board";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { getLatestReportForScope, getReportByCacheKey, reportCacheKey } from "@/lib/services/insight-report";
import { loadOverviewSignals } from "@/lib/services/overview";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canOpenPath, isManager } from "@/lib/shell";
import { scopeSummary } from "@/lib/scope";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";
/** Newest Google sync older than this reads as stale. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Request-time check; server components render once per request. */
function isStale(syncedAtMs: number): boolean {
  return Date.now() - syncedAtMs > STALE_AFTER_MS;
}

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
  const start = range.start?.toISOString() ?? null;
  const end = range.end?.toISOString() ?? null;
  const insightScope = {
    locationIds: resolved.locationIds,
    clientId,
    groupId,
    locationId,
    start,
    end,
  };
  const [loaded, signals, insights, exactReport, latestReport] = await Promise.all([
    getDashboardContext(workspaceId, range, scope),
    loadOverviewSignals(workspaceId, resolved.locationIds, range),
    loadInsightDashboard(workspaceId, { locationIds: resolved.locationIds, start, end }),
    getReportByCacheKey(workspaceId, reportCacheKey(workspaceId, insightScope)),
    getLatestReportForScope(workspaceId, {
      clientId,
      groupId,
      locationId,
      locationIds: resolved.locationIds,
      rangeStart: start,
      rangeEnd: end,
    }),
  ]);
  const savedReport = [exactReport, latestReport].find(
    (row) => row && (row.status === "completed" || row.status === "partial")
  );
  const severeLead = insights.severeIncidents[0];

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
          focusFrom: signals.recentNegative.fromDay,
          focusTo: signals.recentNegative.toDay,
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

  // Banners from data the page already has.
  const scopedPlaces = boardPlaces.map((place) => places.get(place.id)).filter((place) => place !== undefined);
  const syncTimes = scopedPlaces
    .map((place) => (place.lastSyncedAt ? Date.parse(place.lastSyncedAt) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  const neverSynced = scopedPlaces.filter((place) => !place.lastSyncedAt).length;
  const newestSync = syncTimes.length > 0 ? Math.max(...syncTimes) : null;
  const stale = newestSync !== null && isStale(newestSync);
  const brokenConnections = loaded.expiredConnections + loaded.revokedConnections;
  const publishingPaused =
    loaded.pauses.workspace ||
    boardPlaces.some(
      (place) =>
        loaded.pauses.locationIds.includes(place.id) ||
        (place.clientId !== null && loaded.pauses.clientIds.includes(place.clientId))
    );
  const canOpenSettings = canOpenPath("/settings", role);
  const auditHref = canOpenPath("/audit", role) ? "/audit" : null;
  const firstUse = board.kpis.reviews === 0 && (board.kpis.previousReviews ?? 0) === 0;

  const placeName = (id: string) => places.get(id)?.name ?? "a location";
  const recent: OverviewRecentChange[] = [];
  const latestSynced = scopedPlaces
    .filter((place) => place.lastSyncedAt)
    .sort((a, b) => Date.parse(b.lastSyncedAt ?? "") - Date.parse(a.lastSyncedAt ?? ""));
  if (latestSynced[0]?.lastSyncedAt) {
    recent.push({
      id: "sync",
      tone: "ok",
      title: "Google sync",
      detail:
        latestSynced.length > 1
          ? `${latestSynced[0].name} and ${(latestSynced.length - 1).toLocaleString("en-US")} more synced`
          : `${latestSynced[0].name} synced`,
      at: latestSynced[0].lastSyncedAt,
    });
  }
  if (savedReport && typeof savedReport.finished_at === "string") {
    recent.push({
      id: "report",
      tone: "ai",
      title: "Insights report saved",
      detail: savedReport.status === "partial" ? "partial coverage" : "for this scope",
      at: savedReport.finished_at,
      href: board.insightsHref,
    });
  }
  if (signals.oldestOverdue) {
    recent.push({
      id: "overdue",
      tone: "bad",
      title: "Escalation passed its SLA",
      detail: placeName(signals.oldestOverdue.locationId),
      at: signals.oldestOverdue.dueAt,
      href: `${escalations({ queue: "past_sla" })}#case-${signals.oldestOverdue.id}`,
    });
  }
  if (signals.recentNegative) {
    recent.push({
      id: "negative",
      tone: "bad",
      title: `${signals.recentNegative.count.toLocaleString("en-US")} low-star reviews`,
      detail: `${placeName(signals.recentNegative.locationId)} in the last 48 hours`,
      at: `${signals.recentNegative.toDay}T12:00:00.000Z`,
      href: reviews({
        location: signals.recentNegative.locationId,
        stars: "low",
        focusFrom: signals.recentNegative.fromDay,
        focusTo: signals.recentNegative.toDay,
      }),
    });
  }
  recent.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const unrepliedByLocation = Object.fromEntries(
    loaded.facts.locations.map((row) => [row.locationId, row.unreplied])
  );
  const unanswered = reviews({ filter: "unanswered" });
  const scopeLine = [scopeKindLabel(summary.eyebrow), summary.title, summary.trail, range.label].filter(Boolean).join(" · ");

  return (
    <TransitionScope>
      <div className="space-y-4">
        <PageHeader title="Overview" description={scopeLine}>
          <Button variant="outline" nativeButton={false} render={<Link href={board.reportsHref} />}>
            Send digest
          </Button>
          <Button nativeButton={false} render={<Link href={board.kpis.unreplied > 0 ? unanswered : reviews()} />}>
            Open inbox
            {board.kpis.unreplied > 0 ? ` · ${board.kpis.unreplied.toLocaleString("en-US")}` : ""}
          </Button>
        </PageHeader>
        {resolved.dropped ? (
          <Banner tone="info" title="That place is not available.">
            Showing {resolved.title}.
          </Banner>
        ) : null}
        {showSetup ? (
          <Banner
            tone="info"
            title="Setup is not finished."
            actions={
              <Button size="sm" nativeButton={false} render={<Link href="/onboarding" />}>
                Continue setup
              </Button>
            }
          >
            Connect Google, import locations, confirm groups, set a reply tone, and invite the team.
          </Banner>
        ) : null}
        {brokenConnections > 0 ? (
          <Banner
            tone="bad"
            title={`${brokenConnections.toLocaleString("en-US")} Google ${brokenConnections === 1 ? "connection needs" : "connections need"} attention.`}
            actions={
              canOpenSettings ? (
                <Button size="sm" nativeButton={false} render={<Link href="/settings" />}>
                  Reconnect Google
                </Button>
              ) : undefined
            }
          >
            Expired or revoked access stops syncing, and replies can&apos;t publish for the affected locations.
            {canOpenSettings ? "" : " Ask a workspace owner or admin to reconnect."} Historical data stays readable.
          </Banner>
        ) : null}
        {stale && newestSync !== null ? (
          <Banner
            tone="warn"
            title={`Numbers are from ${formatFriendlyDateTime(new Date(newestSync).toISOString())}.`}
            actions={
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/locations" />}>
                Open locations
              </Button>
            }
          >
            No location in this scope has synced with Google in the last 24 hours. Figures below may be behind.
          </Banner>
        ) : null}
        {neverSynced > 0 && scopedPlaces.length > neverSynced ? (
          <Banner
            tone="warn"
            title={`Partial data: ${neverSynced.toLocaleString("en-US")} of ${scopedPlaces.length.toLocaleString("en-US")} locations have never synced.`}
            actions={
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/locations" />}>
                View locations
              </Button>
            }
          >
            Totals below leave out their reviews until the first sync finishes.
          </Banner>
        ) : null}
        {publishingPaused ? (
          <Banner
            tone="warn"
            title={loaded.pauses.workspace ? "Automatic replies are paused for this workspace." : "Automatic replies are paused for part of this scope."}
            actions={
              canOpenSettings ? (
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/settings" />}>
                  Open settings
                </Button>
              ) : undefined
            }
          >
            Reply rules will not send replies on their own. Replies you write or approve still work as usual.
          </Banner>
        ) : null}
        <PendingRegion label="Updating overview…">
          <FreshMetrics rendered={rendered} surface="overview">
            {boardPlaces.length === 0 ? (
              <EmptyState
                title="No locations in this scope yet"
                description="Import Google profiles and assign them to a business. The overview fills in once reviews sync."
              >
                <Button size="sm" nativeButton={false} render={<Link href="/locations" />}>
                  Open locations
                </Button>
              </EmptyState>
            ) : (
              <>
                {firstUse ? (
                  <Banner
                    tone="info"
                    title="No reviews in this period yet."
                    className="mb-4"
                    actions={
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={reviews()} />}>
                        Open inbox
                      </Button>
                    }
                  >
                    Trends appear once reviews arrive. Pick a longer period in the top bar, or work from the inbox.
                  </Banner>
                ) : null}
                <ClientOverviewView
                  board={board}
                  reviewsHref={reviews()}
                  negativeHref={reviews({ stars: "low" })}
                  unansweredHref={unanswered}
                  escalationsHref={escalations()}
                  lowUnansweredHref={reviews({ stars: "low", filter: "unanswered" })}
                  unrepliedByLocation={unrepliedByLocation}
                  recent={recent}
                  auditHref={auditHref}
                  hideLocationRanking={Boolean(locationId)}
                />
              </>
            )}
          </FreshMetrics>
        </PendingRegion>
      </div>
    </TransitionScope>
  );
}
