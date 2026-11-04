import type { DateRange } from "@/lib/date-range";
import { mergeThemes, spotMonthlyChanges, type SpottedChange, type ThemeRow } from "@/lib/insight-changes";
import type { InsightDashboardData } from "@/lib/insight-dashboard";
import {
  buildMoodSeries,
  buildTopicTrends,
  chartMonths,
  type MoodPoint,
  type TopicTrend,
} from "@/lib/insight-mood";
import { nextActions, shortVersion, type InsightRecord, type NextAction, type ShortVersion } from "@/lib/insight-report";
import type { ResolvedScope } from "@/lib/scope";
import { workspaceDateRange } from "@/lib/services/date-range";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { loadInsightMood, type InsightMoodData } from "@/lib/services/insight-mood";
import { listInsightNotes, type InsightNote } from "@/lib/services/insight-notes";
import { getLatestReportForScope, getReportByCacheKey, reportCacheKey } from "@/lib/services/insight-report";
import { loadScopeCatalog, readPageScope } from "@/lib/services/scope-catalog";

/** Insights opens on the last twelve months. */
export const INSIGHTS_DEFAULT_RANGE = "12m" as const;

type Params = Record<string, string | string[] | undefined>;

export interface InsightsPageData {
  scope: ResolvedScope;
  range: DateRange;
  start: string | null;
  end: string | null;
  dashboard: InsightDashboardData;
  mood: InsightMoodData;
  months: string[];
  points: MoodPoint[];
  trends: TopicTrend[];
  themes: ThemeRow[];
  spotted: SpottedChange[];
  notes: InsightNote[];
  report: Record<string, unknown> | null;
  insights: InsightRecord[];
  short: ShortVersion | null;
  actions: NextAction[];
  locationNames: Map<string, string>;
  /** Latest month with enough mentions, and what it compares with. */
  headline: { index: number; now: number | null; monthAgo: number | null; yearAgo: number | null };
}

function latestIndex(points: MoodPoint[]): number {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].happy !== null) return i;
  return Math.max(0, points.length - 1);
}

/**
 * Everything the Insights page and its client report (PDF) show, for one
 * place and period. Every number is computed in the database or from those
 * counts; the AI report adds wording, never numbers.
 */
export async function loadInsightsPage(
  userId: string,
  workspaceId: string,
  params: Params,
  now: Date = new Date()
): Promise<InsightsPageData> {
  const scope = await readPageScope(userId, workspaceId, params);
  const range = await workspaceDateRange(workspaceId, params, INSIGHTS_DEFAULT_RANGE, now, scope.locationId);
  const start = range.start ? range.start.toISOString() : null;
  const end = range.end ? range.end.toISOString() : null;
  const months = chartMonths(range.start, range.end, now);
  const locationIds = scope.blocked ? [] : scope.locationIds;
  const cacheKey = reportCacheKey(workspaceId, {
    locationIds,
    clientId: scope.clientId,
    groupId: scope.groupId,
    locationId: scope.locationId,
    start,
    end,
  });

  const [dashboard, mood, exactReport, catalog, notes] = await Promise.all([
    loadInsightDashboard(workspaceId, { locationIds, start, end }),
    loadInsightMood(workspaceId, { locationIds, months, start, end }),
    getReportByCacheKey(workspaceId, cacheKey),
    loadScopeCatalog(userId, workspaceId),
    months.length > 0
      ? listInsightNotes(workspaceId, { ...scope, locationIds }, months[0], months[months.length - 1])
      : Promise.resolve([]),
  ]);
  const report =
    exactReport ??
    (locationIds.length > 0
      ? await getLatestReportForScope(workspaceId, {
          clientId: scope.clientId,
          groupId: scope.groupId,
          locationId: scope.locationId,
          locationIds,
          rangeStart: start,
          rangeEnd: end,
        })
      : null);

  const insights = (Array.isArray(report?.insights) ? report.insights : []) as InsightRecord[];
  const points = buildMoodSeries(months, mood.mood, mood.reviews);
  const trends = buildTopicTrends(months, mood.topics);
  const themes = mergeThemes(dashboard.aggregates, null);
  const index = latestIndex(points);
  const headline = {
    index,
    now: points[index]?.happy ?? null,
    monthAgo: index > 0 ? points[index - 1].happy : null,
    yearAgo: points[index]?.lastYear ?? null,
  };

  return {
    scope,
    range,
    start,
    end,
    dashboard,
    mood,
    months,
    points,
    trends,
    themes,
    spotted: spotMonthlyChanges(months, mood.topics),
    notes,
    report: (report as Record<string, unknown> | null) ?? null,
    insights,
    short: shortVersion({ insights, themes, mood: headline }),
    actions: nextActions(insights),
    locationNames: new Map((catalog?.locations ?? []).map((location) => [location.id, location.name])),
    headline,
  };
}
