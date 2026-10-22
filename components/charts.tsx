import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { StarCounts } from "@/lib/metrics";
import { bucketMetrics, monthlySeriesMetrics } from "@/lib/chart-metrics";
import { cn } from "@/lib/utils";

const TIP_FONT = { fontFamily: "var(--font-heading), sans-serif" };

/** Hover card for a chart mark: the mark's own numbers, then 1★–5★. */
export function ChartTip({
  title,
  lines,
  stars,
  className,
  style,
}: {
  title: string;
  lines?: string[];
  stars?: StarCounts | null;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-20 hidden w-max max-w-[18rem] rounded-md border border-[#e6ebf2] bg-white px-2.5 py-1.5 text-left shadow-[0_4px_12px_rgba(16,24,40,0.12)] group-hover:block group-focus-visible:block",
        className
      )}
      style={style}
    >
      <span className="block text-sm tabular-nums text-graphite" style={TIP_FONT}>
        {title}
      </span>
      {lines?.map((line, index) => (
        <span key={`${index}-${line}`} className="block text-[10px] leading-snug tabular-nums text-slate">
          {line}
        </span>
      ))}
      {stars ? (
        <span className="mt-1.5 grid grid-cols-5 gap-2 border-t border-[#eef2f7] pt-1.5">
          {stars.map((count, index) => (
            <span key={index} className="text-center">
              <span className="block text-[11px] tabular-nums text-graphite">{count.toLocaleString("en-US")}</span>
              <span className="block text-[10px] text-slate">{index + 1}★</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Visible metrics strip rendered under every graph. Items must be
 * computed from the same series the graph draws (see lib/chart-metrics)
 * — never decorative numbers.
 */
export function MetricStrip({
  items,
}: {
  items: Array<{ label: string; value: string; sub?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#eef2f7] pt-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate">{item.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-graphite">{item.value}</dd>
          {item.sub ? <dd className="text-[11px] tabular-nums text-slate">{item.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export const CHART = {
  blue: "#2563eb",
  sky: "#38bdf8",
  green: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  orange: "#f97316",
  indigo: "#6366f1",
  slate: "#94a3b8",
  track: "#e8eef8",
} as const;

export const STAR_COLORS = ["#f43f5e", "#fb7185", "#f59e0b", "#34d399", "#10b981"] as const;

export function ChartCard({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-silver bg-white p-4 shadow-[0_1px_2px_rgba(15,39,79,0.04)] sm:p-5",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>
            {title}
          </h2>
          {hint ? <p className="mt-0.5 text-xs text-slate">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Horizontal bars for a short ranking (rating mix, reply buckets, themes). */
export function HBarChart({
  rows,
  max,
}: {
  rows: Array<{
    id?: string;
    label: string;
    value: number;
    color: string;
    href?: string;
    suffix?: string;
    lines?: string[];
    stars?: StarCounts | null;
  }>;
  max: number;
}) {
  const ceiling = Math.max(1, max);
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const inner = (
          <>
            <span className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-graphite">{row.label}</span>
              <span className="shrink-0 tabular-nums text-slate">
                {row.value.toLocaleString("en-US")}
                {row.suffix ? ` ${row.suffix}` : ""}
              </span>
            </span>
            <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full" style={{ background: CHART.track }}>
              <span
                className="block h-full rounded-full transition-[width]"
                style={{ width: `${(row.value / ceiling) * 100}%`, background: row.color }}
              />
            </span>
          </>
        );
        const tip = (
          <ChartTip
            title={`${row.label} · ${row.value.toLocaleString("en-US")}`}
            lines={[...(row.suffix ? [row.suffix.replace(/^·\s*/, "")] : []), ...(row.lines ?? [])]}
            stars={row.stars}
            className="bottom-full left-0 mb-1"
          />
        );
        return (
          <li key={row.id ?? row.label} className="group relative hover:z-20">
            {row.href ? (
              <a href={row.href} className="block hover:opacity-90">
                {inner}
              </a>
            ) : (
              inner
            )}
            {tip}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical stacked month bars with an optional average-rating line. */
export function MonthVolumeChart({
  months,
}: {
  months: Array<{
    key: string;
    label: string;
    positive: number;
    neutral: number;
    negative: number;
    avgRating: number | null;
    href?: string;
    stars?: StarCounts | null;
  }>;
}) {
  const totals = months.map((month) => month.positive + month.neutral + month.negative);
  const max = Math.max(1, ...totals);
  const ratings = months.flatMap((month) => (month.avgRating === null ? [] : [month.avgRating]));
  const ratingMin = ratings.length ? Math.min(...ratings) : 1;
  const ratingMax = ratings.length ? Math.max(...ratings) : 5;
  const span = Math.max(0.2, ratingMax - ratingMin);

  return (
    <div>
      <div className="relative h-64">
        <div className="flex h-full items-end gap-1.5 sm:gap-2" role="img" aria-label="Reviews by month">
          {months.map((month, index) => {
            const total = month.positive + month.neutral + month.negative;
            const height = total === 0 ? 0 : Math.max(8, (total / max) * 62);
            const tipAlign = index === 0 ? "left-0" : index === months.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
            const bar = (
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: `${height}%` }}
              >
                {total > 0 ? (
                  <>
                    <div style={{ height: `${(month.positive / total) * 100}%`, background: CHART.green }} />
                    <div style={{ height: `${(month.neutral / total) * 100}%`, background: CHART.amber }} />
                    <div style={{ height: `${(month.negative / total) * 100}%`, background: CHART.rose }} />
                  </>
                ) : (
                  <div className="h-1 w-full rounded-sm" style={{ background: CHART.track }} />
                )}
              </div>
            );
            const tip = (
              <ChartTip
                title={`${month.label} · ${total.toLocaleString("en-US")}`}
                lines={[
                  `${month.positive.toLocaleString("en-US")} positive · ${month.neutral.toLocaleString("en-US")} neutral · ${month.negative.toLocaleString("en-US")} negative`,
                  month.avgRating === null ? "No average" : `Average ${month.avgRating.toFixed(2)}`,
                ]}
                stars={month.stars}
                className={tipAlign}
                style={{ bottom: `calc(${height}% + 6px)` }}
              />
            );
            return (
              <div key={month.key} className="group relative z-0 flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:z-20 focus-within:z-20">
                {tip}
                {month.href ? (
                  <a href={month.href} className="flex h-full w-full flex-col items-center justify-end" aria-label={`${month.label}: ${total} reviews`}>
                    {bar}
                  </a>
                ) : (
                  bar
                )}
              </div>
            );
          })}
        </div>
        {ratings.length > 1 ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <polyline
              fill="none"
              stroke={CHART.blue}
              strokeWidth="1.8"
              vectorEffect="non-scaling-stroke"
              points={months
                .map((month, index) => {
                  if (month.avgRating === null || totals[index] === 0) return null;
                  const x = months.length === 1 ? 50 : (index / (months.length - 1)) * 100;
                  const y = ((ratingMax - month.avgRating) / span) * 78 + 8;
                  return `${x},${y}`;
                })
                .filter((point): point is string => point !== null)
                .join(" ")}
            />
          </svg>
        ) : null}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2">
        {months.map((month) => (
          <span key={month.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-slate">
            {month.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate">
        <LegendDot color={CHART.green} label="4–5★" />
        <LegendDot color={CHART.amber} label="3★" />
        <LegendDot color={CHART.rose} label="1–2★" />
        <LegendDot color={CHART.blue} label="Avg rating" line />
      </div>
      {(() => {
        const m = monthlySeriesMetrics(
          months.map((month) => ({
            ...month,
            // X labels repeat every year; metric labels must not ("Dec ’24", not "Dec").
            label: /^\d{4}-\d{2}/.test(month.key) ? `${month.label} ’${month.key.slice(2, 4)}` : month.label,
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

/** Donut for positive / neutral / negative share. */
export function SentimentDonut({
  positive,
  neutral,
  negative,
  stars,
}: {
  positive: number;
  neutral: number;
  negative: number;
  stars?: StarCounts | null;
}) {
  const total = positive + neutral + negative;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { value: positive, color: CHART.green, label: "Positive" },
    { value: neutral, color: CHART.amber, label: "Neutral" },
    { value: negative, color: CHART.rose, label: "Negative" },
  ];
  let offset = 0;

  const bandStars: Record<string, StarCounts> | null = stars
    ? {
        Positive: [0, 0, 0, stars[3], stars[4]],
        Neutral: [0, 0, stars[2], 0, 0],
        Negative: [stars[0], stars[1], 0, 0, 0],
      }
    : null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="group relative">
      <ChartTip
        title={`${total.toLocaleString("en-US")} reviews`}
        lines={["Positive is 4–5★. Neutral is 3★. Negative is 1–2★."]}
        stars={stars}
        className="bottom-full left-1/2 mb-1 -translate-x-1/2"
      />
      <svg viewBox="0 0 120 120" className="size-36 shrink-0" role="img" aria-label="Sentiment mix">
        <circle cx="60" cy="60" r={radius} fill="none" stroke={CHART.track} strokeWidth="12" />
        {total === 0 ? null : (
          segments.map((segment) => {
            if (segment.value === 0) return null;
            const length = (segment.value / total) * circumference;
            const node = (
              <circle
                key={segment.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth="12"
                strokeLinecap="butt"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += length;
            return node;
          })
        )}
        <text x="60" y="56" textAnchor="middle" fill="#1e293b" fontSize="18" fontFamily="var(--font-heading), sans-serif">
          {total.toLocaleString("en-US")}
        </text>
        <text x="60" y="74" textAnchor="middle" fill="#64748b" fontSize="11">
          reviews
        </text>
      </svg>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.label} className="group relative flex items-center justify-between gap-3 hover:z-20">
            <ChartTip
              title={`${segment.label} · ${segment.value.toLocaleString("en-US")}`}
              lines={[total > 0 ? `${Math.round((segment.value / total) * 100)}% of reviews` : "No reviews"]}
              stars={bandStars?.[segment.label]}
              className="bottom-full left-0 mb-1"
            />
            <span className="flex items-center gap-2 text-graphite">
              <span className="size-2.5 rounded-full" style={{ background: segment.color }} aria-hidden />
              {segment.label}
            </span>
            <span className="tabular-nums text-slate">
              {segment.value.toLocaleString("en-US")}
              {total > 0 ? ` · ${Math.round((segment.value / total) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact rating score ring. */
export function ScoreRing({ score, caption }: { score: number | null; caption: string }) {
  const value = score ?? 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const color = score === null ? CHART.slate : score >= 80 ? CHART.green : score >= 60 ? CHART.amber : CHART.rose;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="size-32" role="img" aria-label={score === null ? "No score" : `Score ${score}`}>
        <circle cx="60" cy="60" r={radius} fill="none" stroke={CHART.track} strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={score === null ? circumference : circumference - (value / 100) * circumference}
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="56" textAnchor="middle" fill="#1e293b" fontSize="24" fontFamily="var(--font-heading), sans-serif">
          {score === null ? "—" : score}
        </text>
        <text x="60" y="74" textAnchor="middle" fill="#64748b" fontSize="11">
          /100
        </text>
      </svg>
      <p className="text-xs text-slate">{caption}</p>
    </div>
  );
}

/** Vertical bars for a short distribution such as reply time. */
export function VBarChart({
  rows,
}: {
  rows: Array<{ label: string; value: number; href?: string; lines?: string[]; stars?: StarCounts | null }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const buckets = bucketMetrics(rows);
  return (
    <div>
    <div className="flex h-52 items-end gap-2 sm:gap-4">
      {rows.map((row, index) => {
        const height = row.value === 0 ? 4 : Math.max(12, Math.round((row.value / max) * 128));
        const tipAlign = index === 0 ? "left-0" : index === rows.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
        const bar = (
          <span className="flex w-full flex-col items-center justify-end">
            <span className="mb-1 text-xs tabular-nums text-slate">{row.value.toLocaleString("en-US")}</span>
            <span className="block w-full max-w-16 rounded-t-md bg-navy" style={{ height }} />
          </span>
        );
        return (
          <div key={row.label} className="group relative z-0 flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:z-20">
            <ChartTip
              title={`${row.label} · ${row.value.toLocaleString("en-US")}`}
              lines={row.lines}
              stars={row.stars}
              className={tipAlign}
              style={{ bottom: height + 28 }}
            />
            {row.href ? (
              <Link href={row.href} className="flex w-full flex-col items-center text-navy" aria-label={`${row.label}: ${row.value}`}>
                {bar}
              </Link>
            ) : (
              bar
            )}
            <span className="mt-2 text-center text-[11px] leading-tight text-slate sm:text-xs">{row.label}</span>
          </div>
        );
      })}
    </div>
    {buckets.largest ? (
      <MetricStrip
        items={[
          { label: "Total", value: buckets.total.toLocaleString("en-US"), sub: `across ${rows.length} buckets` },
          {
            label: "Largest bucket",
            value: buckets.largest.label,
            sub: `${buckets.largest.value.toLocaleString("en-US")} · ${Math.round(buckets.largest.share * 100)}% of total`,
          },
        ]}
      />
    ) : null}
    </div>
  );
}

function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? (
        <span className="h-0.5 w-4" style={{ background: color }} aria-hidden />
      ) : (
        <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      )}
      {label}
    </span>
  );
}
