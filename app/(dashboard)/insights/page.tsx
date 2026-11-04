import Link from "next/link";
import { Download, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InsightReadNow, type AnalysisRunStatus } from "@/components/insight-analyzer";
import { InsightReportPanel } from "@/components/insight-report-panel";
import {
  LocationHeatmap,
  NextActionsCard,
  ShortVersionCard,
  TopicsTab,
  WorthChecking,
  type TopicDetail,
} from "@/components/insights-dashboard";
import { InsightsDateSelect } from "@/components/insights-date-select";
import { InsightsMood, type MoodEvent } from "@/components/insights-mood";
import { ReportsTabContent } from "./reports-tab";
import { allows, draftsWithAiOnly, workspaceGrant } from "@/lib/access";
import { dateRangeParams } from "@/lib/date-range";
import { memberName, namedStaff } from "@/lib/insight-dashboard";
import { divergingRows, heatmapNote, locationHeatmap, monthDrivers, monthQuotes } from "@/lib/insight-mood";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getLatestAnalysisRun } from "@/lib/services/insight-pipeline";
import { loadThemeEvidence } from "@/lib/services/insight-drilldown";
import { listInsightAssignments } from "@/lib/services/insight-assignments";
import { INSIGHTS_DEFAULT_RANGE, loadInsightsPage } from "@/lib/services/insights-page";
import { getWorkspaceRoster } from "@/lib/services/workspace";
import { modernizeCopy } from "@/lib/ui/vocabulary";

