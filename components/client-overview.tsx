import type { ReactNode } from "react";
import Link from "next/link";
import { formatHours } from "@/lib/analytics-metrics";
import { HBarChart, MonthVolumeChart, STAR_COLORS } from "@/components/charts";
import { SentimentDonut } from "@/components/insights-dashboard";
import { formatFriendlyDateTime } from "@/lib/format-date";
import { formatPercent as pct } from "@/lib/format";
import type { OverviewBoard, OverviewInsightGlance, OverviewStoreRow, OverviewThemeBar } from "@/lib/overview-board";
import { cn } from "@/lib/utils";

const HEADING = { fontFamily: "var(--font-heading), sans-serif" };

function points(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return (current - previous) * 100;
}

function Delta({
  current,
  previous,
  format,
  suffix,
  higherIsBetter = true,
}: {
  current: number | null;
  previous: number | null;
  format: (diff: number) => string;
  suffix: string;
  higherIsBetter?: boolean;
}) {
  if (current === null || previous === null) return <span className="text-xs text-slate">No earlier period</span>;
  const diff = current - previous;
  const formatted = format(Math.abs(diff));
  if (Math.abs(diff) < 1e-9 || formatted === "0" || formatted === "0.0" || formatted === "0.00") {
    return <span className="text-xs text-slate">0 {suffix}</span>;
  }
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={cn("text-xs font-medium", good ? "text-emerald-700" : "text-rose-600")}>
      {diff > 0 ? "+" : "−"}
      {format(Math.abs(diff))} {suffix}
    </span>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-[#e6ebf2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base text-graphite" style={HEADING}>
          {title}
        </h2>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function Kpi({
  href,
  label,
  value,
  detail,
}: {
  href: string;
  label: string;
  value: string;
  detail: ReactNode;
}) {
  return (
    <Link href={href} className="flex h-full flex-col rounded-xl border border-[#e6ebf2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-[#163a7a]">
      <p className="text-xs text-slate">{label}</p>
      <p className="mt-2 text-[28px] leading-none text-graphite" style={HEADING}>
        {value}
      </p>
      <div className="mt-auto pt-2">{detail}</div>
    </Link>
  );
}

function HoursDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return <span className="text-xs text-slate">No earlier period</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 1) return <span className="text-xs text-slate">Under 1h vs previous period</span>;
  const good = diff < 0;
  return (
    <span className={cn("text-xs font-medium", good ? "text-emerald-700" : "text-rose-600")}>
      {diff > 0 ? "+" : "−"}
      {formatHours(Math.abs(diff))} vs previous period
    </span>
  );
}

