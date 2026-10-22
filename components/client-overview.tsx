import type { ReactNode } from "react";
import Link from "next/link";
import { ChartTip, CHART, MetricStrip } from "@/components/charts";
import { monthlySeriesMetrics } from "@/lib/chart-metrics";
import type { OverviewBoard, OverviewStoreRow } from "@/lib/overview-board";
import { cn } from "@/lib/utils";

const HEADING = { fontFamily: "var(--font-heading), sans-serif" };

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

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
  if (Math.abs(diff) < 1e-9) return <span className="text-xs text-slate">0 {suffix}</span>;
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
    <section className="rounded-xl border border-[#e6ebf2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base text-graphite" style={HEADING}>
          {title}
        </h2>
        {action}
      </div>
      {children}
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
    <Link href={href} className="rounded-xl border border-[#e6ebf2] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-[#163a7a]">
      <p className="text-xs text-slate">{label}</p>
      <p className="mt-2 text-[28px] leading-none text-graphite" style={HEADING}>
        {value}
      </p>
      <div className="mt-2">{detail}</div>
    </Link>
  );
}

function MonthChart({ months }: { months: OverviewBoard["months"] }) {
  const totals = months.map((month) => month.positive + month.negative);
  const max = Math.max(1, ...totals);
  const ratings = months.flatMap((month) => (month.avgRating === null ? [] : [month.avgRating]));
  const ratingMin = ratings.length ? Math.min(...ratings, 1) : 1;
  const ratingMax = ratings.length ? Math.max(...ratings, 5) : 5;
  const span = Math.max(0.2, ratingMax - ratingMin);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#d5dbe3]" aria-hidden />
          Positive (4–5★)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#1f2937]" aria-hidden />
          Negative (1–3★)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#163a7a]" aria-hidden />
          Average rating
        </span>
      </div>
      <div className="relative h-64">
        <div className="flex h-full items-end gap-1 sm:gap-2">
          {months.map((month, index) => {
            const total = month.positive + month.negative;
            const height = total === 0 ? 3 : Math.max(8, (total / max) * 58);
            const tipAlign =
              index === 0 ? "left-0" : index === months.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
            return (
              <Link
                key={month.key}
                href={month.href}
                className="group relative z-0 flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:z-20 focus-visible:z-20"
                aria-label={
                  month.avgRating === null
                    ? `${month.label}: ${total.toLocaleString("en-US")} reviews`
                    : `${month.label}: ${total.toLocaleString("en-US")} reviews, average ${month.avgRating.toFixed(2)}`
                }
              >
                <ChartTip
                  title={`${month.label} · ${total.toLocaleString("en-US")}`}
                  lines={[
                    `${month.positive.toLocaleString("en-US")} positive · ${month.negative.toLocaleString("en-US")} negative`,
                    month.avgRating === null ? "No average" : `Average ${month.avgRating.toFixed(2)}`,
                  ]}
                  stars={month.stars}
                  className={tipAlign}
                  style={{ bottom: `calc(${height}% + 6px)` }}
                />
                <span
                  className="flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-sm group-hover:brightness-95 group-focus-visible:brightness-95"
                  style={{ height: `${height}%` }}
                >
                  {total > 0 ? (
                    <>
                      <span style={{ height: `${(month.positive / total) * 100}%`, background: "#d5dbe3" }} />
                      <span style={{ height: `${(month.negative / total) * 100}%`, background: "#1f2937" }} />
                    </>
                  ) : (
                    <span className="h-1 w-full" style={{ background: CHART.track }} />
                  )}
                </span>
              </Link>
            );
          })}
        </div>
        {ratings.length > 1 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline
              fill="none"
              stroke="#163a7a"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
              points={months
                .map((month, index) => {
                  if (month.avgRating === null || month.positive + month.negative === 0) return null;
                  const x = months.length === 1 ? 50 : ((index + 0.5) / months.length) * 100;
                  const y = ((ratingMax - month.avgRating) / span) * 78 + 8;
                  return `${x},${y}`;
                })
                .filter((point): point is string => point !== null)
                .join(" ")}
            />
          </svg>
        ) : null}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-2">
        {months.map((month) => (
          <span key={month.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate">
            {month.label}
          </span>
        ))}
      </div>
      {(() => {
        // Same buckets the bars draw: positive = 4–5★, negative = 1–3★.
        const m = monthlySeriesMetrics(
          months.map((month) => ({
            // X labels repeat every year; metric labels must not ("Dec ’24", not "Dec").
            label: /^\d{4}-\d{2}/.test(month.key) ? `${month.label} ’${month.key.slice(2, 4)}` : month.label,
            positive: month.positive,
            negative: month.negative,
            avgRating: month.avgRating,
          }))
        );
        if (m.total === 0) return null;
        return (
          <MetricStrip
            items={[
              { label: "Total reviews", value: m.total.toLocaleString("en-US"), sub: `across ${months.length} months` },
              {
                label: "Average / month",
                value: Math.round(m.averagePerMonth).toLocaleString("en-US"),
                sub: `${m.monthsWithData} months with reviews`,
              },
              ...(m.peak
                ? [{ label: "Busiest month", value: m.peak.label, sub: `${m.peak.total.toLocaleString("en-US")} reviews` }]
                : []),
              ...(m.weightedAvgRating !== null
                ? [{ label: "Average rating", value: m.weightedAvgRating.toFixed(2), sub: "weighted by monthly volume" }]
                : []),
              ...(m.positiveShare !== null
                ? [
                    {
                      label: "Positive (4–5★)",
                      value: `${Math.round(m.positiveShare * 100)}%`,
                      sub:
                        m.positiveShareChangePoints === null
                          ? undefined
                          : `${m.positiveShareChangePoints >= 0 ? "+" : "−"}${Math.abs(m.positiveShareChangePoints).toFixed(1)} pts vs first month`,
                    },
                  ]
                : []),
            ]}
          />
        );
      })()}
    </div>
  );
}

