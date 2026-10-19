import Link from "next/link";
import { Suspense } from "react";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { ClientOverviewView } from "@/components/client-overview";
import { PageHeader } from "@/components/page-header";
import { ScopeInsightPanel } from "@/components/scope-insight-panel";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import {
  average,
  buildAttention,
  buildInsights,
  reviewDrillHref,
  reviewWindow,
} from "@/lib/metrics";
import { themeLabel } from "@/lib/review-inbox";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { buildClientOverview, listNewestReviews, type OverviewTrendMonth } from "@/lib/services/overview";
import { ScopeInsightService } from "@/lib/services/scope-insights";
import { getOnboardingGate } from "@/lib/services/onboarding";
import { getMemberAccess } from "@/lib/services/access";
import { clampListScope } from "@/lib/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { validateFilterString } from "@/lib/validation";

interface OverviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RANGE = "12m";

function analyticsHref(
  range: ReturnType<typeof parseDateRange>,
  scope: { clientId: string | null; groupId: string | null; locationId: string | null }
) {
  const params = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
  if (scope.clientId) params.set("client", scope.clientId);
  if (scope.groupId) params.set("group", scope.groupId);
  if (scope.locationId) params.set("location", scope.locationId);
  const qs = params.toString();
  return qs ? `/analytics?${qs}` : "/analytics";
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const gate = await getOnboardingGate(workspaceId);
  const showSetup =
    isManager(role) && !gate.completed && (gate.started || (gate.connections === 0 && gate.locations === 0));
  const clientParam = validateFilterString(params.client);
  const groupParam = validateFilterString(params.group);
  const locationParam = validateFilterString(params.location);
  const access = await getMemberAccess(user.id, workspaceId);
  const bounded = clampListScope(
    {
      clientId: UUID.test(clientParam) ? clientParam : "",
      groupId: UUID.test(groupParam) ? groupParam : "",
      locationId: UUID.test(locationParam) ? locationParam : "",
    },
    access?.scope ?? { clientId: null, groupId: null, locationId: null }
  );
  const clientId = bounded.clientId || null;
  const groupId = bounded.groupId || null;
  const locationId = bounded.locationId || null;
  const range = parseDateRange(params, DEFAULT_RANGE);
  const loaded = await getDashboardContext(workspaceId, range, { clientId, groupId, locationId });
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

  const names = new Map(context.locations.map((location) => [location.id, location]));
  const scopeLocations = context.locations.filter(
    (location) =>
      (!clientId || location.clientId === clientId) &&
      (!groupId || location.groupId === groupId) &&
      (!locationId || location.id === locationId)
  );
  const months: OverviewTrendMonth[] = context.facts.months.map((month) => ({
    month: month.month,
    reviewCount: month.reviews,
    avgRating: average(month.ratingSum, month.reviews),
    negative: month.negative,
    positive: month.positive,
    replied: month.replied,
  }));
  const previousMonths: OverviewTrendMonth[] | null = context.previous
    ? context.previous.months.map((month) => ({
        month: month.month,
        reviewCount: month.reviews,
        avgRating: average(month.ratingSum, month.reviews),
        negative: month.negative,
        positive: month.positive,
        replied: month.replied,
      }))
    : null;

  const data = buildClientOverview({
    clientId,
    expiredConnections: 0,
    months,
    previousMonths,
    stats: [],
    locations: scopeLocations.map((location) => ({
      id: location.id,
      clientId: location.clientId,
      clientName: context.clients.find((client) => client.id === location.clientId)?.name ?? null,
      name: location.name,
      isActive: location.isActive,
    })),
    insights: [],
    clients: context.clients,
  });
  data.current = {
    ...reviewWindow(context.facts),
    reviewCount: context.facts.reviews,
    unreplied: context.facts.unreplied,
  };
  data.previous = context.previous
    ? {
        ...reviewWindow(context.previous),
        reviewCount: context.previous.reviews,
        unreplied: context.previous.unreplied,
      }
    : null;

  const scope = { clientId, groupId, locationId };
  const href = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);
  const escalationParams = new URLSearchParams({
    queue: "past_sla",
    ...dateRangeParams(range, "all"),
  });
  if (clientId) escalationParams.set("client", clientId);
  if (groupId) escalationParams.set("group", groupId);
  if (locationId) escalationParams.set("location", locationId);

  data.attention = buildAttention({
    facts: context.facts,
    expiredConnections: context.expiredConnections,
    revokedConnections: context.revokedConnections,
    heldLocations: scopeLocations.filter((location) => location.holdReason).length,
    inactiveLocations: scopeLocations.filter((location) => !location.isActive).length,
    href,
    escalationHref: `/escalations?${escalationParams.toString()}`,
  });

  const clientName = context.clients.find((client) => client.id === clientId)?.name;
  const groupName = context.groups.find((group) => group.id === groupId)?.name;
  const locationName = locationId ? names.get(locationId)?.name : null;
  const scopeLabel = [clientName, groupName, locationName].filter(Boolean).join(" · ") || "All brands";
  const lowest = [...context.facts.locations]
    .filter((row) => row.reviews > 0 && names.has(row.locationId))
    .sort(
      (a, b) =>
        a.ratingSum / a.reviews - b.ratingSum / b.reviews || b.reviews - a.reviews
    )
    .slice(0, 5)
    .map((row) => {
      const location = names.get(row.locationId)!;
      return {
        id: row.locationId,
        name: location.name,
        clientName: context.clients.find((client) => client.id === location.clientId)?.name ?? null,
        rating: row.ratingSum / row.reviews,
        reviews: row.reviews,
        unreplied: row.unreplied,
        critical: row.oneToThree,
        href: href({ location: row.locationId }),
      };
    });
  const themeCounts = new Map<string, number>();
  for (const row of context.facts.themeMonths) {
    themeCounts.set(row.theme, (themeCounts.get(row.theme) ?? 0) + row.count);
  }
  const themes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => ({
      label: themeLabel(theme) ?? theme,
      count,
      href: href({ theme, stars: "low" }),
    }));
  const top = [...lowest].sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
  const newest = await listNewestReviews(
    workspaceId,
    scopeLocations.map((location) => location.id),
    range
  );
  const locationNames = new Map(scopeLocations.map((location) => [location.id, location.name]));

  const scopeInsight =
    !locationId && groupId
      ? await ScopeInsightService.getView(workspaceId, "group", groupId)
      : !locationId && clientId
        ? await ScopeInsightService.getView(workspaceId, "client", clientId)
        : null;

  return (
    <TransitionScope>
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader title="Dashboard" />
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
      </div>
      {showSetup ? (
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite">
          <Link
            href="/onboarding"
            className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
          >
            Continue setup
          </Link>{" "}
          to connect Google, import locations, confirm groups, set a reply tone, and invite the team.
        </p>
      ) : null}
      {scopeInsight ? (
        <Suspense>
          <ScopeInsightPanel
            scopeKind={groupId ? "group" : "client"}
            scopeId={(groupId ?? clientId)!}
            title={scopeInsight.title}
            locationCount={scopeInsight.locationCount}
            reviewCount={scopeInsight.reviewCount}
            avgRating={scopeInsight.avgRating}
            insight={scopeInsight.insight}
            heuristicSummary={scopeInsight.heuristicSummary}
          />
        </Suspense>
      ) : null}
        <PendingRegion label="Updating overview…" className="mt-4">
          <ClientOverviewView
            data={data}
            reviews={newest.map((review) => ({
              ...review,
              locationName: locationNames.get(review.locationId) ?? "Location",
              href: href({ location: review.locationId }),
            }))}
            links={{ reviews: href(), analytics: analyticsHref(range, scope) }}
            period={{
              openEscalations: context.facts.openEscalations,
              overdueEscalations: context.facts.overdueEscalations,
              previousOpen: context.previous?.openEscalations ?? null,
              previousOverdue: context.previous?.overdueEscalations ?? null,
              replyTarget: context.replyTarget,
              insights: buildInsights({
                periodLabel: range.label,
                scopeLabel,
                facts: context.facts,
                previous: context.previous,
                replyTarget: context.replyTarget,
                lowestLocation: lowest[0]
                  ? { name: lowest[0].name, rating: lowest[0].rating, reviews: lowest[0].reviews }
                  : null,
              }),
              lowest,
              themes,
              timezone: context.timezone,
              canSetTarget: isManager(role),
              stars: context.facts.stars,
              replied: context.facts.replied,
              previousReplied: context.previous?.replied ?? null,
              top,
            }}
          />
        </PendingRegion>
    </div>
    </TransitionScope>
  );
}
