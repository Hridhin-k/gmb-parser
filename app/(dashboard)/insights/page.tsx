import Link from "next/link";
import { BarChart3, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/analytics-panel";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { KpiGrid, KpiTile } from "@/components/ui/kpi";
import { modernizeCopy } from "@/lib/ui/vocabulary";
import { getActiveWorkspace } from "@/lib/services/session";
import { readPageScope } from "@/lib/services/scope-catalog";
import { parseDateRange } from "@/lib/date-range";
import { getLatestAnalysisRun } from "@/lib/services/insight-pipeline";
import { loadThemeEvidence } from "@/lib/services/insight-drilldown";
import { defaultPeriod, insightPeriods, matchPeriod, previousWindow } from "@/lib/insight-periods";
import { describeChanges, mergeThemes } from "@/lib/insight-changes";
import { insightTopicLabel } from "@/lib/insight-dashboard";
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import { LocationPerformance, SectionCard, SentimentTrend } from "@/components/insights-dashboard";
import { SEVERITY_LABELS, severityLabel } from "@/lib/review-intelligence";
import { InsightAnalyzer, type AnalysisRunStatus } from "@/components/insight-analyzer";
import { InsightReportPanel } from "@/components/insight-report-panel";
import {
  getLatestReportForScope,
  getReportByCacheKey,
  reportCacheKey,
} from "@/lib/services/insight-report";
import type { InsightRecord } from "@/lib/insight-report";

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function categoryLabel(insight: InsightRecord): string {
  const labels: Record<string, string> = {
    recurring_strength: "Recurring strength",
    recurring_issue: "Recurring issue",
    serious_incident: "Serious incident",
    staff_recognition: "Staff recognition",
    staff_complaint: "Staff complaint",
    product_quality: "Product / service",
    service_quality: "Service quality",
    trend: "Trend",
    outlet_comparison: "Location comparison",
    relationship: "Connected issues",
    emerging_theme: "Emerging theme",
  };
  return labels[insight.category] ?? insight.category.replace(/_/g, " ");
}

function Spec({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-paper px-3 py-2">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums text-ink">{value}</span>
      {detail ? <span className="text-xs text-ink-3">{detail}</span> : null}
    </div>
  );
}

function InsightCard({
  insight,
  periodLabel,
  reviewsHref,
}: {
  insight: InsightRecord & { evidenceShownElsewhere?: boolean };
  periodLabel: string;
  reviewsHref: string | null;
}) {
  const serious = insight.category === "serious_incident";
  const interpretation = insight.detail.trim();
  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border bg-white p-4 ${serious ? "border-bad-line" : "border-line"}`}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={insight.sentiment === "positive" ? "ok" : "bad"}>
            {insight.sentiment === "positive" ? "Positive" : "Negative"}
          </Badge>
          <Badge variant="outline">{categoryLabel(insight)}</Badge>
          {serious ? <Badge variant="warn">Customer allegation — verify before acting</Badge> : null}
          {insight.severity ? (
            <Badge variant="bad">
              Severity {severityLabel(insight.severity)} ({insight.severity}/5)
            </Badge>
          ) : null}
          {insight.importance ? <Badge>Priority {insight.importance}/5</Badge> : null}
        </div>
        <h3 className="text-sm font-semibold text-ink">{insight.title}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Observed</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Spec
            label="Supporting reviews"
            value={insight.supportingReviews.toLocaleString()}
            detail={insight.denominator ? `of ${insight.denominator.toLocaleString()} analysed` : undefined}
          />
          <Spec
            label="Share"
            value={
              insight.denominator && insight.denominator > 0
                ? `${Math.round((insight.supportingReviews / insight.denominator) * 100)}%`
                : "—"
            }
            detail="of analysed reviews"
          />
          <Spec label="Period" value={<span className="text-[13px]">{periodLabel}</span>} detail={modernizeCopy(insight.context)} />
        </div>
        {insight.evidenceExcerpts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {insight.evidenceExcerpts.slice(0, 2).map((excerpt, i) => (
              <blockquote key={i} className="border-l-2 border-line py-1 pl-3 text-[13px] leading-relaxed text-ink-2">
                “{excerpt}”
              </blockquote>
            ))}
          </div>
        ) : null}
        {insight.evidenceShownElsewhere ? (
          <p className="text-xs italic text-ink-3">
            Customer quotes for this point are shown with the incident or theme they belong to above.
          </p>
        ) : null}
        <p className="text-xs text-ink-3">Source: {insight.calculation}.</p>
      </div>

      {interpretation || insight.suggestedAction ? (
        <div className="rounded-lg border border-ai-line bg-[#fbf9ff] p-3 text-[13px] leading-relaxed text-ink-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Badge variant="ai">Suggested interpretation</Badge>
            <span>
              AI · not a fact
              {insight.confidence !== null ? ` · confidence ${Math.round(insight.confidence * 100)}%` : ""}
            </span>
          </div>
          {interpretation ? <p>{interpretation}</p> : null}
          {insight.suggestedAction ? (
            <p className="mt-1.5">
              <span className="font-medium text-ink">Suggested action:</span> {insight.suggestedAction}
            </p>
          ) : null}
        </div>
      ) : null}

      {insight.limitations.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {insight.limitations.map((limitation, i) => (
            <li key={i} className="text-xs text-warn">
              {limitation}
            </li>
          ))}
        </ul>
      ) : null}

      {reviewsHref ? (
        <div>
          <Link href={reviewsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open source reviews
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function InsightSection({
  id,
  title,
  intro,
  insights,
  tone,
  columns,
  periodLabel,
  reviewsHrefFor,
}: {
  id: string;
  title: string;
  intro?: string;
  insights: InsightRecord[];
  tone?: "danger";
  columns?: boolean;
  periodLabel: string;
  reviewsHrefFor: (insight: InsightRecord) => string | null;
}) {
  if (insights.length === 0) return null;
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-[15px] font-semibold ${tone === "danger" ? "text-bad" : "text-ink"}`}>{title}</h2>
          <Badge variant={tone === "danger" ? "bad" : "default"}>{insights.length}</Badge>
        </div>
        {intro ? <p className="mt-0.5 max-w-3xl text-[13px] text-ink-3">{intro}</p> : null}
      </div>
      <ul className={columns ? "grid items-start gap-3 lg:grid-cols-2" : "flex flex-col gap-3"}>
        {insights.map((insight, index) => (
          <InsightCard
            key={`${id}-${insight.id}-${index}`}
            insight={insight}
            periodLabel={periodLabel}
            reviewsHref={reviewsHrefFor(insight)}
          />
        ))}
      </ul>
    </section>
  );
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const maxDuration = 60;

