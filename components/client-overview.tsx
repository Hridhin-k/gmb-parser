import type { ReactNode } from "react";
import Link from "next/link";
import { HBarChart, MonthVolumeChart, STAR_COLORS } from "@/components/charts";
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

function changeLabel(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function ratingLabel(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
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
  const starMax = Math.max(1, ...board.starMix.map((row) => row.count));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 items-stretch gap-3 xl:grid-cols-5">
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
        <div className="col-span-2 h-full xl:col-span-1">
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

      <div className="grid items-stretch gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          {board.lowest.length > 0 ? (
            <Panel title="Lowest rated outlets" action={<Link href={board.analyticsHref} className="text-xs font-medium text-[#2563eb] hover:underline">See all {board.rankedCount}</Link>}>
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
                Sorted by average rating, lowest first. Change is against the previous period of the same length. Main complaint is that outlet&apos;s most common negative topic from analysed reviews. A dash means none was found.
              </p>
            </Panel>
          ) : (
            <Panel title="Lowest rated outlets">
              <p className="mt-3 text-sm text-slate">A ranking appears when this scope has two or more outlets with reviews.</p>
            </Panel>
          )}
        </div>
        <div className="xl:col-span-5">
          <Panel title="What customers are saying" action={<Link href={board.insightsHref} className="text-xs font-medium text-[#2563eb] hover:underline">Open insights</Link>}>
            {board.themes.length === 0 ? (
              <p className="mt-4 text-sm text-slate">No negative topics in analysed reviews for this period.</p>
            ) : (
              <div className="mt-4">
                <HBarChart
                  max={Math.max(1, ...board.themes.map((theme) => theme.count))}
                  rows={board.themes.map((theme) => ({
                    label: theme.label,
                    value: theme.count,
                    color: "#1f2937",
                    href: theme.href,
                    suffix: theme.reviews > 0 ? `· ${theme.reviews.toLocaleString("en-US")} reviews` : undefined,
                    lines: ["Negative mentions in analysed reviews"],
                  }))}
                />
              </div>
            )}
            <p className="mt-auto pt-3 text-xs text-slate">
              {`Negative topics from analysed review text. Counts are mentions, not 1–3 star reviews. ${board.coverage.analysed.toLocaleString("en-US")} analysed${board.coverage.ratingOnly > 0 ? `, ${board.coverage.ratingOnly.toLocaleString("en-US")} with no text` : ""}.`}
            </p>
          </Panel>
        </div>
      </div>

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
    </div>
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
