import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { CHART, ScoreRing, SentimentDonut } from "@/components/charts";
import { ReplyTargetForm } from "@/components/reply-target-form";
import { cn } from "@/lib/utils";
import type { ClientOverview, NewestReviewCard } from "@/lib/services/overview";

const HEADING = { fontFamily: "var(--font-heading), sans-serif" };

export interface DashboardReview extends NewestReviewCard {
  locationName: string;
  href: string;
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
  if (current === null || previous === null) {
    return <span className="text-xs text-slate">No earlier period</span>;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return <span className="text-xs text-slate">0 {suffix}</span>;
  }
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={cn("text-xs font-medium", good ? "text-emerald-600" : "text-rose-500")}>
      {diff > 0 ? "+" : "−"}
      {format(Math.abs(diff))} {suffix}
    </span>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating} of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < rating ? "text-amber-400" : "text-[#e5e7eb]"} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const width = 88;
  const height = 28;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (value / max) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-20" aria-hidden>
      <polyline fill="none" stroke={CHART.blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-[#e6ebf2] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5", className)}>
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

function ReportLink({ href, label = "Full report" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="shrink-0 text-xs font-medium text-[#2563eb] hover:underline">
      {label}
    </Link>
  );
}

function snippet(comment: string | null) {
  const text = comment?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "Rating only — no written comment.";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function ClientOverviewView({
  data,
  period,
  reviews = [],
  links,
}: {
  data: ClientOverview;
  reviews?: DashboardReview[];
  links?: { reviews: string; analytics: string };
  period?: {
    openEscalations: number;
    overdueEscalations: number;
    previousOpen: number | null;
    previousOverdue: number | null;
    replyTarget: number | null;
    insights: string[];
    lowest: ClientOverview["lowest"];
    themes: Array<{ label: string; count: number; href: string }>;
    timezone: string;
    canSetTarget: boolean;
    stars: [number, number, number, number, number];
    replied: number;
    previousReplied: number | null;
    top: ClientOverview["lowest"];
  };
}) {
  const reviewsHref = links?.reviews ?? "/reviews";
  const analyticsHref = links?.analytics ?? "/analytics";
  const spark = data.months.map((month) => month.reviewCount);
  const score = data.current.avgRating === null ? null : Math.round((data.current.avgRating / 5) * 100);
  const stars = period?.stars ?? [0, 0, 0, 0, 0];
  const positive = stars[3] + stars[4];
  const neutral = stars[2];
  const negative = stars[0] + stars[1];
  const sentimentTotal = positive + neutral + negative;
  const band = (count: number) => (sentimentTotal === 0 ? 0 : (count / sentimentTotal) * 100);
  const top = period?.top ?? [];
  const previousRating = data.previous?.avgRating ?? null;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <Panel
          title="Newest reviews"
          action={
            <span className="text-xs text-slate">
              {data.current.reviewCount.toLocaleString("en-US")} in this period
            </span>
          }
        >
          {reviews.length === 0 ? (
            <p className="mt-4 text-sm text-slate">No reviews in this period.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {reviews.map((review) => (
                <li key={review.id}>
                  <Link
                    href={review.href}
                    className="block rounded-xl border border-[#eef2f7] border-l-4 border-l-[#3b82f6] bg-white px-3 py-3 hover:border-[#d7e3f5]"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-graphite">{review.locationName}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate">
                        <span className="size-2 rounded-full bg-[#4285f4]" aria-hidden />
                        Google
                      </span>
                    </span>
                    <span className="mt-2 flex items-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-xs font-medium text-[#163a7a]">
                        {review.reviewer.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-graphite">{review.reviewer}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-2">
                          <Stars rating={review.rating} />
                          <span className="text-[11px] text-slate">
                            {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 block text-sm leading-5 text-slate">{snippet(review.comment)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ReportLink href={reviewsHref} label="Open inbox" />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Reporting totals" action={<span className="text-xs text-slate">This period</span>}>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <article className="rounded-xl border border-[#eef2f7] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate">Reviews</p>
                  <ReportLink href={analyticsHref} />
                </div>
                <p className="mt-2 text-[28px] leading-none text-graphite" style={HEADING}>
                  {data.current.reviewCount.toLocaleString("en-US")}
                </p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <Spark values={spark} />
                  <Delta
                    current={data.current.reviewCount}
                    previous={data.previous?.reviewCount ?? null}
                    format={(diff) => diff.toLocaleString("en-US")}
                    suffix="since last period"
                  />
                </div>
              </article>
              <article className="rounded-xl border border-[#eef2f7] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate">Average rating</p>
                  <ReportLink href={analyticsHref} />
                </div>
                <p className="mt-2 text-[28px] leading-none text-graphite" style={HEADING}>
                  {data.current.avgRating === null ? "—" : data.current.avgRating.toFixed(1)}
                  <span className="ml-1 text-sm text-slate">of 5</span>
                </p>
                <div className="mt-2">
                  <Delta
                    current={data.current.avgRating}
                    previous={previousRating}
                    format={(diff) => diff.toFixed(2)}
                    suffix="since last period"
                  />
                </div>
              </article>
              <article className="rounded-xl border border-[#eef2f7] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-slate">Replies</p>
                  <ReportLink href={reviewsHref} />
                </div>
                <p className="mt-2 text-[28px] leading-none text-graphite" style={HEADING}>
                  {(period?.replied ?? 0).toLocaleString("en-US")}
                </p>
                <div className="mt-2">
                  <Delta
                    current={period?.replied ?? null}
                    previous={period?.previousReplied ?? null}
                    format={(diff) => diff.toLocaleString("en-US")}
                    suffix="since last period"
                  />
                </div>
              </article>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Rating score" action={<ReportLink href={analyticsHref} />}>
              <div className="mt-2 flex justify-center">
                <ScoreRing
                  score={score}
                  caption={
                    score === null
                      ? "No reviews in this period."
                      : `${data.current.avgRating?.toFixed(2)} average, shown out of 100.`
                  }
                />
              </div>
            </Panel>

            <Panel title="Top performing locations" action={<ReportLink href={analyticsHref} />}>
              {top.length === 0 ? (
                <p className="mt-3 text-sm text-slate">No location has reviews in this period.</p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-slate">
                      <th className="pb-2 font-medium">Location</th>
                      <th className="pb-2 text-right font-medium">Avg. rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((location, index) => (
                      <tr key={location.id} className="border-t border-[#eef2f7]">
                        <td className="py-2 pr-3">
                          <Link href={location.href} className="text-graphite hover:text-[#163a7a]">
                            <span className="mr-2 text-slate">{index + 1}</span>
                            {location.name}
                          </Link>
                        </td>
                        <td className="py-2 text-right tabular-nums text-graphite">{location.rating.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          <Panel title="Sentiment breakdown" action={<ReportLink href={analyticsHref} />}>
            {sentimentTotal === 0 ? (
              <p className="mt-3 text-sm text-slate">No reviews in this period.</p>
            ) : (
              <>
                <SentimentDonut positive={positive} neutral={neutral} negative={negative} />
                <p className="mt-2 text-[11px] text-slate">
                  Positive is 4–5 stars, neutral is 3 stars, negative is 1–2 stars.
                  {` Positive ${Math.round(band(positive))}%, neutral ${Math.round(band(neutral))}%, negative ${Math.round(band(negative))}%.`}
                </p>
              </>
            )}
          </Panel>
        </div>
      </div>

      {period ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Needs attention">
            {data.attention.length === 0 ? (
              <p className="mt-3 text-sm text-slate">Nothing is waiting in the reply queue.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[#eef2f7]">
                {data.attention.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="block py-3 hover:text-[#163a7a]">
                      <p className="text-sm font-medium text-graphite">{item.title}</p>
                      <p className="mt-0.5 text-xs text-slate">{item.detail}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate">
              {period.openEscalations.toLocaleString("en-US")} open escalations, {period.overdueEscalations.toLocaleString("en-US")} past the due time.
            </p>
            {period.insights.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-graphite">
                {period.insights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </Panel>
          <div className="space-y-4">
            {period.canSetTarget ? <ReplyTargetForm target={period.replyTarget} /> : null}
            <Panel title="Complaint themes">
              {period.themes.length === 0 ? (
                <p className="mt-3 text-sm text-slate">No 1–3 star reviews in this period.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {period.themes.map((theme) => (
                    <li key={theme.label}>
                      <Link href={theme.href} className="flex items-baseline justify-between gap-3 text-sm text-graphite hover:text-[#163a7a]">
                        <span>{theme.label}</span>
                        <span className="tabular-nums text-slate">{theme.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
