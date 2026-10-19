import { FreshMetrics } from "@/components/fresh-metrics";
import { InsightsBoard, type SavedInsightView } from "@/components/insights-board";
import { PageHeader } from "@/components/page-header";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { isCountedSummary, themeRowsFromGroups } from "@/lib/insight-page";
import { average, reviewDrillHref, reviewWindow, share } from "@/lib/metrics";
import { overviewQueryKey } from "@/lib/overview-board";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { loadComplaintSamples } from "@/lib/services/insight-evidence";
import { insightLensFingerprint } from "@/lib/ai-config";
import { loadResolvedInsightLens } from "@/lib/services/ai-config";
import {
  buildLocationInsightFingerprint,
  emptyAnalysis,
  LocationInsightService,
} from "@/lib/services/location-insights";
import { ScopeInsightService } from "@/lib/services/scope-insights";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveWorkspace } from "@/lib/services/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { scopeSummary } from "@/lib/scope";

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "12m";

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const [params, { workspaceId, user }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, DEFAULT_RANGE);
  const scope = { clientId: resolved.clientId, groupId: resolved.groupId, locationId: resolved.locationId };
  const summary = scopeSummary(resolved);

  const loaded = await getDashboardContext(workspaceId, range, scope);
  const windowFacts = reviewWindow(loaded.facts);
  const locationsInScope = loaded.locations.filter((location) => {
    if (scope.locationId) return location.id === scope.locationId;
    if (scope.groupId) return location.groupId === scope.groupId || location.parentGroupId === scope.groupId;
    if (scope.clientId) return location.clientId === scope.clientId;
    return true;
  });
  const names = new Map(locationsInScope.map((location) => [location.id, location.name]));
  const reviews = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);
  const analytics = new URLSearchParams(dateRangeParams(range, DEFAULT_RANGE));
  if (scope.clientId) analytics.set("client", scope.clientId);
  if (scope.groupId) analytics.set("group", scope.groupId);
  if (scope.locationId) analytics.set("location", scope.locationId);
  const analyticsHref = `/analytics?${analytics.toString()}`;

  let samples: Awaited<ReturnType<typeof loadComplaintSamples>> = [];
  let samplesUnavailable: string | null = null;
  try {
    samples = await loadComplaintSamples(
      workspaceId,
      resolved.locationIds,
      range.start?.toISOString() ?? null,
      range.end?.toISOString() ?? null,
      names
    );
  } catch {
    samplesUnavailable = "Supporting reviews could not be loaded.";
  }

  let saved: SavedInsightView | null = null;
  let modelUnavailable: string | null = null;
  const scopeTarget = resolved.groupId
    ? { scopeKind: "group" as const, scopeId: resolved.groupId }
    : resolved.clientId
      ? { scopeKind: "client" as const, scopeId: resolved.clientId }
      : null;
  const generate = resolved.locationId ? { locationId: resolved.locationId } : scopeTarget;

  try {
    if (resolved.locationId) {
      const admin = createAdminClient();
      const [{ data: locationRow }, stats] = await Promise.all([
        admin
          .from("grm_google_locations")
          .select("client_id")
          .eq("id", resolved.locationId)
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        LocationInsightService.buildLocationReviewStats(workspaceId, [resolved.locationId]),
      ]);
      const { lens } = await loadResolvedInsightLens({
        workspaceId,
        clientId: locationRow?.client_id ?? null,
      });
      const fingerprints = new Map<string, string>();
      const row = stats.get(resolved.locationId);
      if (row) {
        fingerprints.set(
          resolved.locationId,
          buildLocationInsightFingerprint(
            resolved.locationId,
            row.reviews,
            row.avgRating,
            insightLensFingerprint(lens)
          )
        );
      }
      const cached = await LocationInsightService.getCachedInsights(
        workspaceId,
        [resolved.locationId],
        fingerprints
      );
      const hit = cached.get(resolved.locationId);
      if (hit && isCountedSummary(hit.summary)) {
        modelUnavailable =
          "The last attempt saved a count of the reviews. Generate again to retry a model brief.";
      } else if (hit) {
        saved = {
          summary: hit.summary,
          sentimentLabel: hit.sentimentLabel,
          highlights: hit.highlights,
          risks: hit.risks,
          suggestions: hit.analysis.suggestedFeatures.map((item) => ({
            title: item.title,
            why: item.why,
            basedOn: item.basedOn,
          })),
          analysis: hit.analysis ?? emptyAnalysis(),
          reviewCount: hit.reviewCount,
          generatedAt: hit.generatedAt,
          stale: hit.stale,
          evidenceLinks: (hit.analysis.evidenceReviewIds ?? []).map((id, index) => ({
            id,
            href: reviews({ review: id }),
            label: `Evidence ${index + 1}`,
          })),
          feedback: { insightKind: "location", scopeId: resolved.locationId },
        };
      }
    } else if (scopeTarget) {
      const view = await ScopeInsightService.getView(workspaceId, scopeTarget.scopeKind, scopeTarget.scopeId);
      if (view.insight && isCountedSummary(view.insight.summary)) {
        modelUnavailable =
          "The last attempt saved a count of the reviews. Generate again to retry a model brief.";
      } else if (view.insight) {
        saved = {
          summary: view.insight.summary,
          sentimentLabel: view.insight.sentimentLabel,
          highlights: view.insight.highlights,
          risks: view.insight.risks,
          suggestions: view.insight.analysis.suggestedFeatures.map((item) => ({
            title: item.title,
            why: item.why,
            basedOn: item.basedOn,
          })),
          analysis: view.insight.analysis ?? emptyAnalysis(),
          reviewCount: view.insight.reviewCount,
          generatedAt: view.insight.generatedAt,
          stale: view.insight.stale,
          evidenceLinks: (view.insight.analysis.evidenceReviewIds ?? []).map((id, index) => ({
            id,
            href: reviews({ review: id }),
            label: `Evidence ${index + 1}`,
          })),
          feedback: { insightKind: "scope", scopeId: scopeTarget.scopeId },
        };
      }
    }
  } catch {
    modelUnavailable = "The saved model brief could not be loaded. The counted evidence below is still from the reviews.";
  }

  const queryKey = overviewQueryKey((key) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  });
  const threeStar = Math.max(0, loaded.facts.oneToThree - loaded.facts.negative);

  return (
    <TransitionScope>
      <PageHeader
        title="Insights"
        description={`${summary.eyebrow}: ${summary.title}${summary.trail ? ` · ${summary.trail}` : ""} · ${range.label}`}
      />
      <PendingRegion label="Updating insights for the selected scope…">
        <FreshMetrics rendered={queryKey} surface="insights">
          {samplesUnavailable ? <p className="mb-4 text-sm text-slate">{samplesUnavailable}</p> : null}
          <InsightsBoard
            period={range.label}
            scopeTitle={summary.title}
            reviewsHref={reviews()}
            analyticsHref={analyticsHref}
            settingsHref="/settings?section=tone"
            facts={{
              avgRating: average(loaded.facts.ratingSum, loaded.facts.reviews),
              reviews: loaded.facts.reviews,
              negativeShare: share(loaded.facts.oneToThree, loaded.facts.reviews),
              replyRate: windowFacts.replyRate,
              positive: loaded.facts.positive,
              neutral: threeStar,
              negative: loaded.facts.negative,
              themes: themeRowsFromGroups(loaded.facts.themeGroups),
            }}
            samples={samples.map((sample) => ({
              ...sample,
              href: reviews({ location: sample.locationId, stars: "low" }),
            }))}
            saved={saved}
            modelUnavailable={modelUnavailable}
            generate={generate}
          />
        </FreshMetrics>
      </PendingRegion>
    </TransitionScope>
  );
}