interface InsightsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const maxDuration = 60;

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "topics", label: "Topics" },
  { id: "locations", label: "Locations" },
  { id: "reports", label: "Reports and alerts" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Tab names from before the redesign, so saved links still land somewhere sensible. */
const OLD_TABS: Record<string, TabId> = { themes: "topics", incidents: "summary", report: "summary", analysis: "summary" };

/** Enough to count a topic's reviews and list its mentions without paging. */
const TOPIC_EVIDENCE_LIMIT = 200;

/** Short quotes repeat ("Quick checkout"); show each wording once. */
function distinctQuotes<T extends { excerpt: string }>(quotes: T[]): T[] {
  const seen = new Set<string>();
  return quotes.filter((quote) => {
    const key = quote.excerpt.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readTab(value: string | undefined): TabId {
  if (TABS.some((tab) => tab.id === value)) return value as TabId;
  return (value && OLD_TABS[value]) || "summary";
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([searchParams, getActiveWorkspace(), getActiveRole()]);
  const tab = readTab(first(params.tab));
  const data = await loadInsightsPage(user.id, workspaceId, params);
  const { scope, range, dashboard, mood, points, trends, themes } = data;
  const { counts, aggregates } = dashboard;

  // Scope and dates travel on every link; the page default (12 months) is left out.
  const scopeQuery = new URLSearchParams();
  if (scope.clientId) scopeQuery.set("client", scope.clientId);
  if (scope.groupId) scopeQuery.set("group", scope.groupId);
  if (scope.locationId) scopeQuery.set("location", scope.locationId);
  const pageQuery = new URLSearchParams(scopeQuery);
  for (const [key, value] of Object.entries(dateRangeParams(range, INSIGHTS_DEFAULT_RANGE))) pageQuery.set(key, value);
  const reviewsQuery = new URLSearchParams(scopeQuery);
  for (const [key, value] of Object.entries(dateRangeParams(range, "all"))) reviewsQuery.set(key, value);

  const insightsHref = (patch: Record<string, string | null>) => {
    const query = new URLSearchParams(pageQuery);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    const text = query.toString();
    return `/insights${text ? `?${text}` : ""}`;
  };
  const reviewsHref = (patch: Record<string, string>) => {
    const query = new URLSearchParams(reviewsQuery);
    for (const [key, value] of Object.entries(patch)) query.set(key, value);
    return `/reviews?${query.toString()}`;
  };
  const quoteHref = (excerpt: string) => reviewsHref({ q: excerpt.split(/\s+/).slice(0, 6).join(" ") });

  const scopeParams = {
    client: scope.clientId ?? undefined,
    group: scope.groupId ?? undefined,
    location: scope.locationId ?? undefined,
    range: range.key,
    from: range.from || undefined,
    to: range.to || undefined,
  };

  const latestRun = await getLatestAnalysisRun(workspaceId);
  const sameDay = (a: string | null, b: string | null) => (a ? a.slice(0, 10) : null) === (b ? b.slice(0, 10) : null);
  const run =
    latestRun &&
    sameDay((latestRun.range_start as string | null) ?? null, data.start) &&
    sameDay((latestRun.range_end as string | null) ?? null, data.end)
      ? latestRun
      : null;
  const initialRun: AnalysisRunStatus | null = run
    ? {
        runId: run.id as string,
        status: run.status as string,
        discovered: run.discovered as number,
        eligible: run.eligible as number,
        alreadyAnalysed: run.already_analysed as number,
        newlyAnalysed: run.newly_analysed as number,
        pending: run.pending as number,
        failed: run.failed as number,
        batchesTotal: run.batches_total as number,
        batchesCompleted: run.batches_completed as number,
        retries: run.retries as number,
        inputTokens: run.input_tokens as number,
        outputTokens: run.output_tokens as number,
        error: (run.error as string | null) ?? null,
        updatedAt: (run.updated_at as string | undefined) ?? undefined,
      }
    : null;

  const hasReadings = aggregates.storedObservations > 0;
  const placeName = modernizeCopy(scope.title);
  const report = data.report;
  const reportView = report
    ? { reportId: report.id as string, status: report.status as string, phase: (report.phase as string | null) ?? null,
        staleAt: (report.stale_at as string | null) ?? null, updatedAt: report.updated_at as string }
    : null;
  const notReadYet = (
    <EmptyState
      icon={Sparkles}
      title="No reviews read by AI in this period yet"
      description={
        counts.pending > 0
          ? `${counts.pending.toLocaleString()} written ${counts.pending === 1 ? "review is" : "reviews are"} waiting. Use “Read them now” above, or wait for tonight’s automatic read.`
          : "There are no written reviews for this place and period. Pick a longer period or another place."
      }
    />
  );

  const body =
    tab === "reports"
      ? null
      : !hasReadings
        ? notReadYet
        : tab === "topics"
          ? await renderTopics()
          : tab === "locations"
            ? renderLocations()
            : await renderSummary();

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Insights</h1>
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            <span
              aria-hidden
              className={`size-[7px] shrink-0 rounded-full ${counts.pending > 0 ? "bg-warn" : "bg-ok"}`}
            />
            {counts.alreadyAnalysed.toLocaleString()} of {counts.eligible.toLocaleString()} reviews read by AI
            {counts.pending > 0 ? ` · ${counts.pending.toLocaleString()} waiting` : ""} · {placeName}
            <InsightReadNow scopeParams={scopeParams} initialRun={initialRun} pendingCount={counts.pending} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InsightsDateSelect defaultKey={INSIGHTS_DEFAULT_RANGE} />
          <a
            href={`/api/insights/pdf${pageQuery.size ? `?${pageQuery.toString()}` : ""}`}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:border-ink-3"
          >
            <Download aria-hidden className="size-[15px]" strokeWidth={1.75} />
            Client report (PDF)
          </a>
        </div>
      </header>

      <nav aria-label="Insights views" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((item) => {
          const on = item.id === tab;
          return (
            <Link
              key={item.id}
              href={insightsHref({ tab: item.id === "summary" ? null : item.id })}
              aria-current={on ? "page" : undefined}
              className={`-mb-px flex h-11 shrink-0 items-center border-b-2 px-3.5 text-sm ${
                on ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {body}
      {tab === "reports" ? (
        <ReportsTabContent
          user={user}
          workspaceId={workspaceId}
          role={role}
          resolved={scope}
          range={range}
          rangeDefault={INSIGHTS_DEFAULT_RANGE}
          view={first(params.view)}
          edit={first(params.edit)}
        />
      ) : null}
    </div>
  );

  async function renderSummary() {
    const months = data.months;
    const index = new Map(months.map((month, i) => [month, i]));
    const removable = (createdBy: string | null) => createdBy === user.id || workspaceGrant(role, "edit_rules");
    const events: MoodEvent[] = [
      ...data.notes.flatMap((note) =>
        index.has(note.month)
          ? [{ key: `note-${note.id}`, index: index.get(note.month) as number, kind: "note" as const, text: note.body, removableId: removable(note.createdBy) ? note.id : null }]
          : []
      ),
      ...data.spotted.flatMap((change) =>
        index.has(change.month)
          ? [{ key: `ai-${change.month}-${change.topic}`, index: index.get(change.month) as number, kind: "ai" as const, text: change.text, removableId: null }]
          : []
      ),
    ].sort((a, b) => a.index - b.index || (a.kind === b.kind ? 0 : a.kind === "note" ? -1 : 1));
    const drivers = months.map((_, i) => monthDrivers(months, mood.topics, i));
    const requestedMonth = first(params.month);
    const initialIndex = requestedMonth && index.has(requestedMonth) ? (index.get(requestedMonth) as number) : data.headline.index;

    const canAssign = Boolean(role) && !draftsWithAiOnly(role);
    const [roster, assignments] = await Promise.all([
      data.actions.length > 0 ? getWorkspaceRoster(workspaceId) : Promise.resolve(null),
      listInsightAssignments(workspaceId, data.actions.map((action) => action.id)),
    ]);
    const members = (roster?.members ?? [])
      .filter((member) => member.accessEnabled)
      .map((member) => ({ userId: member.userId, name: memberName(member.email) }));
    const assigned = Object.fromEntries(assignments.map((row) => [row.actionId, row.assigneeId]));
    const short = data.short;
    const takeawayHref = (i: number) => {
      const takeaway = short?.takeaways[i];
      if (!takeaway) return null;
      if (takeaway.topic) return `${insightsHref({ tab: "topics", topic: takeaway.topic })}#topic-detail`;
      const insight = data.insights.find((item) => item.id === takeaway.insightId);
      return insight?.evidenceExcerpts[0] ? quoteHref(insight.evidenceExcerpts[0]) : null;
    };

    return (
      <div className="flex flex-col gap-5">
        {short ? (
          <ShortVersionCard
            short={short}
            takeawayHref={takeawayHref}
            footer={<InsightReportPanel compact scopeParams={scopeParams} initialReport={reportView} hasSavedReport={data.insights.length > 0} />}
          />
        ) : null}
        <InsightsMood
          points={points}
          trends={trends}
          drivers={drivers}
          quotes={monthQuotes(points, mood.quotes)}
          events={events}
          initialIndex={initialIndex}
          scopeParams={{ client: scopeParams.client, group: scopeParams.group, location: scopeParams.location }}
          reviewsQuery={scopeQuery.toString()}
          canNote={allows(role, "draft") && !scope.blocked}
        />
        <div className="flex flex-wrap items-stretch gap-4">
          <NextActionsCard
            actions={data.actions}
            assignments={assigned}
            members={members}
            canAssign={canAssign}
            empty={
              data.insights.length > 0
                ? "The AI summary has no suggested actions for this period."
                : "Suggested actions come with the AI summary. Use “Write AI summary” above to get them."
            }
          />
          <WorthChecking
            incidents={dashboard.severeIncidents}
            staff={namedStaff(aggregates.staffPraise)}
            hrefFor={quoteHref}
            locationLabel={placeName}
          />
        </div>
      </div>
    );
  }

  async function renderTopics() {
    const rows = divergingRows(themes, 12);
    const requested = first(params.topic);
    const selected = rows.find((row) => row.topic === requested) ?? rows[0] ?? null;
    let detail: TopicDetail | null = null;
    if (selected) {
      const theme = themes.find((row) => row.topic === selected.topic);
      const [praise, complaints] = await Promise.all(
        (["positive", "negative"] as const).map((sentiment) =>
          loadThemeEvidence(workspaceId, {
            locationIds: scope.blocked ? [] : scope.locationIds,
            start: data.start,
            end: data.end,
            topic: selected.topic,
            sentiment,
            limit: TOPIC_EVIDENCE_LIMIT,
          })
        )
      );
      const mostlyComplaints = selected.complaints > selected.praise;
      const quote = (sentiment: "positive" | "negative") => (item: (typeof praise)[number]) => ({
        excerpt: item.excerpt,
        href: quoteHref(item.excerpt),
        sentiment,
        stars: item.starRating,
        createdAt: item.createdAt,
        place: data.locationNames.get(item.locationId) ?? "Location",
      });
      const praiseQuotes = distinctQuotes(praise.map(quote("positive")));
      const complaintQuotes = distinctQuotes(complaints.map(quote("negative")));
      const quotes = mostlyComplaints
        ? [...complaintQuotes.slice(0, 2), ...praiseQuotes.slice(0, 1)]
        : [...praiseQuotes.slice(0, 2), ...complaintQuotes.slice(0, 1)];
      const where = mood.locationTopics
        .filter((row) => row.topic === selected.topic)
        .map((row) => ({ name: data.locationNames.get(row.locationId) ?? "Location", count: row.positive + row.negative }))
        .filter((row) => row.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 3);
      const showAll = first(params.mentions) === "all";
      const allQuotes = [...complaints.map(quote("negative")), ...praise.map(quote("positive"))].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      // Reviews can hold praise and a complaint on one topic, so count them once.
      const capped = praise.length >= TOPIC_EVIDENCE_LIMIT || complaints.length >= TOPIC_EVIDENCE_LIMIT;
      const reviews = capped
        ? (theme?.praiseReviews ?? 0) + (theme?.complaintReviews ?? 0)
        : new Set([...praise, ...complaints].map((item) => item.reviewId)).size;
      detail = {
        topic: selected.topic,
        label: selected.label,
        praise: selected.praise,
        complaints: selected.complaints,
        reviews,
        trend: trends.find((trend) => trend.topic === selected.topic) ?? null,
        where: scope.locationId ? [] : where,
        quotes,
        allQuotes: showAll ? allQuotes : null,
        toggleAllHref: `${insightsHref({ tab: "topics", topic: selected.topic, mentions: showAll ? null : "all" })}#topic-detail`,
      };
    }
    return (
      <TopicsTab
        rows={rows}
        selected={selected?.topic ?? null}
        hrefFor={(topic) => `${insightsHref({ tab: "topics", topic })}#topic-detail`}
        detail={detail}
      />
    );
  }

  function renderLocations() {
    const heat = locationHeatmap(mood.locationTopics);
    return (
      <LocationHeatmap
        topics={heat.topics}
        rows={heat.rows.map((row) => ({
          locationId: row.locationId,
          name: data.locationNames.get(row.locationId) ?? "Location",
          rating: mood.locationRatings[row.locationId]?.rating ?? null,
          cells: row.cells,
        }))}
        note={heatmapNote(heat, data.locationNames)}
      />
    );
  }
}
