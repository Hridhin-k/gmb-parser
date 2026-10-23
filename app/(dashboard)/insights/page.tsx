import Link from "next/link";
import { PageHeader } from "@/components/page-header";
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

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-2xl border border-silver bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <p className="text-xs font-medium uppercase tracking-wide text-slate">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone === "danger" && value > 0 ? "text-red-600" : "text-graphite"}`}
      >
        {value.toLocaleString()}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate">{hint}</p> : null}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "pos" | "neg" | "warn" }) {
  const classes =
    tone === "pos"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "neg"
        ? "bg-red-50 text-red-700 border-red-200"
        : tone === "warn"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-white text-slate border-silver";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${classes}`}>
      {children}
    </span>
  );
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
    outlet_comparison: "Outlet comparison",
    relationship: "Connected issues",
    emerging_theme: "Emerging theme",
  };
  return labels[insight.category] ?? insight.category.replace(/_/g, " ");
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
  return (
    <li className="rounded-lg border border-silver bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={insight.sentiment === "positive" ? "pos" : "neg"}>
          {insight.sentiment === "positive" ? "Positive" : "Negative"}
        </Chip>
        <Chip>{categoryLabel(insight)}</Chip>
        {insight.category === "serious_incident" ? (
          <Chip tone="warn">Customer allegation — verify before acting</Chip>
        ) : null}
        {insight.severity ? (
          <Chip tone="neg">
            Severity {severityLabel(insight.severity)} ({insight.severity}/5)
          </Chip>
        ) : null}
        {insight.importance ? <Chip>Priority {insight.importance}/5</Chip> : null}
      </div>
      <p className="mt-2 text-sm font-medium text-graphite">{insight.title}</p>
      <p className="mt-1 text-sm text-slate">{insight.detail}</p>
      {insight.evidenceShownElsewhere ? (
        <p className="mt-2 text-xs italic text-slate">
          Customer quotes for this point are shown with the incident or theme they belong to above.
        </p>
      ) : null}
      {insight.evidenceExcerpts.length > 0 ? (
        <div className="mt-2 rounded-md bg-paper p-2">
          <p className="text-xs font-medium text-slate">What customers said</p>
          {insight.evidenceExcerpts.slice(0, 2).map((excerpt, i) => (
            <p key={i} className="mt-1 text-xs italic text-slate">
              “{excerpt}”
            </p>
          ))}
          {reviewsHref ? (
            <Link href={reviewsHref} className="mt-1 inline-block text-xs font-medium text-graphite underline">
              View source reviews in the inbox →
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-slate">
        {insight.supportingReviews} supporting review{insight.supportingReviews === 1 ? "" : "s"}
        {insight.denominator ? ` of ${insight.denominator} analysed` : ""} · {periodLabel} ·{" "}
        {insight.context} · Source: {insight.calculation}.
        {insight.confidence !== null
          ? ` Confidence ${Math.round(insight.confidence * 100)}%.`
          : ""}
      </p>
      {insight.limitations.map((limitation, i) => (
        <p key={i} className="mt-1 text-xs text-amber-700">
          {limitation}
        </p>
      ))}
      {insight.suggestedAction ? (
        <p className="mt-2 text-sm text-graphite">
          <span className="font-medium">Suggested action:</span> {insight.suggestedAction}
        </p>
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
    <section
      id={id}
      className={
        tone === "danger"
          ? "mt-4 scroll-mt-24 rounded-xl border border-red-200 bg-red-50 p-4"
          : "mt-4 scroll-mt-24 rounded-xl border border-silver bg-white p-4"
      }
    >
      <h2 className="text-base font-medium text-graphite">{title}</h2>
      {intro ? <p className="mt-1 text-sm text-slate">{intro}</p> : null}
      <ul className={columns ? "mt-3 grid items-start gap-3 md:grid-cols-2" : "mt-3 space-y-3"}>
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
    { id: "trends", label: "Trends & outlets", show: reportInsights.some((i) => i.category === "trend" || i.category === "outlet_comparison") },
    { id: "connections", label: "How issues connect", show: reportInsights.some((i) => i.category === "relationship") },
    { id: "actions", label: "Recommendations", show: reportInsights.some((i) => i.suggestedAction) },
    { id: "themes", label: "Recurring themes", show: aggregates.storedObservations > 0 },
  ];

  return (
    <>
      <PageHeader
        title="AI Insights"
        description="Every written review is analysed into evidence-backed observations, then synthesised into a saved report. Rating-only reviews count toward ratings but are never used as evidence."
      />

      {/* Active filter identity */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-silver bg-white p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate">Showing</span>
        <Chip>{scope.title}</Chip>
        <Chip>{periodDetail}</Chip>
        <Chip>
          {scope.locationIds.length} outlet{scope.locationIds.length === 1 ? "" : "s"}
        </Chip>
        <span className="text-xs text-slate">
          Change scope and dates in the header filters. Dates are whole-day boundaries, the same
          convention used across the app; from/to can never be reversed.
        </span>
      </div>

      {aggregates.storedObservations > 0 ? (
        <section className="mb-4 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div className="min-w-[260px] flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
                {scope.trail[scope.trail.length - 1] ?? "Overview"} · AI overview
              </p>
              <h2 className="mt-1.5 text-xl font-semibold leading-snug text-graphite">
                {scope.title}:{" "}
                {positiveMentions + negativeMentions > 0
                  ? `${Math.round((positiveMentions / (positiveMentions + negativeMentions)) * 100)}% of praise and complaint mentions are positive`
                  : "insights are building up"}
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-slate">
                Across {aggregates.reviewsAnalysed.toLocaleString()} analysed written reviews
                {aggregates.positive[0]
                  ? `, customers praise ${aggregates.positive[0].topic.replace(/_/g, " ")} most`
                  : ""}
                {aggregates.negative[0]
                  ? `, while ${aggregates.negative[0].topic.replace(/_/g, " ")} draws the most complaints`
                  : ""}
                . Rating-only reviews count toward ratings but are never used as evidence.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip>{periodDetail}</Chip>
                <Chip>
                  {scope.locationIds.length} outlet{scope.locationIds.length === 1 ? "" : "s"}
                </Chip>
                <Chip>{aggregates.storedObservations.toLocaleString()} observations</Chip>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <SentimentDonut positive={positiveMentions} negative={negativeMentions} />
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-slate">Positive mentions</span>
                  <span className="font-semibold text-graphite">{positiveMentions.toLocaleString()}</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <span className="text-slate">Negative mentions</span>
                  <span className="font-semibold text-graphite">{negativeMentions.toLocaleString()}</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-slate">Serious incidents</span>
                  <span className="font-semibold text-graphite">{dashboard.severeCount.toLocaleString()}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Reviews in scope" value={counts.discovered} hint={periodDetail} />
        <StatCard
          label="With written comments"
          value={counts.eligible}
          hint={`${counts.ratingOnly.toLocaleString()} rating-only, never used as evidence`}
        />
        <StatCard
          label="Analysed coverage"
          value={counts.alreadyAnalysed}
          hint={`${coveragePct}% of written reviews · reused, no new AI cost`}
        />
        <StatCard
          label="Still pending"
          value={counts.pending}
          hint={counts.failed > 0 ? `${counts.failed} failed — retried next run` : "Will be analysed on the next run"}
          tone={counts.failed > 0 ? "danger" : undefined}
        />
      </div>

      <div className="mt-4">
        <InsightAnalyzer
          scopeParams={scopeParams}
          initialRun={initialRun}
          pendingCount={counts.pending}
        />
      </div>

      <div className="mt-4">
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
      </div>

      {reportStatus === "partial" && hasReport ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-base font-medium text-graphite">Completed with failures</h2>
          <p className="mt-1 text-sm text-slate">
            This saved report does not yet cover every eligible review and must not be read as
            complete.
          </p>
          {reportLimitations.map((limitation, i) => (
            <p key={i} className="mt-1 text-sm text-amber-800">
              {limitation}
            </p>
          ))}
        </div>
      ) : null}

      {reportDataMoved && hasReport ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Reviews in this scope have been added or changed since this report was generated, so
            it may be stale. Regenerate to refresh it — existing review analysis is reused and
            only new or changed reviews are processed.
          </p>
        </div>
      ) : null}

      {aggregates.storedObservations > 0 ? (
        <section className="mt-4 grid items-start gap-4 lg:grid-cols-3" aria-label="Insights dashboard">
          <SectionCard title="Sentiment trend" hint="observations per month" className="lg:col-span-2">
            <SentimentTrend byMonth={aggregates.byMonth} />
          </SectionCard>
          <SectionCard title="Top review themes" hint="praise and complaints ranked separately">
            <TopThemes aggregates={aggregates} />
          </SectionCard>
          <SectionCard title="Location performance" hint="share of positive observations" className="lg:col-span-2">
            <LocationPerformance aggregates={aggregates} outletNames={outletNames} />
          </SectionCard>
          <div className="space-y-4">
            <SectionCard title="Key insights" hint="from the saved report">
              <KeyInsights insights={displayInsights} />
            </SectionCard>
            <SectionCard title="Staff praised by name" hint="recognition">
              <StaffPraised aggregates={aggregates} />
            </SectionCard>
          </div>
        </section>
      ) : null}

      {hasReport ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-1.5 rounded-xl border border-silver bg-white p-3">
            <Chip tone={reportStatus === "partial" ? "warn" : "pos"}>
              {reportStatus === "partial" ? "Saved report — partial coverage" : "Saved report"}
            </Chip>
            {reportReused ? <Chip>Reused — data unchanged, no new AI call</Chip> : null}
            <span className="text-xs text-slate">
              {scope.title} · {periodDetail} · generated{" "}
              {report?.finished_at
                ? new Date(report.finished_at as string).toLocaleString("en-GB")
                : "—"}{" "}
              · built from {(report?.analysed_count as number | undefined)?.toLocaleString() ?? "—"}{" "}
              analysed reviews · {reportInsights.length} insights · analysis{" "}
              {(report?.analysis_version as string) ?? "—"} / prompt{" "}
              {(report?.prompt_version as string) ?? "—"} · counts computed from saved
              observations, never from model memory.
            </span>
          </div>

          <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Report sections">
            {navItems
              .filter((item) => item.show)
              .map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="rounded-full border border-silver bg-white px-3 py-1 text-xs font-medium text-graphite"
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
            title="Trends and outlet comparisons"
            intro="Trends compare equivalent periods using rates as well as counts. Outlet rates use each outlet's own analysed-review denominator; small samples are flagged on the card."
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
        <section id="themes" className="mt-4 scroll-mt-24">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-silver bg-white p-4">
              <h2 className="text-base font-medium text-graphite">Recurring themes — praise</h2>
              <p className="mt-1 text-xs text-slate">
                Ranked by frequency across {aggregates.reviewsAnalysed.toLocaleString()} reviews
                with observations · {periodDetail}
              </p>
              {aggregates.positive.length === 0 ? (
                <p className="mt-2 text-sm text-slate">No positive observations yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {aggregates.positive.slice(0, 12).map((entry) => (
                    <li key={entry.topic} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-graphite">{entry.topic.replace(/_/g, " ")}</span>
                      <span className="text-slate">
                        {entry.count} mentions · {entry.reviews} reviews
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-silver bg-white p-4">
              <h2 className="text-base font-medium text-graphite">Recurring themes — complaints</h2>
              <p className="mt-1 text-xs text-slate">
                Frequency ranks recurring issues; one-off serious incidents are never buried here —
                they are listed separately by severity.
              </p>
              {aggregates.negative.length === 0 ? (
                <p className="mt-2 text-sm text-slate">No negative observations yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {aggregates.negative.slice(0, 12).map((entry) => (
                    <li key={entry.topic} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-graphite">{entry.topic.replace(/_/g, " ")}</span>
                      <span className="text-slate">
                        {entry.count} mentions · {entry.reviews} reviews
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {!hasReport && dashboard.severeIncidents.length > 0 ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
              <h2 className="text-base font-medium text-graphite">
                Serious incidents needing investigation
              </h2>
              <p className="mt-1 text-sm text-slate">
                Severity reflects potential harm and credibility, not frequency. A single
                credible report appears here regardless of star rating. These are customer
                allegations to verify — not proven facts.
              </p>
              <ul className="mt-3 space-y-3">
                {dashboard.severeIncidents.map((incident, index) => (
                  <li key={`${incident.reviewId}-${index}`} className="rounded-lg bg-white p-3">
                    <p className="text-sm font-medium text-graphite">
                      {severityLabel(incident.severity)} severity
                      {incident.severity ? ` (${incident.severity}/5)` : ""} · {incident.starRating}★
                      · {new Date(incident.reviewCreateTime).toLocaleDateString("en-GB")}
                    </p>
                    <p className="mt-1 text-sm text-slate">“{incident.evidenceExcerpt}”</p>
                    {incident.severityRationale ? (
                      <p className="mt-1 text-xs text-slate">{incident.severityRationale}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!hasReport &&
          (aggregates.staffPraise.length > 0 || aggregates.staffComplaints.length > 0) ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-silver bg-white p-4">
                <h2 className="text-base font-medium text-graphite">Staff praised by name</h2>
                <ul className="mt-3 space-y-2">
                  {aggregates.staffPraise.slice(0, 10).map((entry) => (
                    <li key={entry.name} className="flex justify-between text-sm">
                      <span className="text-graphite">{entry.name}</span>
                      <span className="text-slate">{entry.count} mentions</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-silver bg-white p-4">
                <h2 className="text-base font-medium text-graphite">Staff complaints by name</h2>
                <ul className="mt-3 space-y-2">
                  {aggregates.staffComplaints.slice(0, 10).map((entry) => (
                    <li key={entry.name} className="flex justify-between text-sm">
                      <span className="text-graphite">{entry.name}</span>
                      <span className="text-slate">{entry.count} mentions</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="mt-4 rounded-xl border border-silver bg-white p-6">
          <h2 className="text-base font-medium text-graphite">No analysed reviews yet</h2>
          <p className="mt-2 text-sm text-slate">
            Use “Analyse reviews” above to extract evidence-backed observations from the written
            reviews in this scope, then generate the report. Nothing is estimated or filled in —
            every number on this page comes from your saved reviews.
          </p>
        </div>
      )}

      <p className="mt-4 text-xs text-slate">
        Severity scale: {SEVERITY_LABELS[1]} (1–2), {SEVERITY_LABELS[3]} (3), {SEVERITY_LABELS[4]}{" "}
        (4), {SEVERITY_LABELS[5]} (5). Severity describes the incident as reported and is kept
        separate from verification status.
      </p>
    </>
  );
}