const TABS = [
  { id: "themes", label: "Themes" },
  { id: "locations", label: "Locations" },
  { id: "incidents", label: "Incidents" },
  { id: "report", label: "AI report" },
  { id: "analysis", label: "Analysis" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function delta(current: number, previous: number | null, goodWhenUp: boolean) {
  if (previous === null || current === previous) return null;
  const change = current - previous;
  const good = goodWhenUp ? change > 0 : change < 0;
  return (
    <span className={`ml-1.5 text-xs tabular-nums ${good ? "text-ok" : "text-bad"}`}>
      {change > 0 ? "+" : "−"}
      {Math.abs(change)}
    </span>
  );
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const [rawParams, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const now = new Date();
  // No dates in the URL: open on the last three full calendar months.
  const hasRangeParam = Boolean(first(rawParams.range) || first(rawParams.from) || first(rawParams.to));
  const fallbackPeriod = defaultPeriod(now);
  const params = hasRangeParam
    ? rawParams
    : { ...rawParams, range: "custom", from: fallbackPeriod.from, to: fallbackPeriod.to };
  const tab: TabId = TABS.some((t) => t.id === first(params.tab)) ? (first(params.tab) as TabId) : "themes";

  const scope = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, "12m");
  const start = range.start ? range.start.toISOString() : null;
  const end = range.end ? range.end.toISOString() : null;
  const previous = range.start ? previousWindow(range.start, range.end, now) : null;
  const activePeriod = matchPeriod(range, now);

  const cacheKey = reportCacheKey(workspaceId, {
    locationIds: scope.locationIds,
    clientId: scope.clientId,
    groupId: scope.groupId,
    locationId: scope.locationId,
    start,
    end,
  });
  const [dashboard, previousDashboard, latestRun, exactReport, catalog] = await Promise.all([
    loadInsightDashboard(workspaceId, { locationIds: scope.locationIds, start, end }),
    previous
      ? loadInsightDashboard(workspaceId, {
          locationIds: scope.locationIds,
          start: previous.start.toISOString(),
          end: previous.end.toISOString(),
        })
      : Promise.resolve(null),
    getLatestAnalysisRun(workspaceId),
    getReportByCacheKey(workspaceId, cacheKey),
    loadScopeCatalog(user.id, workspaceId),
  ]);
  const report =
    exactReport ??
    (await getLatestReportForScope(workspaceId, {
      clientId: scope.clientId,
      groupId: scope.groupId,
      locationId: scope.locationId,
      locationIds: scope.locationIds,
      rangeStart: start,
      rangeEnd: end,
    }));
  const { counts, aggregates } = dashboard;
  const outletNames = new Map((catalog?.locations ?? []).map((l) => [l.id, l.name]));
  const positiveMentions = aggregates.positive.reduce((sum, e) => sum + e.count, 0);
  const negativeMentions = aggregates.negative.reduce((sum, e) => sum + e.count, 0);
  const previousPositive = previousDashboard?.aggregates.positive.reduce((sum, e) => sum + e.count, 0) ?? null;
  const previousNegative = previousDashboard?.aggregates.negative.reduce((sum, e) => sum + e.count, 0) ?? null;
  const sentimentTotal = positiveMentions + negativeMentions;
  const positiveShare = sentimentTotal > 0 ? Math.round((positiveMentions / sentimentTotal) * 100) : null;
  const previousTotal = (previousPositive ?? 0) + (previousNegative ?? 0);
  const previousShare =
    previousPositive !== null && previousTotal > 0 ? Math.round((previousPositive / previousTotal) * 100) : null;
  const coveragePct = counts.eligible > 0 ? Math.round((counts.alreadyAnalysed / counts.eligible) * 100) : 0;
  const reportInsights = (Array.isArray(report?.insights) ? report.insights : []) as InsightRecord[];
  const reportLimitations = (Array.isArray(report?.limitations) ? report.limitations : []) as string[];
  const reportStatus = (report?.status as string | undefined) ?? null;
  const hasReport = reportInsights.length > 0;
  const reportDataMoved = Boolean(report) && counts.pending > 0;
  const themes = mergeThemes(aggregates, previousDashboard ? previousDashboard.aggregates : null);
  const changes = describeChanges(themes);

  const scopeParams = {
    client: first(params.client),
    group: first(params.group),
    location: first(params.location),
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
  };
  const baseQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(scopeParams)) if (value) baseQuery.set(key, value);
  const link = (patch: Record<string, string | null>, hash = "") => {
    const query = new URLSearchParams(baseQuery);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    const text = query.toString();
    return `/insights${text ? `?${text}` : ""}${hash}`;
  };
  const periodLink = (period: { from: string; to: string }) => {
    const query = new URLSearchParams(baseQuery);
    query.set("range", "custom");
    query.set("from", period.from);
    query.set("to", period.to);
    if (tab !== "themes") query.set("tab", tab);
    return `/insights?${query.toString()}`;
  };
  const reviewsHrefFor = (insight: InsightRecord): string | null => {
    const excerpt = insight.evidenceExcerpts[0];
    if (!excerpt) return null;
    const query = new URLSearchParams(baseQuery);
    query.set("q", excerpt.split(/\s+/).slice(0, 6).join(" "));
    return `/reviews?${query.toString()}`;
  };
  const scopeReviewsHref = `/reviews${baseQuery.toString() ? `?${baseQuery.toString()}` : ""}`;

  // The quotes behind one theme, when a row was opened.
  const openTopic = first(params.theme);
  const openSentiment = first(params.sentiment) === "positive" ? "positive" : "negative";
  const evidence =
    tab === "themes" && openTopic && /^[a-z0-9_]{1,60}$/.test(openTopic)
      ? await loadThemeEvidence(workspaceId, {
          locationIds: scope.locationIds,
          start,
          end,
          topic: openTopic,
          sentiment: openSentiment,
        })
      : null;

  const sameDay = (a: string | null, b: string | null) =>
    (a ? a.slice(0, 10) : null) === (b ? b.slice(0, 10) : null);
  const runForThisRange =
    latestRun &&
    sameDay((latestRun.range_start as string | null) ?? null, start) &&
    sameDay((latestRun.range_end as string | null) ?? null, end)
      ? latestRun
      : null;
  const initialRun: AnalysisRunStatus | null = runForThisRange
    ? {
        runId: runForThisRange.id as string,
        status: runForThisRange.status as string,
        discovered: runForThisRange.discovered as number,
        eligible: runForThisRange.eligible as number,
        alreadyAnalysed: runForThisRange.already_analysed as number,
        newlyAnalysed: runForThisRange.newly_analysed as number,
        pending: runForThisRange.pending as number,
        failed: runForThisRange.failed as number,
        batchesTotal: runForThisRange.batches_total as number,
        batchesCompleted: runForThisRange.batches_completed as number,
        retries: runForThisRange.retries as number,
        inputTokens: runForThisRange.input_tokens as number,
        outputTokens: runForThisRange.output_tokens as number,
        error: (runForThisRange.error as string | null) ?? null,
        updatedAt: (runForThisRange.updated_at as string | undefined) ?? undefined,
      }
    : null;

  const periodDetail = range.start
    ? `${range.label} · ${dayLabel(range.start)} – ${range.end ? dayLabel(new Date(range.end.getTime() - 86_400_000)) : "today"}`
    : range.label;
  const generatedAt = report?.finished_at ? new Date(report.finished_at as string) : null;
  const generatedLabel = generatedAt
    ? generatedAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const locationCount = scope.locationIds.length;
  const topInsights = [...reportInsights]
    .filter((i) => i.category !== "serious_incident")
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 3);
  const sections = (filter: (i: InsightRecord) => boolean) => reportInsights.filter(filter);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Insights"
        description={`What customers said about ${modernizeCopy(scope.title)} · ${locationCount.toLocaleString()} ${
          locationCount === 1 ? "location" : "locations"
        }`}
      >
        <Link href={`/analytics?${baseQuery.toString() ? `${baseQuery.toString()}&` : ""}section=themes`} className={buttonVariants({ variant: "outline" })}>
          <BarChart3 aria-hidden />
          Theme analytics
        </Link>
      </PageHeader>

      <nav aria-label="Period" className="flex flex-wrap items-center gap-1.5">
        {insightPeriods(now).map((period) => {
          const active = activePeriod?.key === period.key;
          return (
            <Link
              key={period.key}
              href={periodLink(period)}
              aria-current={active ? "true" : undefined}
              className={`inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium ${
                active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-brand-line hover:text-brand"
              }`}
            >
              {period.label}
            </Link>
          );
        })}
        <span className="ml-1 text-xs text-ink-3">
          {periodDetail}
          {previous ? ` · compared with the ${Math.round((previous.end.getTime() - previous.start.getTime()) / 86_400_000)} days before` : ""}
        </span>
      </nav>

      <KpiGrid>
        <KpiTile
          label="Reviews analysed"
          value={aggregates.reviewsAnalysed.toLocaleString()}
          detail={`${counts.discovered.toLocaleString()} reviews · ${coveragePct}% of written ones analysed`}
          href={scopeReviewsHref}
        />
        <KpiTile
          label="Positive share"
          value={positiveShare === null ? "—" : `${positiveShare}%`}
          detail={
            positiveShare !== null && previousShare !== null
              ? `${positiveShare >= previousShare ? "▲" : "▼"} ${Math.abs(positiveShare - previousShare)} pts vs before (${previousShare}%)`
              : "of praise and complaint mentions"
          }
          tone={positiveShare !== null && previousShare !== null && positiveShare < previousShare ? "bad" : undefined}
        />
        <KpiTile
          label="Complaints"
          value={negativeMentions.toLocaleString()}
          detail={previousNegative !== null ? `${previousNegative.toLocaleString()} in the previous period` : "mentions in this period"}
        />
        <KpiTile
          label="Serious incidents"
          value={dashboard.severeCount.toLocaleString()}
          detail="Customer allegations to verify"
          href={dashboard.severeCount > 0 ? link({ tab: "incidents" }) : undefined}
          tone={dashboard.severeCount > 0 ? "bad" : undefined}
        />
      </KpiGrid>

      {counts.pending > 0 ? (
        <Banner
          tone="info"
          title={`${counts.pending.toLocaleString()} written ${counts.pending === 1 ? "review is" : "reviews are"} not analysed yet.`}
          actions={
            <Link href={link({ tab: "analysis" })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Analyse now
            </Link>
          }
        >
          New reviews are analysed automatically each night. Numbers here cover the reviews analysed so far.
        </Banner>
      ) : null}
      {reportStatus === "partial" && hasReport ? (
        <Banner tone="warn" title="Completed with failures.">
          This saved report does not yet cover every eligible review.
          {reportLimitations.map((limitation, i) => (
            <span key={i} className="mt-1 block">
              {limitation}
            </span>
          ))}
        </Banner>
      ) : null}
      {reportDataMoved && hasReport ? (
        <Banner tone="warn" title="The AI summary may be out of date.">
          Reviews have been added or changed since it was written. Generate it again to refresh it. Reviews already analysed are reused.
        </Banner>
      ) : null}

      {aggregates.storedObservations === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No analysed reviews in this period"
          description="Reviews are analysed automatically each night. To see this period now, analyse its written reviews. Every number here comes from your saved reviews."
        >
          <Link href={link({ tab: "analysis" })} className={buttonVariants({ variant: "ai", size: "sm" })}>
            <Sparkles aria-hidden />
            Analyse this period
          </Link>
        </EmptyState>
      ) : (
        <section className="grid items-start gap-4 lg:grid-cols-3" aria-label="Summary">
          <SectionCard
            title={`Summary for ${activePeriod?.label.toLowerCase() ?? "this period"}`}
            hint={generatedLabel ? `AI summary generated ${generatedLabel}` : "What moved, then the AI summary"}
            className="lg:col-span-2"
          >
            <div className="flex flex-col gap-3 text-[13px]">
              {changes.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {changes.map((change) => (
                    <li key={change.text} className="flex gap-2 text-ink-2">
                      <span className={change.tone === "good" ? "text-ok" : "text-bad"} aria-hidden>
                        {change.tone === "good" ? "▲" : "▼"}
                      </span>
                      {change.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">
                  {previous ? "No theme moved by more than a couple of mentions since the previous period." : "Pick a period to see what changed."}
                </p>
              )}
              {topInsights.length > 0 ? (
                <ul className="flex flex-col gap-2 border-t border-line-2 pt-3">
                  {topInsights.map((insight) => (
                    <li key={insight.id} className="rounded-md border border-ai-line bg-[#fbf9ff] p-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        <Badge variant="ai">AI</Badge>
                        <Badge variant={insight.sentiment === "positive" ? "ok" : "bad"}>
                          {insight.sentiment === "positive" ? "Positive" : "Negative"}
                        </Badge>
                      </div>
                      <p className="mt-1.5 font-medium text-ink">{insight.title}</p>
                      {insight.suggestedAction ? (
                        <p className="mt-1 text-ink-2">
                          <span className="font-medium text-ink">Suggested action:</span> {insight.suggestedAction}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="border-t border-line-2 pt-3">
                <InsightReportPanel
                  scopeParams={scopeParams}
                  initialReport={
                    report
                      ? { reportId: report.id as string, status: reportStatus as string, phase: (report.phase as string | null) ?? null }
                      : null
                  }
                  hasSavedReport={hasReport}
                />
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Sentiment trend" hint="observations per month">
            <SentimentTrend byMonth={aggregates.byMonth} />
          </SectionCard>
        </section>
      )}

      {aggregates.storedObservations > 0 || tab === "analysis" ? (
        <>
          <nav aria-label="Insight sections" className="flex flex-wrap gap-1 border-b border-line">
            {TABS.map((item) => (
              <Link
                key={item.id}
                href={link({ tab: item.id === "themes" ? null : item.id, theme: null, sentiment: null })}
                aria-current={tab === item.id ? "page" : undefined}
                className={`-mb-px inline-flex h-9 items-center border-b-2 px-3 text-[13px] font-medium ${
                  tab === item.id ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink"
                }`}
              >
                {item.label}
                {item.id === "incidents" && dashboard.severeCount > 0 ? (
                  <Badge variant="bad" className="ml-1.5">
                    {dashboard.severeCount}
                  </Badge>
                ) : null}
              </Link>
            ))}
          </nav>

          {tab === "themes" ? (
            <section className="flex flex-col gap-4" aria-label="Themes">
              <div className="overflow-x-auto rounded-lg border border-line bg-white">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="border-b border-line bg-paper text-xs text-ink-3">
                    <tr>
                      <th className="px-3 py-2 font-medium">Theme</th>
                      <th className="px-3 py-2 font-medium">Praise</th>
                      <th className="px-3 py-2 font-medium">Complaints</th>
                      <th className="px-3 py-2 font-medium">Reviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {themes.slice(0, 25).map((row) => (
                      <tr key={row.topic} className={openTopic === row.topic ? "bg-brand-tint/40" : undefined}>
                        <td className="px-3 py-2.5 font-medium text-ink">{row.label}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {row.praise > 0 ? (
                            <Link href={link({ tab: null, theme: row.topic, sentiment: "positive" }, "#evidence")} className="text-ok hover:underline">
                              {row.praise}
                            </Link>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                          {delta(row.praise, row.praisePrev, true)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {row.complaints > 0 ? (
                            <Link href={link({ tab: null, theme: row.topic, sentiment: "negative" }, "#evidence")} className="text-bad hover:underline">
                              {row.complaints}
                            </Link>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                          {delta(row.complaints, row.complaintsPrev, false)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink-3">{row.praiseReviews + row.complaintReviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-3">
                Select a number to read the customer quotes behind it. A mention is one point in a review, not a star rating. Themes are
                named by the AI for each business.
              </p>

              {evidence ? (
                <section id="evidence" className="scroll-mt-24 rounded-lg border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">
                      {openSentiment === "positive" ? "Praise" : "Complaints"} about {insightTopicLabel(openTopic ?? "")}
                    </h2>
                    <Link href={link({ theme: null, sentiment: null })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      Close
                    </Link>
                  </div>
                  {evidence.length === 0 ? (
                    <p className="mt-2 text-[13px] text-ink-3">No quotes found for this theme in this period.</p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-3">
                      {evidence.map((item, index) => {
                        const query = new URLSearchParams(baseQuery);
                        query.set("q", item.excerpt.split(/\s+/).slice(0, 6).join(" "));
                        return (
                          <li key={`${item.reviewId}-${index}`} className="rounded-md border border-line-2 p-3">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                              <span>{item.starRating}★</span>
                              <span>{new Date(item.createdAt).toLocaleDateString("en-GB")}</span>
                              <span>{outletNames.get(item.locationId) ?? "Location"}</span>
                              {item.severity && item.severity >= 3 ? (
                                <Badge variant="bad">Severity {item.severity}/5</Badge>
                              ) : null}
                            </div>
                            <blockquote className="mt-1.5 border-l-2 border-line pl-3 text-[13px] text-ink-2">“{item.excerpt}”</blockquote>
                            <Link href={`/reviews?${query.toString()}`} className="mt-1.5 inline-block text-xs font-medium text-brand hover:underline">
                              Open this review
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}
            </section>
          ) : null}

          {tab === "locations" ? (
            <SectionCard title="Location performance" hint="share of positive observations">
              <LocationPerformance aggregates={aggregates} outletNames={outletNames} />
            </SectionCard>
          ) : null}

          {tab === "incidents" ? (
            dashboard.severeIncidents.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-3">No serious incidents in this period.</p>
            ) : (
              <Panel
                tone="bad"
                title="Serious incidents needing investigation"
                hint="Ranked by severity, not frequency. These are customer allegations to verify, not proven facts."
              >
                <ul className="flex flex-col gap-3">
                  {dashboard.severeIncidents.map((incident, index) => (
                    <li key={`${incident.reviewId}-${index}`} className="rounded-md border border-line-2 p-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        <Badge variant="bad">
                          {severityLabel(incident.severity)} severity
                          {incident.severity ? ` (${incident.severity}/5)` : ""}
                        </Badge>
                        <span>
                          {incident.starRating}★ · {new Date(incident.reviewCreateTime).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                      <blockquote className="mt-2 border-l-2 border-line py-1 pl-3 text-[13px] text-ink-2">“{incident.evidenceExcerpt}”</blockquote>
                      {incident.severityRationale ? (
                        <div className="mt-2 rounded-md border border-ai-line bg-[#fbf9ff] px-3 py-2 text-xs text-ink-2">
                          <Badge variant="ai" className="mr-1.5">
                            Suggested interpretation
                          </Badge>
                          {incident.severityRationale}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            )
          ) : null}

          {tab === "report" ? (
            hasReport ? (
              <div className="flex flex-col gap-6">
                <InsightSection
                  columns
                  id="positive"
                  title="Key positive insights"
                  intro="Strengths customers praise, reported separately from complaints."
                  insights={sections((i) => i.sentiment === "positive" && !["trend", "outlet_comparison", "relationship"].includes(i.category))}
                  periodLabel={periodDetail}
                  reviewsHrefFor={reviewsHrefFor}
                />
                <InsightSection
                  columns
                  id="negative"
                  title="Key negative insights"
                  intro="Problems customers report, reported separately from praise."
                  insights={sections((i) => i.sentiment === "negative" && i.category !== "serious_incident" && !["trend", "outlet_comparison", "relationship"].includes(i.category))}
                  periodLabel={periodDetail}
                  reviewsHrefFor={reviewsHrefFor}
                />
                <InsightSection
                  id="trends"
                  title="Trends and location comparisons"
                  intro="Equivalent periods compared by rate as well as count. Small samples are flagged on the card."
                  insights={sections((i) => i.category === "trend" || i.category === "outlet_comparison")}
                  periodLabel={periodDetail}
                  reviewsHrefFor={reviewsHrefFor}
                />
                <InsightSection
                  columns
                  id="connections"
                  title="How issues connect"
                  intro="Topics customers raise together. Co-occurrence is correlation, not proof of cause."
                  insights={sections((i) => i.category === "relationship")}
                  periodLabel={periodDetail}
                  reviewsHrefFor={reviewsHrefFor}
                />
                <InsightSection
                  id="actions"
                  title="Recommendations"
                  intro="Suggested next steps, each grounded in the evidence it came from."
                  insights={sections((i) => Boolean(i.suggestedAction)).map((i) => ({
                    ...i,
                    detail: i.suggestedAction as string,
                    suggestedAction: null,
                    evidenceExcerpts: [],
                  }))}
                  periodLabel={periodDetail}
                  reviewsHrefFor={reviewsHrefFor}
                />
              </div>
            ) : (
              <p className="py-8 text-center text-[13px] text-ink-3">
                No AI report for this period yet. Use “Generate” in the summary above.
              </p>
            )
          ) : null}

          {tab === "analysis" ? (
            <section
              aria-label="Analysis status"
              className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4"
            >
              <InsightAnalyzer scopeParams={scopeParams} initialRun={initialRun} pendingCount={counts.pending} />
              <div className="grid gap-3 border-t border-line-2 pt-3 text-xs text-ink-3 sm:grid-cols-3">
                <p>
                  <b className="text-ink-2">Coverage:</b> {counts.alreadyAnalysed.toLocaleString()} of {counts.eligible.toLocaleString()} written
                  reviews analysed ({coveragePct}%). {counts.ratingOnly.toLocaleString()} rating-only reviews are skipped.
                </p>
                <p>
                  <b className="text-ink-2">Automatic:</b> new reviews are analysed each night, so this is normally up to date. Each review is
                  analysed once and reused for every period.
                </p>
                <p>
                  <b className="text-ink-2">Reading this page:</b> counts, percentages and quotes come from your reviews. Violet boxes are
                  the AI&apos;s interpretation and may be wrong. Severity: {SEVERITY_LABELS[1]} (1–2), {SEVERITY_LABELS[3]} (3),{" "}
                  {SEVERITY_LABELS[4]} (4), {SEVERITY_LABELS[5]} (5).
                </p>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