function changeLabel(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function ratingLabel(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

export function OverviewMetricsPanel({
  board,
  reviewsHref,
  negativeHref,
  unansweredHref,
  escalationsHref,
}: {
  board: OverviewBoard;
  reviewsHref: string;
  negativeHref: string;
  unansweredHref: string;
  escalationsHref: string;
}) {
  const { kpis } = board;
  const starMax = Math.max(1, ...board.starMix.map((row) => row.count));
  return (
    <>
      <section className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#163a7a]">{board.periodLabel}</p>
        <div className="mt-2 space-y-1.5">
          {board.brief.map((line) => (
            <p key={line} className="text-sm leading-6 text-graphite">
              {line}
            </p>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 items-stretch gap-3 xl:grid-cols-6">
        <Kpi
          href={reviewsHref}
          label="Average rating"
          value={ratingLabel(kpis.avgRating)}
          detail={
            <Delta
              current={kpis.avgRating}
              previous={kpis.previousAvgRating}
              format={(diff) => diff.toFixed(2)}
              suffix="vs previous period"
            />
          }
        />
        <Kpi
          href={reviewsHref}
          label="Reviews"
          value={kpis.reviews.toLocaleString("en-US")}
          detail={
            <Delta
              current={kpis.reviews}
              previous={kpis.previousReviews}
              format={(diff) => diff.toLocaleString("en-US")}
              suffix="vs previous period"
            />
          }
        />
        <Kpi
          href={negativeHref}
          label="1–3 star share"
          value={pct(kpis.negativeShare)}
          detail={
            <Delta
              current={points(kpis.negativeShare, kpis.previousNegativeShare)}
              previous={kpis.previousNegativeShare === null ? null : 0}
              format={(diff) => diff.toFixed(0)}
              suffix="points vs previous period"
              higherIsBetter={false}
            />
          }
        />
        <Kpi
          href={unansweredHref}
          label="Reply rate"
          value={pct(kpis.replyRate)}
          detail={
            <span className="block text-xs text-slate">
              {kpis.unreplied.toLocaleString("en-US")} without a reply
            </span>
          }
        />
        <Kpi
          href={unansweredHref}
          label="Average reply time"
          value={formatHours(kpis.avgResponseHours)}
          detail={
            kpis.avgResponseHours === null ? (
              <span className="text-xs text-slate">No reply timestamps in this period</span>
            ) : (
              <span className="block text-xs text-slate">
                <HoursDelta current={kpis.avgResponseHours} previous={kpis.previousAvgResponseHours} />
                <span className="mt-0.5 block">Among replies with a timestamp</span>
              </span>
            )
          }
        />
        <Kpi
          href={escalationsHref}
          label="Open escalations"
          value={kpis.openEscalations.toLocaleString("en-US")}
          detail={
            <span className="text-xs text-slate">
              {kpis.overdueEscalations.toLocaleString("en-US")} past SLA
            </span>
          }
        />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Panel title="Reviews by month">
            {kpis.reviews === 0 ? (
              <p className="mt-4 text-sm text-slate">No reviews in this period.</p>
            ) : (
              <div className="mt-4">
                <MonthVolumeChart months={board.months} />
                {board.trendCaption ? <p className="mt-3 text-sm text-slate">{board.trendCaption}</p> : null}
              </div>
            )}
          </Panel>
        </div>
        <div className="xl:col-span-4">
          <Panel title="Star mix">
            {kpis.reviews === 0 ? (
              <p className="mt-4 text-sm text-slate">No reviews in this period.</p>
            ) : (
              <div className="mt-4">
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
              </div>
            )}
            <p className="mt-auto pt-3 text-xs text-slate">
              4–5 stars are positive, 3 stars are neutral, and 1–2 stars are negative. 1–3 star share, above, counts 1, 2, and 3 stars together.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

export function OverviewAiInsightPanel({ board }: { board: OverviewBoard }) {
  return <AiInsight board={board} />;
}

export function OverviewOutletsPanel({ board }: { board: OverviewBoard }) {
  const { kpis } = board;
  return (
    <>
      {board.lowest.length > 0 ? (
        <Panel
          title="Lowest rated outlets"
          action={
            <Link href={board.analyticsHref} className="text-xs font-medium text-[#2563eb] hover:underline">
              See all {board.rankedCount}
            </Link>
          }
        >
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate">
                  <th className="pb-2 font-medium">Outlet</th>
                  <th className="pb-2 font-medium">Rating</th>
                  <th className="pb-2 font-medium">Change</th>
                  <th className="pb-2 font-medium">1–3 stars</th>
                  <th className="pb-2 font-medium">Main complaint</th>
                </tr>
              </thead>
              <tbody>
                {board.lowest.map((store) => (
                  <tr key={store.id} className="border-t border-[#eef2f7]">
                    <td className="py-2.5 pr-3">
                      <Link href={store.href} className="font-medium text-graphite hover:text-[#163a7a]">
                        {store.name}
                      </Link>
                      <p className="text-xs text-slate">{store.reviews.toLocaleString("en-US")} reviews</p>
                    </td>
                    <td className="py-2.5 tabular-nums">{store.rating.toFixed(2)}</td>
                    <td className="py-2.5 tabular-nums">{changeLabel(store.ratingChange)}</td>
                    <td className="py-2.5">
                      <Link href={store.negativeHref} className="tabular-nums text-graphite hover:text-[#163a7a]">
                        {pct(store.negativeShare)}
                      </Link>
                    </td>
                    <td className="py-2.5 text-slate">{store.complaint ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-auto pt-3 text-xs text-slate">
            Sorted by average rating, lowest first. Change is against the previous period of the same length. Main
            complaint is that outlet&apos;s most common negative topic from analysed reviews. A dash means none was
            found.
          </p>
        </Panel>
      ) : (
        <Panel title="Lowest rated outlets">
          <p className="mt-3 text-sm text-slate">A ranking appears when this scope has two or more outlets with reviews.</p>
        </Panel>
      )}

      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        {board.worst ? (
          <WorstStore store={board.worst} scopeRating={kpis.avgRating} />
        ) : (
          <Panel title="This outlet">
            <p className="mt-3 text-sm text-slate">
              {board.rankedCount === 0
                ? "No outlet in this scope has a review in the period."
                : "This scope is one outlet, so there is no ranking against other outlets."}
            </p>
          </Panel>
        )}
        <Panel title="Needs attention">
          {board.attention.length === 0 ? (
            <p className="mt-3 text-sm text-slate">Nothing in this scope needs attention.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[#eef2f7]">
              {board.attention.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="block py-3 hover:text-[#163a7a]">
                    <p className="text-sm font-medium text-graphite">{item.title}</p>
                    <p className="mt-0.5 text-xs text-slate">{item.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

export function ClientOverviewView({
  board,
  reviewsHref,
  negativeHref,
  unansweredHref,
  escalationsHref,
}: {
  board: OverviewBoard;
  reviewsHref: string;
  negativeHref: string;
  unansweredHref: string;
  escalationsHref: string;
}) {
  return (
    <div className="space-y-4">
      <OverviewMetricsPanel
        board={board}
        reviewsHref={reviewsHref}
        negativeHref={negativeHref}
        unansweredHref={unansweredHref}
        escalationsHref={escalationsHref}
      />
      <OverviewAiInsightPanel board={board} />
      <OverviewOutletsPanel board={board} />
    </div>
  );
}

const GLANCE_TONE: Record<OverviewInsightGlance["kind"], string> = {
  concern: "bg-rose-50 text-rose-700",
  strength: "bg-emerald-50 text-emerald-700",
  action: "bg-sky-50 text-sky-700",
};

function AiInsight({ board }: { board: OverviewBoard }) {
  const mentions = board.sentiment.positive + board.sentiment.negative;
  const generated = board.report?.finishedAt ? formatFriendlyDateTime(board.report.finishedAt) : "";
  const coverage = `${board.coverage.analysed.toLocaleString("en-US")} reviews analysed${
    board.coverage.ratingOnly > 0 ? `, ${board.coverage.ratingOnly.toLocaleString("en-US")} with no text` : ""
  }`;
  const maxStaff = Math.max(1, ...board.staff.map((row) => row.count));
  return (
    <section className="rounded-xl border border-[#e6ebf2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#163a7a]">AI insight</p>
          <h2 className="mt-1 text-base text-graphite" style={HEADING}>
            What customers are saying
          </h2>
          <p className="mt-1 text-xs text-slate">
            {coverage}
            {generated ? ` · saved report ${generated}` : ""}
            {board.report?.status === "partial" ? " · partial coverage" : ""}
          </p>
        </div>
        <Link href={board.insightsHref} className="shrink-0 text-xs font-medium text-[#2563eb] hover:underline">
          Open insights
        </Link>
      </div>

      {mentions === 0 && !board.report && board.severe.count === 0 ? (
        <p className="mt-4 text-sm text-slate">
          No analysed review text for this period. Open insights to run analysis.
        </p>
      ) : (
        <div className="mt-4 grid items-start gap-5 xl:grid-cols-12">
          <div className="xl:col-span-4">
            {mentions > 0 ? (
              <div className="flex items-center gap-4">
                <SentimentDonut positive={board.sentiment.positive} negative={board.sentiment.negative} centerLabel="praise" />
                <ul className="min-w-0 flex-1 space-y-2 text-sm">
                  <li className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Praise
                    </span>
                    <span className="tabular-nums text-graphite">{board.sentiment.positive.toLocaleString("en-US")}</span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate">
                      <span className="h-2 w-2 rounded-full bg-rose-500" /> Complaints
                    </span>
                    <span className="tabular-nums text-graphite">{board.sentiment.negative.toLocaleString("en-US")}</span>
                  </li>
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate">No praise or complaint mentions in analysed reviews for this period.</p>
            )}
            {mentions > 0 ? (
              <p className="mt-3 text-xs text-slate">
                Share of praise among praise and complaint mentions in analysed text. Positive (4–5★) in the chart counts reviews.
              </p>
            ) : null}
            {board.severe.count > 0 ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  {`${board.severe.count.toLocaleString("en-US")} serious ${board.severe.count === 1 ? "incident" : "incidents"}`}
                </p>
                {board.severe.excerpt ? (
                  <p className="mt-1 line-clamp-4 text-sm italic text-graphite">“{board.severe.excerpt}”</p>
                ) : null}
                {board.severe.stars !== null ? (
                  <p className="mt-1 text-xs text-slate">{board.severe.stars}★ review · customer allegation, verify before acting</p>
                ) : (
                  <p className="mt-1 text-xs text-slate">Customer allegation, verify before acting.</p>
                )}
              </div>
            ) : null}
            {board.staff.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate">Staff named in praise</p>
                <ul className="mt-2 space-y-2">
                  {board.staff.map((row) => (
                    <li key={row.name}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-graphite">{row.name}</span>
                        <span className="text-xs text-slate">{row.count.toLocaleString("en-US")}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]" aria-hidden="true">
                        <div className="h-full bg-emerald-500" style={{ width: `${(row.count / maxStaff) * 100}%` }} />
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
                <p className="text-sm text-slate">
                  Counted from analysed review text. A written AI report has not been saved for this period.
                </p>
                <ul className="mt-3 space-y-3">
                  {board.analysis.map((card) => (
                    <InsightGlance key={card.kind} card={card} />
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate">
                {board.report
                  ? "The saved report for this period has no written insight cards yet."
                  : "No saved AI report for this period. Open insights to write one from the analysed reviews."}
              </p>
            )}
            {board.report?.status === "partial" ? (
              <p className="mt-3 text-xs text-amber-800">
                This saved report does not cover every written review in the period.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {board.praiseThemes.length > 0 || board.themes.length > 0 ? (
        <div className="mt-5 border-t border-[#eef2f7] pt-4">
          <h3 className="text-sm text-graphite" style={HEADING}>
            Themes in analysed reviews
          </h3>
          <p className="mt-1 text-xs text-slate">
            Praise and complaints are ranked separately. A theme can lead praise and still be a smaller complaint. Complaint counts match Analytics.
          </p>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <ThemeRank
              title="Most praised"
              themes={board.praiseThemes}
              tone="praise"
              empty="No praise mentions in analysed reviews."
            />
            <ThemeRank
              title="Complaint themes"
              themes={board.themes}
              tone="complaint"
              empty="No complaint mentions in analysed reviews."
              action={
                <Link href={complaintThemesHref(board.analyticsHref)} className="text-xs font-medium text-[#2563eb] hover:underline">
                  All complaint themes
                </Link>
              }
            />
          </div>
        </div>
      ) : null}
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
  const mentions = `${count.toLocaleString("en-US")} ${kind} ${count === 1 ? "mention" : "mentions"}`;
  if (reviews > 0 && reviews !== count) {
    return `${mentions} in ${reviews.toLocaleString("en-US")} ${reviews === 1 ? "review" : "reviews"}`;
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
  const bar = tone === "praise" ? "bg-emerald-500" : "bg-rose-400";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm text-graphite" style={HEADING}>
          {title}
        </h4>
        {action}
      </div>
      {themes.length === 0 ? (
        <p className="mt-3 text-sm text-slate">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {themes.map((theme) => (
            <li key={theme.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <Link href={theme.href} className="text-graphite hover:underline">
                  {theme.label}
                </Link>
                <span className="text-right text-xs text-slate">{mentionLine(theme.count, theme.reviews, tone)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#eef2f7]" aria-hidden="true">
                <div className={`h-full ${bar}`} style={{ width: `${(theme.count / max) * 100}%` }} />
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
    <li className="rounded-lg border border-[#eef2f7] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", GLANCE_TONE[card.kind])}>
          {card.label}
        </span>
        {card.severity ? <span className="text-[11px] text-slate">Severity {card.severity}/5</span> : null}
      </div>
      <p className="mt-2 text-sm font-medium text-graphite">{card.title}</p>
      <p className="mt-1 text-sm leading-6 text-slate">{card.detail}</p>
      {card.excerpt ? <p className="mt-2 line-clamp-3 text-xs italic text-slate">“{card.excerpt}”</p> : null}
      {card.supportingReviews > 0 ? (
        <p className="mt-2 text-xs text-slate">
          {card.supportingReviews.toLocaleString("en-US")} supporting review{card.supportingReviews === 1 ? "" : "s"}
        </p>
      ) : null}
    </li>
  );
}

function WorstStore({ store, scopeRating }: { store: OverviewStoreRow; scopeRating: number | null }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-[#163a7a] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#163a7a]">Lowest rated outlet</p>
      <h2 className="mt-2 text-lg text-graphite" style={HEADING}>
        <Link href={store.href} className="hover:underline">
          {store.name}
        </Link>
      </h2>
      <p className="mt-1 text-xs text-slate">
        {store.groupName ? `${store.groupName} · ` : ""}
        {store.rank} of {store.rankedCount} · {store.reviews.toLocaleString("en-US")} reviews
      </p>
      <p className="mt-4 text-[32px] leading-none text-graphite" style={HEADING}>
        {store.rating.toFixed(2)}
      </p>
      <p className="mt-2 text-sm text-slate">{changeLabel(store.ratingChange)} vs the previous period</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Scope average</dt>
          <dd className="tabular-nums text-graphite">{ratingLabel(scopeRating)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate">1–3 star share</dt>
          <dd>
            <Link href={store.negativeHref} className="tabular-nums text-graphite hover:underline">
              {pct(store.negativeShare)}
            </Link>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Reply rate</dt>
          <dd>
            <Link href={store.assignHref} className="tabular-nums text-graphite hover:underline">
              {pct(store.replyRate)}
            </Link>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Main complaint</dt>
          <dd className="text-right text-graphite">{store.complaint ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Link href={store.href} className="inline-flex h-9 items-center rounded-full border border-[#e6ebf2] px-3 text-sm text-graphite hover:border-[#163a7a]">
          Open outlet
        </Link>
        <Link href={store.assignHref} className="inline-flex h-9 items-center rounded-full border border-[#e6ebf2] px-3 text-sm text-graphite hover:border-[#163a7a]">
          Assign follow-up
        </Link>
      </div>
    </section>
  );
}
