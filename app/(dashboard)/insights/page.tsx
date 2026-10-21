import { Suspense } from "react";
import { FreshMetrics } from "@/components/fresh-metrics";
import { InsightExperience, InsightToolbar } from "@/components/insight-experience";
import { PageHeader } from "@/components/page-header";
import { PeriodGeminiInsight, PeriodGeminiInsightFallback } from "@/components/period-gemini-insight";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { findingsForScope } from "@/lib/insight-page";
import { reviewDrillHref } from "@/lib/metrics";
import { overviewQueryKey } from "@/lib/overview-board";
import { periodInsightScopeSelected } from "@/lib/period-gemini-insight";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { loadComplaintSamples } from "@/lib/services/insight-evidence";
import { loadClusterBoard } from "@/lib/services/intelligence-cluster";
import { loadFindingEvidence, loadInsightBoard } from "@/lib/services/insight-report";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { scopeSummary } from "@/lib/scope";

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

function textParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const [params, { workspaceId, user }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, DEFAULT_RANGE);
  const scope = { clientId: resolved.clientId, groupId: resolved.groupId, locationId: resolved.locationId };
  const summary = scopeSummary(resolved);

  const reviews = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);
  const analytics = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
  if (scope.clientId) analytics.set("client", scope.clientId);
  if (scope.groupId) analytics.set("group", scope.groupId);
  if (scope.locationId) analytics.set("location", scope.locationId);
  const analyticsHref = `/analytics?${analytics.toString()}`;
  const admin = createAdminClient();
  const findingKey = textParam(params.finding);
  const evidencePage = Math.max(0, Number(textParam(params.evidencePage)) || 0);
  const emptyBoard = {
    unavailable: null,
    notice: "Choose an organisation, group, or outlet. A report is stored for that scope.",
    freshness: null,
    narrative: null,
    report: null,
  };

  const [loaded, rawSamples, board, clusters] = await Promise.all([
    getDashboardContext(workspaceId, range, scope),
    loadComplaintSamples(
      workspaceId,
      resolved.locationIds,
      range.start?.toISOString() ?? null,
      range.end?.toISOString() ?? null,
      new Map()
    ).catch(() => null),
    resolved.clientId && !resolved.blocked
      ? loadInsightBoard(admin, {
          userId: user.id,
          workspaceId,
          clientId: resolved.clientId,
          groupId: resolved.groupId,
          locationId: resolved.locationId,
          range,
        })
      : Promise.resolve(emptyBoard),
    loadClusterBoard(admin, workspaceId, { locationIds: resolved.locationIds, maxReviews: 3 }).catch(() => ({
      items: [],
      unavailable: "Topic clusters are not available in this workspace yet.",
    })),
  ]);
  const visibleFindings = findingsForScope(board.report?.findings ?? [], resolved.locationIds);
  const openFinding = visibleFindings.find((finding) => finding.key === findingKey) ?? null;
  const evidence = openFinding && board.report
    ? await loadFindingEvidence(admin, {
        workspaceId,
        reportId: board.report.id,
        findingKey: openFinding.key,
        locationIds: resolved.locationIds,
        topicCodes: openFinding.topicCodes,
        category: openFinding.category,
        reviewIds: openFinding.reviewIds,
        page: evidencePage,
      }).then((page) => ({ ...page, page: evidencePage })).catch(() => ({
        rows: [],
        total: 0,
        page: evidencePage,
        pageSize: 8,
        unavailable: "Supporting reviews could not be loaded.",
      }))
    : null;
  const locationsInScope = loaded.locations.filter((location) => {
    if (scope.locationId) return location.id === scope.locationId;
    if (scope.groupId) return location.groupId === scope.groupId || location.parentGroupId === scope.groupId;
    if (scope.clientId) return location.clientId === scope.clientId;
    return true;
  });
  const names = new Map(locationsInScope.map((location) => [location.id, location.name]));
  const samples = (rawSamples ?? []).map((sample) => ({
    ...sample,
    locationName: names.get(sample.locationId) ?? sample.locationName,
  }));
  const samplesUnavailable = rawSamples ? null : "Supporting reviews could not be loaded.";
  const places = loaded.locations
    .filter((location) => resolved.locationIds.includes(location.id))
    .map((location) => ({ id: location.id, name: location.name }));
  const readPeriod = periodInsightScopeSelected(resolved);

  const queryKey = overviewQueryKey((key) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  });
  const canPrepare = Boolean(resolved.clientId && !resolved.blocked);
  const hidden = {
    range: range.key,
    ...(range.key === "custom" ? { from: range.from, to: range.to } : {}),
    ...(scope.clientId ? { client: scope.clientId } : {}),
    ...(scope.groupId ? { group: scope.groupId } : {}),
    ...(scope.locationId ? { location: scope.locationId } : {}),
  };
  const reportParams = new URLSearchParams();
  for (const key of ["range", "from", "to", "client", "group", "location"] as const) {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (text) reportParams.set(key, text);
  }
  return (
    <TransitionScope>
      <PageHeader
        title="AI Insights"
        description="When an organisation, group, or outlet is selected, Gemini reads the latest reviews in this date period. The cards below still use the stored report."
      >
        <a className="text-sm text-ink underline" href="/insights/clusters">
          Topic clusters
        </a>
        <InsightToolbar canPrepare={canPrepare} hidden={hidden} board={board} />
      </PageHeader>
      <PendingRegion label="Updating insights for the selected scope…">
        <FreshMetrics rendered={queryKey} surface="insights">
          {samplesUnavailable ? <p className="mb-4 text-sm text-slate">{samplesUnavailable}</p> : null}
          {readPeriod ? (
            <Suspense fallback={<PeriodGeminiInsightFallback />}>
              <PeriodGeminiInsight
                workspaceId={workspaceId}
                locationIds={resolved.locationIds}
                places={places}
                range={range}
                scopeTitle={summary.title}
              />
            </Suspense>
          ) : null}
          <InsightExperience
            scopeTitle={summary.title}
            period={range.label}
            bounds={
              range.start
                ? `${range.start.toISOString().slice(0, 10)} inclusive, ${range.end ? `${range.end.toISOString().slice(0, 10)} exclusive` : "through now"}`
                : range.end
                  ? `Until ${range.end.toISOString().slice(0, 10)} exclusive`
                  : "All stored reviews"
            }
            query={reportParams.toString()}
            facts={loaded.facts}
            places={places}
            locationIds={resolved.locationIds}
            board={board}
            clusters={clusters.items}
            clustersUnavailable={clusters.unavailable}
            openFinding={openFinding}
            evidence={evidence}
            canPrepare={canPrepare}
            hidden={hidden}
            notice={textParam(params.notice) || null}
            samples={samples.map((sample) => ({
              ...sample,
              href: reviews({ location: sample.locationId, stars: "low" }),
            }))}
            analyticsHref={analyticsHref}
            reviewsHref={reviews()}
          />
        </FreshMetrics>
      </PendingRegion>
    </TransitionScope>
  );
}
