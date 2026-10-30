import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { formatHours } from "@/lib/analytics-metrics";
import { HBarChart, MonthVolumeChart, STAR_COLORS } from "@/components/charts";
import { SentimentDonut } from "@/components/insights-dashboard";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Delta, KpiGrid, KpiTile } from "@/components/ui/kpi";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { formatPercent as pct } from "@/lib/format";
import type {
  OverviewAttentionRow,
  OverviewBoard,
  OverviewInsightGlance,
  OverviewStoreRow,
  OverviewThemeBar,
} from "@/lib/overview-board";
import { cn } from "@/lib/utils";

/** One line in "Recent changes". Built by the page from data it already loads. */
export interface OverviewRecentChange {
  id: string;
  tone: "ok" | "bad" | "ai" | "brand" | "neutral";
  title: string;
  detail?: string;
  /** ISO timestamp. */
  at: string;
  href?: string;
}

const n = (value: number) => value.toLocaleString("en-US");

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function changeLabel(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function ratingLabel(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function Panel({
  title,
  action,
  children,
  flush,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** No inner padding: lists and tables run edge to edge. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action ? <div className="text-xs text-ink-3">{action}</div> : null}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", !flush && "p-4")}>{children}</div>
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}

const ATTENTION_TAG: Record<string, { label: string; variant: "bad" | "warn" | "ai" | "default" | "info"; action: string }> = {
  "oldest-overdue": { label: "Overdue", variant: "bad", action: "Open case" },
  overdue: { label: "Overdue", variant: "bad", action: "Open queue" },
  "recent-negative": { label: "Complaints", variant: "bad", action: "Reply first" },
  drafts: { label: "Approval", variant: "ai", action: "Approve" },
  unreplied: { label: "Needs reply", variant: "default", action: "Reply" },
  failed: { label: "Failed", variant: "bad", action: "Retry" },
  connections: { label: "Connection", variant: "bad", action: "Reconnect" },
  held: { label: "Hold", variant: "warn", action: "Review" },
  inactive: { label: "Paused", variant: "default", action: "Review" },
};

function AttentionList({ items }: { items: OverviewAttentionRow[] }) {
  if (items.length === 0) {
    return <p className="px-4 py-4 text-[13px] text-ink-3">Nothing in this scope needs attention.</p>;
  }
  return (
    <ul className="divide-y divide-line-2">
      {items.map((item) => {
        const tag = ATTENTION_TAG[item.id] ?? { label: "Attention", variant: "default" as const, action: "Open" };
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px] text-ink-2 hover:bg-[#fafbfc]"
            >
              <Badge variant={tag.variant} className="w-[92px] justify-start">
                {tag.label}
              </Badge>
              <span className="min-w-0 flex-1">
                <b className="font-semibold text-ink">{item.title}</b>
                <span className="text-ink-3"> · {item.detail}</span>
              </span>
              <span className="inline-flex h-7 items-center rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink">
                {tag.action}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

interface Recommendation {
  id: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  ai?: boolean;
}

function recommendations(board: OverviewBoard, lowUnansweredHref: string | undefined): Recommendation[] {
  const items: Recommendation[] = [];
  const { kpis } = board;
  if (board.worst) {
    items.push({
      id: "worst",
      title: `Follow up at ${board.worst.name}`,
      detail: `Lowest rated here at ${board.worst.rating.toFixed(2)}${
        board.worst.complaint ? `; most common complaint is ${board.worst.complaint.toLowerCase()}` : ""
      }.`,
      href: board.worst.assignHref,
      action: "Assign follow-up",
    });
  }
  const topComplaint = board.themes[0];
  if (topComplaint) {
    items.push({
      id: "theme",
      title: `Read the “${topComplaint.label}” complaints`,
      detail: `${n(topComplaint.count)} complaint ${topComplaint.count === 1 ? "mention" : "mentions"} in this period, the largest theme.`,
      href: topComplaint.href,
      action: "Open reviews",
    });
  }
  if (lowUnansweredHref && kpis.unreplied > 0 && (kpis.negativeShare ?? 0) > 0) {
    items.push({
      id: "low-unanswered",
      title: "Reply to 1–3 star reviews first",
      detail: `${n(kpis.unreplied)} reviews have no reply; start with the low ratings.`,
      href: lowUnansweredHref,
      action: "Open reviews",
    });
  }
  if (!board.report && kpis.reviews > 0) {
    items.push({
      id: "report",
      title: board.coverage.analysed > 0 ? "Write an AI report for this period" : "Analyse review text",
      detail:
        board.coverage.analysed > 0
          ? `${n(board.coverage.analysed)} reviews are analysed but no written report is saved.`
          : "No review text in this period has been analysed yet.",
      href: board.insightsHref,
      action: "Open insights",
      ai: true,
    });
  }
  return items.slice(0, 3);
}

const TONE_DOT: Record<OverviewRecentChange["tone"], string> = {
  ok: "bg-ok",
  bad: "bg-bad",
  ai: "bg-ai",
  brand: "bg-brand",
  neutral: "bg-[#aeb6c2]",
};

export function ClientOverviewView({
  board,
  reviewsHref,
  negativeHref,
  unansweredHref,
  escalationsHref,
  lowUnansweredHref,
  unrepliedByLocation,
  recent,
  auditHref,
  hideLocationRanking,
}: {
  board: OverviewBoard;
  reviewsHref: string;
  negativeHref: string;
  unansweredHref: string;
  escalationsHref: string;
  /** Reviews of 1–3 stars without a reply, for "Recommended next". */
  lowUnansweredHref?: string;
  /** Unreplied reviews in the period, per location id. */
  unrepliedByLocation?: Record<string, number>;
  recent?: OverviewRecentChange[];
  /** Audit log link, when the viewer can open it. */
  auditHref?: string | null;
  /** One-location scope: skip the ranking table. */
  hideLocationRanking?: boolean;
}) {
  const { kpis } = board;
  const starMax = Math.max(1, ...board.starMix.map((row) => row.count));
  const ratingDiff =
    kpis.avgRating !== null && kpis.previousAvgRating !== null ? round(kpis.avgRating - kpis.previousAvgRating, 2) : null;
  const reviewDiff = kpis.previousReviews !== null ? kpis.reviews - kpis.previousReviews : null;
  const negativeDiff =
    kpis.negativeShare !== null && kpis.previousNegativeShare !== null
      ? round((kpis.negativeShare - kpis.previousNegativeShare) * 100, 0)
      : null;
  const hoursDiff =
    kpis.avgResponseHours !== null && kpis.previousAvgResponseHours !== null
      ? kpis.avgResponseHours - kpis.previousAvgResponseHours
      : null;
  const recommended = recommendations(board, lowUnansweredHref);
  const vsPrevious = (delta: ReactNode) =>
    delta ? (
      <>
        {delta} <span>vs previous period</span>
      </>
    ) : (
      "No earlier period"
    );

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiTile
          href={reviewsHref}
          label="Reviews"
          value={n(kpis.reviews)}
          detail={vsPrevious(reviewDiff === null ? null : <Delta value={reviewDiff} />)}
        />
        <KpiTile
          href={reviewsHref}
          label="Average rating"
          value={ratingLabel(kpis.avgRating)}
          detail={vsPrevious(ratingDiff === null ? null : <Delta value={ratingDiff} />)}
        />
        <KpiTile
          href={unansweredHref}
          label="Needs reply"
          value={n(kpis.unreplied)}
          detail={`Reply rate ${pct(kpis.replyRate)}`}
        />
        <KpiTile
          href={negativeHref}
          label="1–3 star share"
          value={pct(kpis.negativeShare)}
          detail={vsPrevious(negativeDiff === null ? null : <Delta value={negativeDiff} suffix=" pts" goodWhen="down" />)}
        />
        <KpiTile
          href={unansweredHref}
          label="Average reply time"
          value={formatHours(kpis.avgResponseHours)}
          detail={
            kpis.avgResponseHours === null
              ? "No reply timestamps in this period"
              : hoursDiff === null
                ? "No earlier period"
                : Math.abs(hoursDiff) < 1
                  ? "Under 1h vs previous period"
                  : (
                      <>
                        <span className={hoursDiff < 0 ? "text-ok" : "text-bad"}>
                          {hoursDiff > 0 ? "▲" : "▼"} {formatHours(Math.abs(hoursDiff))}
                        </span>{" "}
                        vs previous period
                      </>
                    )
          }
        />
        <KpiTile
          href={escalationsHref}
          label="Open escalations"
          value={n(kpis.openEscalations)}
          tone={kpis.overdueEscalations > 0 ? "bad" : undefined}
          detail={
            kpis.overdueEscalations > 0 ? (
              <span className="text-bad">{n(kpis.overdueEscalations)} past SLA</span>
            ) : (
              "None past SLA"
            )
          }
        />
      </KpiGrid>

      <div className="grid items-start gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Needs attention" action="Live problems in this scope" flush>
            <AttentionList items={board.attention} />
          </Panel>

          <Panel title="Reviews by month" action={<PanelLink href={board.analyticsHref}>Open analytics</PanelLink>}>
            {kpis.reviews === 0 ? (
              <EmptyState
                bare
                icon={BarChart3}
                title="No reviews in this period"
                description="Trends appear once reviews arrive for this scope. Pick a longer period in the top bar, or work from the inbox."
              >
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={reviewsHref} />}>
                  Open inbox
                </Button>
              </EmptyState>
            ) : (
              <div>
                <MonthVolumeChart months={board.months} />
                {board.trendCaption ? <p className="mt-3 text-xs text-ink-3">{board.trendCaption}</p> : null}
              </div>
            )}
          </Panel>

          {board.brief.length > 0 ? (
            <section className="rounded-lg border border-line bg-white px-4 py-3">
              <p className="text-xs font-medium text-ink-3">In this period · {board.periodLabel}</p>
              <div className="mt-1.5 space-y-1">
                {board.brief.map((line) => (
                  <p key={line} className="text-[13px] leading-6 text-ink-2">
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Recommended next">
            {recommended.length === 0 ? (
              <p className="text-[13px] text-ink-3">No suggestions for this scope and period.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recommended.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 hover:border-brand-line",
                        item.ai ? "border-ai-line bg-[#fbf9ff]" : "border-line"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <b className="block text-[13px] font-semibold text-ink">{item.title}</b>
                        <span className="text-xs text-ink-3">{item.detail}</span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium",
                          item.ai ? "border-ai-line bg-ai-tint text-ai" : "border-line bg-white text-ink"
                        )}
                      >
                        {item.ai ? "✦ " : ""}
                        {item.action}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent changes" action={auditHref ? <PanelLink href={auditHref}>Audit log</PanelLink> : undefined} flush>
            {!recent || recent.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No syncs, reports or escalation deadlines to show yet.</p>
            ) : (
              <ol className="space-y-2.5 px-4 py-3 text-xs text-ink-2">
                {recent.map((item) => {
                  const body = (
                    <>
                      <b className="font-semibold text-ink">{item.title}</b>
                      {item.detail ? <> · {item.detail}</> : null} ·{" "}
                      <time dateTime={item.at} className="text-ink-3">
                        {formatFriendlyDateTime(item.at)}
                      </time>
                    </>
                  );
                  return (
                    <li key={item.id} className="flex gap-2.5">
                      <span className={cn("mt-1 size-2 shrink-0 rounded-full", TONE_DOT[item.tone])} aria-hidden />
                      {item.href ? (
                        <Link href={item.href} className="min-w-0 hover:underline">
                          {body}
                        </Link>
                      ) : (
                        <span className="min-w-0">{body}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          {hideLocationRanking ? null : (
            <Panel
              title="Locations needing most help"
              action={board.lowest.length > 0 ? <PanelLink href={board.analyticsHref}>Compare all {board.rankedCount}</PanelLink> : undefined}
              flush
            >
              {board.lowest.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-ink-3">
                  A ranking appears when this scope has two or more locations with reviews.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] text-left text-[13px]">
                    <thead className="bg-[#fafbfc] text-xs text-ink-3">
                      <tr>
                        <th className="px-4 py-2 font-medium">Location</th>
                        <th className="px-2 py-2 text-right font-medium">Rating</th>
                        <th className="px-2 py-2 text-right font-medium">1–3★</th>
                        <th className="px-4 py-2 text-right font-medium">Unanswered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.lowest.map((store) => (
                        <tr key={store.id} className="border-t border-line-2">
                          <td className="px-4 py-2">
                            <Link href={store.href} className="font-medium text-ink hover:text-brand">
                              {store.name}
                            </Link>
                            <p className="text-xs text-ink-3">
                              {n(store.reviews)} reviews{store.complaint ? ` · ${store.complaint}` : ""}
                            </p>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {store.rating.toFixed(2)}{" "}
                            {store.ratingChange !== null && Math.abs(store.ratingChange) >= 0.005 ? (
                              <span
                                className={store.ratingChange < 0 ? "text-bad" : "text-ok"}
                                title={`${changeLabel(store.ratingChange)} vs previous period`}
                              >
                                {store.ratingChange < 0 ? "▼" : "▲"}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <Link href={store.negativeHref} className="hover:text-brand hover:underline">
                              {pct(store.negativeShare)}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {unrepliedByLocation?.[store.id] !== undefined ? (
                              <Link href={store.assignHref} className="hover:text-brand hover:underline">
                                {n(unrepliedByLocation[store.id] ?? 0)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-line-2 px-4 py-2 text-xs text-ink-3">
                    Lowest average rating first. Arrows compare with the previous period of the same length.
                  </p>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

      <AiInsight board={board} />

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <Panel title="Star mix">
          {kpis.reviews === 0 ? (
            <p className="text-[13px] text-ink-3">No reviews in this period.</p>
          ) : (
            <HBarChart
              max={starMax}
              rows={board.starMix.map((row) => ({
                label: `${row.stars}★`,
                value: row.count,
                color: STAR_COLORS[row.stars - 1] ?? STAR_COLORS[0],
                href: row.href,
                suffix: kpis.reviews > 0 ? `· ${Math.round((row.count / kpis.reviews) * 100)}%` : undefined,
                lines: ["Share of reviews in this period"],
              }))}
            />
          )}
          <p className="mt-auto pt-3 text-xs text-ink-3">
            4–5 stars are positive, 3 stars are neutral, and 1–2 stars are negative. 1–3 star share counts 1, 2, and 3 stars
            together.
          </p>
        </Panel>
        {board.worst ? (
          <WorstStore store={board.worst} scopeRating={kpis.avgRating} />
        ) : (
          <Panel title="This location">
            <p className="text-[13px] text-ink-3">
              {board.rankedCount === 0
                ? "No location in this scope has a review in the period."
                : "This scope is one location, so there is no ranking against other locations."}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

const GLANCE_TONE: Record<OverviewInsightGlance["kind"], "bad" | "ok" | "info"> = {
  concern: "bad",
  strength: "ok",
  action: "info",
};

function AiInsight({ board }: { board: OverviewBoard }) {
  const mentions = board.sentiment.positive + board.sentiment.negative;
  const generated = board.report?.finishedAt ? formatFriendlyDateTime(board.report.finishedAt) : "";
  const coverage = `${n(board.coverage.analysed)} reviews analysed${
    board.coverage.ratingOnly > 0 ? `, ${n(board.coverage.ratingOnly)} with no text` : ""
  }`;
  const maxStaff = Math.max(1, ...board.staff.map((row) => row.count));
  return (
    <section className="overflow-hidden rounded-lg border border-ai-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ai-line bg-[#fbf9ff] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="ai">AI insight</Badge>
            <h2 className="text-sm font-semibold text-ink">What customers are saying</h2>
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {coverage}
            {generated ? ` · saved report ${generated}` : ""}
            {board.report?.status === "partial" ? " · partial coverage" : ""}
          </p>
        </div>
        <PanelLink href={board.insightsHref}>Open insights</PanelLink>
      </div>

      <div className="p-4">
        {mentions === 0 && !board.report && board.severe.count === 0 ? (
          <EmptyState
            bare
            title="No analysed review text for this period"
            description="Open Insights to analyse the written reviews in this scope."
          >
            <Button size="sm" variant="ai" nativeButton={false} render={<Link href={board.insightsHref} />}>
              ✦ Open insights
            </Button>
          </EmptyState>
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-12">
            <div className="xl:col-span-4">
              {mentions > 0 ? (
                <div className="flex items-center gap-4">
                  <SentimentDonut positive={board.sentiment.positive} negative={board.sentiment.negative} centerLabel="praise" />
                  <ul className="min-w-0 flex-1 space-y-2 text-[13px]">
                    <li className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-ink-3">
                        <span className="size-2 rounded-full bg-ok" /> Praise
                      </span>
                      <span className="tabular-nums text-ink">{n(board.sentiment.positive)}</span>
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-ink-3">
                        <span className="size-2 rounded-full bg-bad" /> Complaints
                      </span>
                      <span className="tabular-nums text-ink">{n(board.sentiment.negative)}</span>
                    </li>
                  </ul>
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">No praise or complaint mentions in analysed reviews for this period.</p>
              )}
              {mentions > 0 ? (
                <p className="mt-3 text-xs text-ink-3">
                  Share of praise among praise and complaint mentions in analysed text. Positive (4–5★) in the chart counts
                  reviews.
                </p>
              ) : null}
              {board.severe.count > 0 ? (
                <div className="mt-4 rounded-lg border border-bad-line bg-bad-tint p-3">
                  <p className="text-xs font-semibold text-bad">
                    {`${n(board.severe.count)} serious ${board.severe.count === 1 ? "incident" : "incidents"}`}
                  </p>
                  {board.severe.excerpt ? (
                    <p className="mt-1 line-clamp-4 text-[13px] italic text-ink-2">“{board.severe.excerpt}”</p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-3">
                    {board.severe.stars !== null
                      ? `${board.severe.stars}★ review · customer allegation, verify before acting`
                      : "Customer allegation, verify before acting."}
                  </p>
                </div>
              ) : null}
              {board.staff.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-medium text-ink-3">Staff named in praise</p>
                  <ul className="mt-2 space-y-2">
                    {board.staff.map((row) => (
                      <li key={row.name}>
                        <div className="flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="text-ink">{row.name}</span>
                          <span className="text-xs text-ink-3">{n(row.count)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                          <div className="h-full bg-ok" style={{ width: `${(row.count / maxStaff) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="xl:col-span-8">
              {board.report && board.report.cards.length > 0 ? (
                <ul className="space-y-3">
                  {board.report.cards.map((card) => (
                    <InsightGlance key={card.kind} card={card} />
                  ))}
                </ul>
              ) : board.analysis.length > 0 ? (
                <div>
                  <p className="text-[13px] text-ink-3">
                    Counted from analysed review text. A written AI report has not been saved for this period.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {board.analysis.map((card) => (
                      <InsightGlance key={card.kind} card={card} />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[13px] text-ink-3">
                  {board.report
                    ? "The saved report for this period has no written insight cards yet."
                    : "No saved AI report for this period. Open insights to write one from the analysed reviews."}
                </p>
              )}
              {board.report?.status === "partial" ? (
                <p className="mt-3 text-xs text-warn">This saved report does not cover every written review in the period.</p>
              ) : null}
            </div>
          </div>
        )}

        {board.praiseThemes.length > 0 || board.themes.length > 0 ? (
          <div className="mt-5 border-t border-line-2 pt-4">
            <h3 className="text-sm font-semibold text-ink">Themes in analysed reviews</h3>
            <p className="mt-1 text-xs text-ink-3">
              Praise and complaints are ranked separately. A theme can lead praise and still be a smaller complaint. Complaint
              counts match Analytics.
            </p>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <ThemeRank title="Most praised" themes={board.praiseThemes} tone="praise" empty="No praise mentions in analysed reviews." />
              <ThemeRank
                title="Complaint themes"
                themes={board.themes}
                tone="complaint"
                empty="No complaint mentions in analysed reviews."
                action={<PanelLink href={complaintThemesHref(board.analyticsHref)}>All complaint themes</PanelLink>}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function complaintThemesHref(href: string): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("section", "themes");
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function mentionLine(count: number, reviews: number, tone: "praise" | "complaint"): string {
  const kind = tone === "praise" ? "praise" : "complaint";
  const mentions = `${n(count)} ${kind} ${count === 1 ? "mention" : "mentions"}`;
  if (reviews > 0 && reviews !== count) {
    return `${mentions} in ${n(reviews)} ${reviews === 1 ? "review" : "reviews"}`;
  }
  return mentions;
}

function ThemeRank({
  title,
  themes,
  tone,
  empty,
  action,
}: {
  title: string;
  themes: OverviewThemeBar[];
  tone: "praise" | "complaint";
  empty: string;
  action?: ReactNode;
}) {
  const max = Math.max(1, ...themes.map((theme) => theme.count));
  const bar = tone === "praise" ? "bg-ok" : "bg-bad";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
        {action}
      </div>
      {themes.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {themes.map((theme) => (
            <li key={theme.label}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <Link href={theme.href} className="text-ink hover:underline">
                  {theme.label}
                </Link>
                <span className="text-right text-xs text-ink-3">{mentionLine(theme.count, theme.reviews, tone)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                <div className={cn("h-full opacity-80", bar)} style={{ width: `${(theme.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightGlance({ card }: { card: OverviewInsightGlance }) {
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={GLANCE_TONE[card.kind]}>{card.label}</Badge>
        {card.severity ? <span className="text-[11px] text-ink-3">Severity {card.severity}/5</span> : null}
      </div>
      <p className="mt-2 text-[13px] font-semibold text-ink">{card.title}</p>
      <p className="mt-1 text-[13px] leading-6 text-ink-2">{card.detail}</p>
      {card.excerpt ? <p className="mt-2 line-clamp-3 text-xs italic text-ink-3">“{card.excerpt}”</p> : null}
      {card.supportingReviews > 0 ? (
        <p className="mt-2 text-xs text-ink-3">
          {n(card.supportingReviews)} supporting review{card.supportingReviews === 1 ? "" : "s"}
        </p>
      ) : null}
    </li>
  );
}

function WorstStore({ store, scopeRating }: { store: OverviewStoreRow; scopeRating: number | null }) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warn">Lowest rated location</Badge>
        <span className="text-xs text-ink-3">
          {store.groupName ? `${store.groupName} · ` : ""}
          {store.rank} of {store.rankedCount} · {n(store.reviews)} reviews
        </span>
      </div>
      <h2 className="mt-2 text-sm font-semibold text-ink">
        <Link href={store.href} className="hover:underline">
          {store.name}
        </Link>
      </h2>
      <p className="mt-2 text-[22px] font-semibold leading-tight tabular-nums text-ink">
        {store.rating.toFixed(2)}{" "}
        <span className="text-xs font-normal text-ink-3">{changeLabel(store.ratingChange)} vs the previous period</span>
      </p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Scope average</dt>
          <dd className="tabular-nums text-ink">{ratingLabel(scopeRating)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">1–3 star share</dt>
          <dd>
            <Link href={store.negativeHref} className="tabular-nums text-ink hover:underline">
              {pct(store.negativeShare)}
            </Link>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Reply rate</dt>
          <dd>
            <Link href={store.assignHref} className="tabular-nums text-ink hover:underline">
              {pct(store.replyRate)}
            </Link>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Main complaint</dt>
          <dd className="text-right text-ink">{store.complaint ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={store.href} />}>
          Open location
        </Button>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={store.assignHref} />}>
          Assign follow-up
        </Button>
      </div>
    </section>
  );
}
