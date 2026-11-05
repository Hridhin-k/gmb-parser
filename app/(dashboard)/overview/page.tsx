import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import {
  KpiTiles,
  LocationsCard,
  NeedsYouStrip,
  RecentNotifications,
  StarCard,
  ThemesCard,
  TodayHeader,
  VolumeCard,
} from "@/components/today/today-sections";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { dateRangeParams } from "@/lib/date-range";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { insightTopicLabel } from "@/lib/insight-dashboard";
import { reviewDrillHref } from "@/lib/metrics";
import { buildOverviewBoard, overviewQueryKey, type BoardPlace } from "@/lib/overview-board";
import { workspaceDateRange } from "@/lib/services/date-range";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { loadOverviewSignals } from "@/lib/services/overview";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getShellSummary } from "@/lib/services/shell-summary";
import { loadNeedsYouExtras, loadTodayDays } from "@/lib/services/today";
import { canOpenPath, isManager, shellAlerts } from "@/lib/shell";
import {
  buildKpis,
  buildLocationTable,
  buildNeedsYou,
  buildThemes,
  greeting,
  longDate,
  niceMax,
  shortDay,
  sparkSeries,
  TODAY_DEFAULT_RANGE,
  TODAY_RANGE_PRESETS,
  volumeDays,
} from "@/lib/today";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Newest Google sync older than this reads as stale. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const BANNER_LAYOUT = "max-sm:[&>div+div]:basis-full max-sm:[&>div+div]:pl-[26px]";

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function href(path: string, values: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const now = new Date();
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
  const { clientId, groupId, locationId } = resolved;
  const scope = { clientId, groupId, locationId };
  const scoped = { client: clientId, group: groupId, location: locationId };
  const range = await workspaceDateRange(workspaceId, params, TODAY_DEFAULT_RANGE, now, locationId);
  const rangeQuery = { range: range.key, ...dateRangeParams(range, "all") };
  const start = range.start?.toISOString() ?? null;
  const end = range.end?.toISOString() ?? null;

  const [loaded, signals, insights, summary, extras] = await Promise.all([
    getDashboardContext(workspaceId, range, scope),
    loadOverviewSignals(workspaceId, resolved.locationIds, range),
    loadInsightDashboard(workspaceId, { locationIds: resolved.locationIds, start, end }),
    getShellSummary(workspaceId, null, resolved.locationIds, user.id),
    loadNeedsYouExtras(workspaceId, resolved.locationIds, now),
  ]);
  const timeZone = loaded.timezone;

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
  const insightsHref = href("/insights", { ...scoped, ...rangeQuery });
  const board = buildOverviewBoard({
    facts: loaded.facts,
    previous: loaded.previous,
    places: boardPlaces,
    complaints: signals.complaints,
    topics: insights.aggregates.negative,
    praise: insights.aggregates.positive,
    periodLabel: range.label,
    coverage: { analysed: insights.counts.alreadyAnalysed, ratingOnly: insights.counts.ratingOnly },
    links: {
      reviews,
      escalations: (extra) => href("/reviews", { ...scoped, tab: "follow-ups", ...extra }),
      location: (place) => href("/overview", { client: place.clientId, location: place.id, ...rangeQuery }),
      analytics: insightsHref,
      insights: insightsHref,
      reports: insightsHref,
      settings: "/settings",
    },
    attention: [],
  });

  // "Needs you" counts are everything waiting now, not just this period.
  const tasks = buildNeedsYou(
    {
      unhappyUnreplied: extras.unhappyUnreplied,
      oldestUnhappyAt: extras.oldestUnhappyAt,
      followUps: summary.escalations,
      overdueFollowUps: extras.overdueFollowUps,
      nextFollowUpDue: extras.nextFollowUpDue,
      drafts: summary.drafts,
      failed: summary.failed,
    },
    {
      unhappy: href("/reviews", { ...scoped, filter: "unanswered", stars: "negative" }),
      "follow-ups": href("/reviews", { ...scoped, tab: "follow-ups" }),
      drafts: href("/reviews", { ...scoped, filter: "draft" }),
      failed: href("/reviews", { ...scoped, filter: "failed" }),
    },
    now,
    timeZone
  );
  const notices = shellAlerts(summary, role).filter((alert) => alert.id.startsWith("notice:"));

  const days = await loadTodayDays(workspaceId, resolved.locationIds, range, now, timeZone);
  const volume = volumeDays(days);
  const kpis = buildKpis(board.kpis, sparkSeries(days));
  const dayTotal = days.reduce((sum, day) => sum + day.reviews, 0);
  const lowDays = days.filter((day) => day.low > 0).length;
  const peak = Math.max(0, ...days.map((day) => day.reviews));
  const period = range.label.toLowerCase();
  const periodPhrase = range.key === "all" ? "across all time" : range.key === "today" ? "today" : `in the ${period}`;

  const clientNames = new Map(loaded.clients.map((client) => [client.id, client.name]));
  const earlier = new Map((loaded.previous?.locations ?? []).map((row) => [row.locationId, row]));
  const current = new Map(loaded.facts.locations.map((row) => [row.locationId, row]));
  const waiting = new Map(summary.profiles.map((profile) => [profile.id, profile.unreplied]));
  const businesses = new Set(boardPlaces.map((place) => place.clientId ?? ""));
  const table = buildLocationTable(
    boardPlaces.map((place) => ({
      id: place.id,
      name: place.name,
      clientId: place.clientId,
      reviews: current.get(place.id)?.reviews ?? 0,
      ratingSum: current.get(place.id)?.ratingSum ?? 0,
      previousReviews: earlier.get(place.id)?.reviews ?? 0,
      previousRatingSum: earlier.get(place.id)?.ratingSum ?? 0,
      unreplied: waiting.get(place.id) ?? 0,
    })),
    {
      group: !clientId && businesses.size > 1,
      businessName: (id) => (id ? clientNames.get(id) ?? null : null),
    }
  );

  const themes = buildThemes(board.praiseThemes, board.themes);
  const topComplaint = [...signals.complaints]
    .filter((row) => row.count > 0 && places.has(row.locationId))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))[0];
  const themeNote = topComplaint
    ? `${insightTopicLabel(topComplaint.topic)} came up ${topComplaint.count.toLocaleString("en-US")} ${topComplaint.count === 1 ? "time" : "times"}${
        boardPlaces.length > 1 ? ` at ${places.get(topComplaint.locationId)?.name}` : ""
      } ${periodPhrase}.`
    : null;

  const placeLabel = !clientId && resolved.level === "organisation" ? "All businesses" : resolved.title;
  const periodOptions: Array<{ key: string; label: string }> = [...TODAY_RANGE_PRESETS];
  if (!periodOptions.some((preset) => preset.key === range.key)) periodOptions.unshift({ key: range.key, label: range.label });
  const periods = periodOptions.map((preset) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "range" || key === "from" || key === "to" || key === "page") continue;
      const first = param(value);
      if (first) next.set(key, first);
    }
    next.set("range", preset.key);
    return {
      key: preset.key,
      label: preset.label,
      href: `/overview?${next.toString()}`,
      pressed: preset.key === range.key,
    };
  });
  const rendered = overviewQueryKey((key) => param(params[key]) || null);

  // Banners from data the page already has.
  const scopedPlaces = boardPlaces.map((place) => places.get(place.id)).filter((place) => place !== undefined);
  const syncTimes = scopedPlaces
    .map((place) => (place.lastSyncedAt ? Date.parse(place.lastSyncedAt) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  const neverSynced = scopedPlaces.filter((place) => !place.lastSyncedAt).length;
  const newestSync = syncTimes.length > 0 ? Math.max(...syncTimes) : null;
  const stale = newestSync !== null && now.getTime() - newestSync > STALE_AFTER_MS;
  const brokenConnections = loaded.expiredConnections + loaded.revokedConnections;
  const publishingPaused =
    loaded.pauses.workspace ||
    boardPlaces.some(
      (place) =>
        loaded.pauses.locationIds.includes(place.id) ||
        (place.clientId !== null && loaded.pauses.clientIds.includes(place.clientId))
    );
  const canOpenSettings = canOpenPath("/settings", role);
  const firstUse = board.kpis.reviews === 0 && (board.kpis.previousReviews ?? 0) === 0;

  return (
    <TransitionScope>
      <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
        <TodayHeader
          dateLine={`${longDate(now, timeZone)} · ${placeLabel}`}
          title={greeting(now, timeZone, user.name ?? user.user_metadata.full_name ?? user.user_metadata.name ?? null)}
          periods={periods}
        />
        {resolved.dropped ? (
          <Banner tone="info" title="That place is not available.">
            Showing {resolved.title}.
          </Banner>
        ) : null}
        {showSetup ? (
          <Banner
            className={BANNER_LAYOUT}
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
            className={BANNER_LAYOUT}
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
            className={BANNER_LAYOUT}
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
            className={BANNER_LAYOUT}
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
            className={BANNER_LAYOUT}
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
        <PendingRegion label="Updating the dashboard…">
          <FreshMetrics rendered={rendered} surface="overview">
            {boardPlaces.length === 0 ? (
              <EmptyState
                title="No locations in this scope yet"
                description="Import Google profiles and assign them to a business. The dashboard fills in once reviews sync."
              >
                <Button size="sm" nativeButton={false} render={<Link href="/locations" />}>
                  Open locations
                </Button>
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-5">
                <NeedsYouStrip tasks={tasks} startHref={href("/reviews", { ...scoped, filter: "unanswered" })} />
                {notices.length > 0 ? (
                  <RecentNotifications notices={notices} />
                ) : null}
                {firstUse ? (
                  <Banner
            className={BANNER_LAYOUT}
                    tone="info"
                    title="No reviews in this period yet."
                    actions={
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={reviews()} />}>
                        Open reviews
                      </Button>
                    }
                  >
                    Trends appear once reviews arrive. Pick a longer period above, or work from Reviews.
                  </Banner>
                ) : null}
                <KpiTiles kpis={kpis} />
                <div className="flex flex-wrap items-stretch gap-4">
                  <VolumeCard
                    interval={volume.interval}
                    days={volume.days.map((day) => ({
                      day: day.day,
                      label: shortDay(day.day),
                      reviews: day.reviews,
                      avgRating: day.reviews > 0 ? day.ratingSum / day.reviews : null,
                      low: day.low,
                    }))}
                    yMax={niceMax(volume.days.map((day) => day.reviews))}
                    caption={`${dayTotal.toLocaleString("en-US")} ${dayTotal === 1 ? "review" : "reviews"} ${periodPhrase} · ${lowDays.toLocaleString("en-US")} ${lowDays === 1 ? "day" : "days"} with a low rating`}
                    summary={`Bar chart of new reviews per ${volume.interval} over ${period}: ${dayTotal.toLocaleString("en-US")} in total, peak ${peak.toLocaleString("en-US")} in a day, ${lowDays.toLocaleString("en-US")} ${lowDays === 1 ? "day" : "days"} with a 1–2 star review.`}
                  />
                  <StarCard rows={board.starMix} average={board.kpis.avgRating} />
                </div>
                <div className="flex flex-wrap items-stretch gap-4">
                  <LocationsCard
                    table={table}
                    allHref="/locations"
                    unrepliedHref={(id) => href("/reviews", { client: places.get(id)?.clientId, location: id, filter: "unanswered" })}
                    placeHref={(id) => href("/overview", { client: places.get(id)?.clientId, location: id, ...rangeQuery })}
                  />
                  <ThemesCard
                    themes={themes}
                    note={themeNote}
                    insightsHref={insightsHref}
                    emptyText={
                      insights.counts.alreadyAnalysed > 0
                        ? "No themes stood out in this period."
                        : "No analysed review text in this period yet. Insights reads reviews to find what comes up."
                    }
                  />
                </div>
              </div>
            )}
          </FreshMetrics>
        </PendingRegion>
      </div>
    </TransitionScope>
  );
}
