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
import { loadInsightDashboard } from "@/lib/services/insight-dashboard";
import { loadScopeCatalog } from "@/lib/services/scope-catalog";
import {
  KeyInsights,
  LocationPerformance,
  SectionCard,
  SentimentDonut,
  SentimentTrend,
  StaffPraised,
  TopThemes,
} from "@/components/insights-dashboard";
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

function ThemeList({ entries, empty }: { entries: Array<{ topic: string; count: number; reviews: number }>; empty: string }) {
  if (entries.length === 0) return <p className="py-6 text-center text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line-2">
      {entries.slice(0, 12).map((entry) => (
        <li key={entry.topic} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
          <span className="capitalize text-ink-2">{entry.topic.replace(/_/g, " ")}</span>
          <span className="text-xs tabular-nums text-ink-3">
            {entry.count.toLocaleString()} mentions · {entry.reviews.toLocaleString()} reviews
          </span>
        </li>
      ))}
    </ul>
  );
}

function NameList({ entries, tone }: { entries: Array<{ name: string; count: number }>; tone: "ok" | "bad" }) {
  if (entries.length === 0) return <p className="py-6 text-center text-[13px] text-ink-3">No names mentioned.</p>;
  return (
    <ul className="divide-y divide-line-2">
      {entries.slice(0, 10).map((entry) => (
        <li key={entry.name} className="flex justify-between gap-3 py-2 text-[13px]">
          <span className="text-ink-2">{entry.name}</span>
          <span className={`text-xs tabular-nums ${tone === "ok" ? "text-ok" : "text-bad"}`}>{entry.count} mentions</span>
        </li>
      ))}
    </ul>
  );
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const maxDuration = 60;

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);
  const scope = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, "12m");
  const start = range.start ? range.start.toISOString() : null;
  const end = range.end ? range.end.toISOString() : null;

  const cacheKey = reportCacheKey(workspaceId, {
    locationIds: scope.locationIds,
    clientId: scope.clientId,
    groupId: scope.groupId,
    locationId: scope.locationId,
    start,
    end,
  });
  const [dashboard, latestRun, exactReport, catalog] = await Promise.all([
    loadInsightDashboard(workspaceId, { locationIds: scope.locationIds, start, end }),
    getLatestAnalysisRun(workspaceId),
    getReportByCacheKey(workspaceId, cacheKey),
    loadScopeCatalog(user.id, workspaceId),
  ]);
  // Rolling preset windows drift daily, so from tomorrow the exact cache
  // key misses. Fall back to the most recent saved report for this scope
  // and preset (shown with its own generated date) rather than an empty
  // page demanding regeneration.
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
  const coveragePct = counts.eligible > 0 ? Math.round((counts.alreadyAnalysed / counts.eligible) * 100) : 0;
  const reportInsights = (Array.isArray(report?.insights) ? report.insights : []) as InsightRecord[];
  // One incident, one story on the page: an excerpt is displayed once,
  // under its most prominent card (serious incidents first); later cards
  // whose quotes are all already shown say so instead of repeating the
  // same customer words as if they were a different event.
  const excerptKey = (e: string) => e.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const seenExcerptKeys = new Set<string>();
  const displayByIndex = new Map<number, InsightRecord & { evidenceShownElsewhere?: boolean }>();
  const prioritized = reportInsights
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) =>
      (a.insight.category === "serious_incident" ? 0 : 1) -
      (b.insight.category === "serious_incident" ? 0 : 1)
    );
  for (const { insight, index } of prioritized) {
    const fresh = insight.evidenceExcerpts.filter((e) => !seenExcerptKeys.has(excerptKey(e)));
    for (const excerpt of insight.evidenceExcerpts) seenExcerptKeys.add(excerptKey(excerpt));
    displayByIndex.set(index, {
      ...insight,
      evidenceExcerpts: fresh,
      evidenceShownElsewhere: insight.evidenceExcerpts.length > 0 && fresh.length === 0,
    });
  }
  const displayInsights = reportInsights.map((insight, index) => displayByIndex.get(index) ?? insight);
  const reportLimitations = (Array.isArray(report?.limitations) ? report.limitations : []) as string[];
  const reportDataMoved = Boolean(report) && counts.pending > 0;

  // Only resume/show a run that belongs to the range currently on screen.
  // Bounds are compared by UTC day: preset windows resolve to a fresh
  // instant on every request.
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
      }
    : null;

  const scopeParams = {
    client: first(params.client),
    group: first(params.group),
    location: first(params.location),
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
  };

  function reviewsHrefFor(insight: InsightRecord): string | null {
    const excerpt = insight.evidenceExcerpts[0];
    if (!excerpt) return null;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(scopeParams)) {
      if (value) query.set(key, value);
    }
    query.set("q", excerpt.split(/\s+/).slice(0, 6).join(" "));
    return `/reviews?${query.toString()}`;
  }

  const periodDetail = range.start
    ? `${range.label} · ${dayLabel(range.start)} – ${range.end ? dayLabel(new Date(range.end.getTime() - 86_400_000)) : "today"}`
    : range.label;
  const reportStatus = (report?.status as string | undefined) ?? null;
  const reportReused = (report?.phase as string | null) === "reused";
  const hasReport = reportInsights.length > 0;

  const navItems: Array<{ id: string; label: string; show: boolean }> = [
    { id: "serious", label: "Serious incidents", show: reportInsights.some((i) => i.category === "serious_incident") },
    { id: "positive", label: "Key positive", show: reportInsights.some((i) => i.sentiment === "positive" && i.category !== "staff_recognition" && i.category !== "product_quality") },
    { id: "negative", label: "Key negative", show: reportInsights.some((i) => i.sentiment === "negative" && i.category !== "serious_incident" && i.category !== "staff_complaint" && i.category !== "product_quality") },
    { id: "staff", label: "Staff", show: reportInsights.some((i) => i.category === "staff_recognition" || i.category === "staff_complaint") },
    { id: "product", label: "Product & service", show: reportInsights.some((i) => i.category === "product_quality" || i.category === "service_quality") },
    { id: "trends", label: "Trends & locations", show: reportInsights.some((i) => i.category === "trend" || i.category === "outlet_comparison") },
    { id: "connections", label: "How issues connect", show: reportInsights.some((i) => i.category === "relationship") },
    { id: "actions", label: "Recommendations", show: reportInsights.some((i) => i.suggestedAction) },
    { id: "themes", label: "Recurring themes", show: aggregates.storedObservations > 0 },
  ];

  const scopeQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(scopeParams)) {
    if (value) scopeQuery.set(key, value);
  }
  const scopeQueryText = scopeQuery.toString();
  const reviewsInScopeHref = scopeQueryText ? `/reviews?${scopeQueryText}` : "/reviews";
  const analyticsThemesHref = `/analytics?${scopeQueryText ? `${scopeQueryText}&` : ""}section=themes`;
  const generatedAt = report?.finished_at ? new Date(report.finished_at as string) : null;
  const generatedLabel = generatedAt
    ? generatedAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const locationCount = scope.locationIds.length;
  const sentimentTotal = positiveMentions + negativeMentions;
  const statusTag = !hasReport ? (
    aggregates.storedObservations > 0 ? <Badge variant="info">Analysis only · no report yet</Badge> : <Badge>No analysis yet</Badge>
  ) : reportStatus === "partial" ? (
    <Badge variant="warn">Partial report</Badge>
  ) : reportStatus === "failed" ? (
    <Badge variant="bad">Last generation failed</Badge>
  ) : reportDataMoved ? (
    <Badge variant="warn">Report may be stale</Badge>
  ) : (
    <Badge variant="ok">Report complete</Badge>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Insights"
        description={`What customers said about ${modernizeCopy(scope.title)} · ${locationCount.toLocaleString()} ${
          locationCount === 1 ? "location" : "locations"
        } · ${periodDetail}`}
        eyebrow={
          <>
            {statusTag}
            <span className="text-xs text-ink-3">
              {generatedLabel ? `Generated ${generatedLabel} · ` : ""}
              {counts.discovered.toLocaleString()} reviews · coverage {coveragePct}%
            </span>
          </>
        }
      >
        <Link href={analyticsThemesHref} className={buttonVariants({ variant: "outline" })}>
          <BarChart3 aria-hidden />
          Theme analytics
        </Link>
        <a href="#analysis" className={buttonVariants({ variant: "ai" })}>
          <Sparkles aria-hidden />
          {hasReport ? "Re-analyse" : "Analyse"}
        </a>
      </PageHeader>

      <KpiGrid>
        <KpiTile label="Reviews in scope" value={counts.discovered.toLocaleString()} detail={periodDetail} href={reviewsInScopeHref} />
        <KpiTile
          label="With written comments"
          value={counts.eligible.toLocaleString()}
          detail={`${counts.ratingOnly.toLocaleString()} rating-only, never used as evidence`}
        />
        <KpiTile
          label="Analysis coverage"
          value={`${coveragePct}%`}
          detail={`${counts.alreadyAnalysed.toLocaleString()} of ${counts.eligible.toLocaleString()} written reviews`}
          tone={coveragePct === 100 ? "ok" : undefined}
        />
        <KpiTile
          label="Still pending"
          value={counts.pending.toLocaleString()}
          detail={counts.failed > 0 ? `${counts.failed} failed — retried next run` : "Will be analysed on the next run"}
          tone={counts.failed > 0 ? "bad" : undefined}
        />
        <KpiTile
          label="Serious incidents"
          value={dashboard.severeCount.toLocaleString()}
          detail="Customer allegations to verify"
          href={dashboard.severeCount > 0 ? (hasReport ? "#serious" : "#themes") : undefined}
          tone={dashboard.severeCount > 0 ? "bad" : undefined}
        />
      </KpiGrid>

      {reportStatus === "partial" && hasReport ? (
        <Banner tone="warn" title="Completed with failures.">
          This saved report does not yet cover every eligible review and must not be read as complete.
          {reportLimitations.map((limitation, i) => (
            <span key={i} className="mt-1 block">
              {limitation}
            </span>
          ))}
        </Banner>
      ) : null}

      {reportDataMoved && hasReport ? (
        <Banner tone="warn" title="This report may be stale.">
          Reviews in this scope have been added or changed since it was generated. Regenerate to refresh it — existing review analysis is
          reused and only new or changed reviews are processed.
        </Banner>
      ) : null}

      {aggregates.storedObservations > 0 ? (
        <section aria-label="Observed summary" className="grid items-start gap-4 lg:grid-cols-3">
          <SectionCard title="Praise vs complaints" hint="observed mentions">
            <div className="flex flex-wrap items-center gap-5">
              <SentimentDonut positive={positiveMentions} negative={negativeMentions} />
              <ul className="min-w-0 flex-1 space-y-2 text-[13px]">
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="size-2.5 rounded-sm bg-ok" aria-hidden />
                    Positive
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{positiveMentions.toLocaleString()}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="size-2.5 rounded-sm bg-bad" aria-hidden />
                    Negative
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{negativeMentions.toLocaleString()}</span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-2">
                    <span className="size-2.5 rounded-sm bg-[#7f1d1d]" aria-hidden />
                    Serious incidents
                  </span>
                  <span className="font-semibold tabular-nums text-ink">{dashboard.severeCount.toLocaleString()}</span>
                </li>
              </ul>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              {sentimentTotal > 0
                ? `${Math.round((positiveMentions / sentimentTotal) * 100)}% of praise and complaint mentions are positive`
                : "Insights are building up"}{" "}
              across {aggregates.reviewsAnalysed.toLocaleString()} analysed written reviews
              {aggregates.positive[0] ? `. Most praised: ${aggregates.positive[0].topic.replace(/_/g, " ")}` : ""}
              {aggregates.negative[0] ? `. Most complaints: ${aggregates.negative[0].topic.replace(/_/g, " ")}` : ""}.{" "}
              {aggregates.storedObservations.toLocaleString()} observations.
            </p>
          </SectionCard>
          <SectionCard title="Sentiment trend" hint="observations per month" className="lg:col-span-2">
            <SentimentTrend byMonth={aggregates.byMonth} />
          </SectionCard>
        </section>
      ) : null}

      <section
        id="analysis"
        aria-label="Analysis and report status"
        className="grid scroll-mt-24 gap-4 rounded-lg border border-line bg-white p-4 lg:grid-cols-2 lg:divide-x lg:divide-line [&>*]:min-w-0 lg:[&>*+*]:pl-4"
      >
        <InsightAnalyzer scopeParams={scopeParams} initialRun={initialRun} pendingCount={counts.pending} />
        <InsightReportPanel
          scopeParams={scopeParams}
          initialReport={
            report
              ? {
                  reportId: report.id as string,
                  status: reportStatus as string,
                  phase: (report.phase as string | null) ?? null,
                }
              : null
          }
          hasSavedReport={hasReport}
        />
      </section>

      {aggregates.storedObservations > 0 ? (
        <section className="grid items-start gap-4 lg:grid-cols-3" aria-label="Insights dashboard">
          <SectionCard title="Location performance" hint="share of positive observations" className="lg:col-span-2">
            <LocationPerformance aggregates={aggregates} outletNames={outletNames} />
          </SectionCard>
          <SectionCard title="Top review themes" hint="praise and complaints ranked separately">
            <TopThemes aggregates={aggregates} />
          </SectionCard>
          <SectionCard title="Key insights" hint="from the saved report" className="lg:col-span-2">
            <KeyInsights insights={displayInsights} />
          </SectionCard>
          <SectionCard title="Staff praised by name" hint="recognition">
            <StaffPraised aggregates={aggregates} />
          </SectionCard>
        </section>
      ) : null}

      {hasReport ? (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
              <Badge variant={reportStatus === "partial" ? "warn" : "ok"}>
                {reportStatus === "partial" ? "Saved report — partial coverage" : "Saved report"}
              </Badge>
              {reportReused ? <Badge>Reused — data unchanged, no new AI call</Badge> : null}
              <span>
                {modernizeCopy(scope.title)} · {periodDetail} · generated {generatedLabel ?? "—"} · built from{" "}
                {(report?.analysed_count as number | undefined)?.toLocaleString() ?? "—"} analysed reviews · {reportInsights.length} insights ·
                analysis {(report?.analysis_version as string) ?? "—"} / prompt {(report?.prompt_version as string) ?? "—"} · counts computed
                from saved observations, never from model memory.
              </span>
            </div>
          </div>

          <nav className="flex flex-wrap gap-1.5" aria-label="Report sections">
            {navItems
              .filter((item) => item.show)
              .map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink-2 hover:border-brand-line hover:text-brand"
                >
                  {item.label}
                </a>
              ))}
          </nav>

          <InsightSection
            id="serious"
            title="Serious incidents requiring attention"
            intro="Ranked by severity, not frequency — a single credible report stays visible here. Each entry is a customer allegation that needs verification; it is not presented as a proven fact."
            tone="danger"
            insights={displayInsights.filter((i) => i.category === "serious_incident")}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            columns
            id="positive"
            title="Key positive insights"
            intro="Strengths customers praise. Always reported separately from complaints."
            insights={displayInsights.filter(
              (i) =>
                i.sentiment === "positive" &&
                !["trend", "outlet_comparison", "relationship", "staff_recognition", "product_quality"].includes(i.category)
            )}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            columns
            id="negative"
            title="Key negative insights"
            intro="Problems customers report. Always reported separately from praise — one review can appear in both lists for different points."
            insights={displayInsights.filter(
              (i) =>
                i.sentiment === "negative" &&
                i.category !== "serious_incident" &&
                !["trend", "outlet_comparison", "relationship", "staff_complaint", "product_quality"].includes(i.category)
            )}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            columns
            id="staff"
            title="Staff insights"
            intro="Recognition and complaints about named team members, kept as two separate lists."
            insights={displayInsights.filter(
              (i) => i.category === "staff_recognition" || i.category === "staff_complaint"
            )}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            columns
            id="product"
            title="Product & service quality and assortment"
            intro="Quality, durability, selection, sizes, stock, price and service findings — praise and complaints on separate cards."
            insights={displayInsights.filter(
              (i) => i.category === "product_quality" || i.category === "service_quality"
            )}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            id="trends"
            title="Trends and location comparisons"
            intro="Trends compare equivalent periods using rates as well as counts. Location rates use each location's own analysed-review denominator; small samples are flagged on the card."
            insights={displayInsights.filter(
              (i) => i.category === "trend" || i.category === "outlet_comparison"
            )}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            columns
            id="connections"
            title="How issues connect"
            intro="Topics customers raise together in the same reviews. Co-occurrence is correlation, not proof that one causes the other."
            insights={displayInsights.filter((i) => i.category === "relationship")}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
          <InsightSection
            id="actions"
            title="Recommendations"
            intro="Suggested next steps, each grounded in the evidence card it came from."
            insights={displayInsights
              .filter((i) => i.suggestedAction)
              // Actions index the evidence cards above; they must not
              // re-tell the incident or repeat its quotes a second time.
              .map((i) => ({
                ...i,
                detail: i.suggestedAction as string,
                suggestedAction: null,
                evidenceExcerpts: [],
                evidenceShownElsewhere: false,
              }))}
            periodLabel={periodDetail}
            reviewsHrefFor={reviewsHrefFor}
          />
        </>
      ) : null}

      {/* Evidence overview from saved observations — visible before/without a report too */}
      {aggregates.storedObservations > 0 ? (
        <section id="themes" className="flex scroll-mt-24 flex-col gap-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel
              title="Recurring themes — praise"
              hint={`Ranked by frequency across ${aggregates.reviewsAnalysed.toLocaleString()} reviews with observations · ${periodDetail}`}
            >
              <ThemeList entries={aggregates.positive} empty="No positive observations yet." />
            </Panel>
            <Panel
              title="Recurring themes — complaints"
              hint="Frequency ranks recurring issues; one-off serious incidents are never buried here — they are listed separately by severity."
            >
              <ThemeList entries={aggregates.negative} empty="No negative observations yet." />
            </Panel>
          </div>

          {!hasReport && dashboard.severeIncidents.length > 0 ? (
            <Panel
              tone="bad"
              title="Serious incidents needing investigation"
              hint="Severity reflects potential harm and credibility, not frequency. A single credible report appears here regardless of star rating. These are customer allegations to verify — not proven facts."
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
                    <blockquote className="mt-2 border-l-2 border-line py-1 pl-3 text-[13px] text-ink-2">
                      “{incident.evidenceExcerpt}”
                    </blockquote>
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
          ) : null}

          {!hasReport &&
          (aggregates.staffPraise.length > 0 || aggregates.staffComplaints.length > 0) ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <Panel title="Staff praised by name">
                <NameList entries={aggregates.staffPraise} tone="ok" />
              </Panel>
              <Panel title="Staff complaints by name">
                <NameList entries={aggregates.staffComplaints} tone="bad" />
              </Panel>
            </div>
          ) : null}
        </section>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No analysed reviews yet"
          description="Analyse the written reviews in this scope to extract evidence-backed observations, then generate the report. Nothing is estimated or filled in — every number on this page comes from your saved reviews."
        >
          <a href="#analysis" className={buttonVariants({ variant: "ai", size: "sm" })}>
            <Sparkles aria-hidden />
            Go to analysis
          </a>
        </EmptyState>
      )}

      <section className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Analysis coverage</span>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="block h-1.5 flex-1 overflow-hidden rounded-[3px] bg-line-2" aria-hidden>
              <span className="block h-full rounded-[3px] bg-ok" style={{ width: `${coveragePct}%` }} />
            </span>
            <b className="text-[13px] tabular-nums text-ink">{coveragePct}%</b>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {counts.alreadyAnalysed.toLocaleString()} of {counts.eligible.toLocaleString()} written reviews analysed.{" "}
            {counts.ratingOnly.toLocaleString()} rating-only reviews are skipped.
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Last updated</span>
          <p className="mt-1.5 text-[13px] font-semibold text-ink">{generatedLabel ?? "No report yet"}</p>
          <p className="mt-1 text-xs text-ink-3">
            {counts.pending > 0
              ? `${counts.pending.toLocaleString()} written reviews are not reflected yet; they are included in the next analysis.`
              : "Every written review in this scope is reflected."}
          </p>
        </div>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">How to read this</span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Counts, percentages, periods and quotes are <b className="text-ink-2">observed</b> from review text. Violet boxes are the
            model&apos;s <b className="text-ink-2">suggested interpretation</b> and may be wrong; check the reviews before acting.
          </p>
        </div>
        <div>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            History <Badge variant="ai">Proposed</Badge>
          </span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Weekly and monthly snapshots of this page are not stored yet. Only the latest report for each scope and period is kept.
          </p>
        </div>
      </section>

      <p className="text-xs text-ink-3">
        Severity scale: {SEVERITY_LABELS[1]} (1–2), {SEVERITY_LABELS[3]} (3), {SEVERITY_LABELS[4]}{" "}
        (4), {SEVERITY_LABELS[5]} (5). Severity describes the incident as reported and is kept
        separate from verification status. Rating-only reviews count toward ratings but are never used as evidence. Change scope and
        dates in the header filters.
      </p>
    </div>
  );
}