function changeLabel(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.005) return "0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
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
  const { kpis } = board;
  const themeMax = Math.max(1, ...board.themes.map((theme) => theme.count));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          href={reviewsHref}
          label="Average rating"
          value={kpis.avgRating === null ? "—" : kpis.avgRating.toFixed(1)}
          detail={
            <Delta
              current={kpis.avgRating}
              previous={kpis.previousAvgRating}
              format={(diff) => diff.toFixed(1)}
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
          label="Negative reviews (1–3★)"
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
        {board.worst ? <WorstStore store={board.worst} scopeRating={kpis.avgRating} /> : (
          <Panel title="This outlet">
            <p className="mt-3 text-sm text-slate">
              {board.rankedCount === 0
                ? "No outlet in this scope has a review in the period."
                : "This scope is one outlet, so there is no ranking against other outlets."}
            </p>
          </Panel>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
        <Panel title="Reviews by month">
          {kpis.reviews === 0 ? (
            <p className="mt-4 text-sm text-slate">No reviews in this period.</p>
          ) : (
            <div className="mt-4">
              <MonthChart months={board.months} />
              {board.trendCaption ? <p className="mt-3 text-sm text-slate">{board.trendCaption}</p> : null}
            </div>
          )}
        </Panel>
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
        {board.lowest.length > 0 ? (
          <Panel title="Lowest rated outlets" action={<Link href={board.analyticsHref} className="text-xs font-medium text-[#2563eb] hover:underline">See all {board.rankedCount}</Link>}>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate">
                    <th className="pb-2 font-medium">Outlet</th>
                    <th className="pb-2 font-medium">Rating</th>
                    <th className="pb-2 font-medium">Change</th>
                    <th className="pb-2 font-medium">Negative</th>
                    <th className="pb-2 font-medium">Main complaint</th>
                  </tr>
                </thead>
                <tbody>
                  {board.lowest.map((store) => (
                    <tr key={store.id} className="border-t border-[#eef2f7]">
                      <td className="py-2 pr-3">
                        <Link href={store.href} className="font-medium text-graphite hover:text-[#163a7a]">
                          {store.name}
                        </Link>
                        <p className="text-xs text-slate">{store.reviews.toLocaleString("en-US")} reviews</p>
                      </td>
                      <td className="py-2 tabular-nums">{store.rating.toFixed(1)}</td>
                      <td className="py-2 tabular-nums">{changeLabel(store.ratingChange)}</td>
                      <td className="py-2">
                        <Link href={store.negativeHref} className="tabular-nums text-graphite hover:text-[#163a7a]">
                          {pct(store.negativeShare)}
                        </Link>
                      </td>
                      <td className="py-2 text-slate">{store.complaint ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate">
              Sorted by average rating, lowest first. Change is against the previous period of the same length.
              {board.themesTruncated ? " Complaint totals were too large to finish, so that column is blank." : ""}
            </p>
          </Panel>
        ) : (
          <Panel title="Lowest rated outlets">
            <p className="mt-3 text-sm text-slate">A ranking appears when this scope has two or more outlets with reviews.</p>
          </Panel>
        )}
        <Panel title="What customers are saying" action={<Link href={board.analyticsHref} className="text-xs font-medium text-[#2563eb] hover:underline">Open analytics</Link>}>
          {board.themes.length === 0 ? (
            <p className="mt-3 text-sm text-slate">No 1–3 star themes in this period.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {board.themes.map((theme) => (
                <li key={theme.label} className="group relative hover:z-20">
                  <Link href={theme.href} className="block hover:text-[#163a7a]">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-graphite">
                        {theme.label}
                        {theme.direction && theme.direction !== "steady" ? (
                          <span className="ml-2 text-xs text-slate">{theme.direction}</span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-slate">{theme.count.toLocaleString("en-US")}</span>
                    </span>
                    <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[#eef2f7]">
                      <span className="block h-full rounded-full bg-[#1f2937]" style={{ width: `${(theme.count / themeMax) * 100}%` }} />
                    </span>
                  </Link>
                  <ChartTip
                    title={`${theme.label} · ${theme.count.toLocaleString("en-US")}`}
                    lines={["1–3 star reviews with this theme"]}
                    stars={theme.stars}
                    className="bottom-full left-0 mb-1"
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate">Themes are the keywords stored on 1–3 star reviews. Praise is not classified.</p>
        </Panel>
      </div>

    </div>
  );
}

function WorstStore({ store, scopeRating }: { store: OverviewStoreRow; scopeRating: number | null }) {
  return (
    <section className="rounded-xl border border-[#163a7a] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#163a7a]">Worst performing outlet</p>
      <h2 className="mt-2 text-lg text-graphite" style={HEADING}>
        <Link href={store.href} className="hover:underline">
          {store.name}
        </Link>
      </h2>
      <p className="mt-1 text-xs text-slate">
        {store.groupName ? `${store.groupName} · ` : ""}
        Lowest average · {store.rank} of {store.rankedCount} · {store.reviews.toLocaleString("en-US")} reviews
      </p>
      <p className="mt-4 text-[32px] leading-none text-graphite" style={HEADING}>
        {store.rating.toFixed(1)}
      </p>
      <p className="mt-2 text-sm text-slate">{changeLabel(store.ratingChange)} vs the previous period</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Scope average</dt>
          <dd className="tabular-nums text-graphite">{scopeRating === null ? "—" : scopeRating.toFixed(1)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate">Negative reviews</dt>
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
      <div className="mt-4 flex flex-wrap gap-2">
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
