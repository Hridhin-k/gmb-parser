import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { StarCounts } from "@/lib/metrics";
import { bucketMetrics, monthlySeriesMetrics } from "@/lib/chart-metrics";
import { cn } from "@/lib/utils";

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
        "pointer-events-none absolute z-20 hidden w-max max-w-[18rem] rounded-md border border-line bg-white px-2.5 py-1.5 text-left shadow-[0_4px_12px_rgba(20,24,31,0.12)] group-hover:block group-focus-within:block group-focus-visible:block",
        className
      )}
      style={style}
    >
      <span className="block text-[13px] font-semibold tabular-nums text-ink">
        {title}
      </span>
      {lines?.map((line, index) => (
        <span key={`${index}-${line}`} className="block text-[11px] leading-snug tabular-nums text-ink-3">
          {line}
        </span>
      ))}
      {stars ? (
        <span className="mt-1.5 grid grid-cols-5 gap-2 border-t border-line-2 pt-1.5">
          {stars.map((count, index) => (
            <span key={index} className="text-center">
              <span className="block text-[11px] tabular-nums text-ink">{count.toLocaleString("en-US")}</span>
              <span className="block text-[10px] text-ink-3">{index + 1}★</span>
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
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-2 pt-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-ink-3">{item.label}</dt>
          <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-ink">{item.value}</dd>
          {item.sub ? <dd className="text-[11px] tabular-nums text-ink-3">{item.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * Chart palette, aligned with the design tokens in app/globals.css
 * (brand, ok, warn, bad, info, star). Keys are kept for callers; the values
 * follow the redesign.
 */
export const CHART = {
  blue: "#1F4ED8",
  sky: "#0E7490",
  green: "#15803D",
  amber: "#D97706",
  rose: "#B91C1C",
  orange: "#B45309",
  indigo: "#4361C9",
  slate: "#687283",
  track: "#EEF0F3",
  /** Neutral band (3★) and "other" segments. */
  neutral: "#C4CAD4",
  /** Comparison series (previous period). */
  previous: "#B9C7F3",
} as const;

/** 1★ … 5★. Low ratings carry the warning colours; 3★ is neutral. */
export const STAR_COLORS = ["#B91C1C", "#B45309", "#9AA3B2", "#4F74E0", "#1F4ED8"] as const;

/** Rounds a chart ceiling up to 1, 2, 2.5 or 5 × 10ⁿ so axis ticks read cleanly. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function compact(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(value).toLocaleString("en-US");
}

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
        "min-w-0 rounded-lg border border-line bg-white p-4",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
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
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const inner = (
          <>
            <span className="flex items-center justify-between gap-3 text-[13px]">
              <span className="truncate text-ink-2">{row.label}</span>
              <span className="shrink-0 tabular-nums text-ink-3">
                {row.value.toLocaleString("en-US")}
                {row.suffix ? ` ${row.suffix}` : ""}
              </span>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-[3px]" style={{ background: CHART.track }}>
              <span
                className="block h-full rounded-[3px] transition-[width]"
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
              <a href={row.href} className="block rounded-sm outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-line">
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

/** Y-axis tick labels for a plot whose ceiling is `max`. */
function YAxis({ max, className }: { max: number; className?: string }) {
  return (
    <div
      className={cn("flex h-full w-8 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-ink-3", className)}
      aria-hidden
    >
      <span className="-translate-y-1/2">{compact(max)}</span>
      <span>{compact(max / 2)}</span>
      <span className="translate-y-1/2">0</span>
    </div>
  );
}

/** Three faint gridlines (top, middle, baseline) behind a bar plot. */
function GridLines() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
      <span className="border-t border-dashed border-line-2" />
      <span className="border-t border-dashed border-line-2" />
      <span className="border-t border-line" />
    </div>
  );
}

/** Vertical stacked month bars. Height is review count. */
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
  const max = niceCeiling(Math.max(1, ...totals));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <LegendDot color={CHART.green} label="4–5★" />
        <LegendDot color={CHART.neutral} label="3★" />
        <LegendDot color={CHART.rose} label="1–2★" />
        <span className="ml-auto">Reviews per month</span>
      </div>
      <div className="flex h-56 gap-2">
        <YAxis max={max} />
        <div className="relative min-w-0 flex-1">
          <GridLines />
          <div
            className="relative flex h-full items-end gap-1 sm:gap-2"
            role="img"
            aria-label="Reviews by month. Bar height is review count."
          >
            {months.map((month, index) => {
              const total = month.positive + month.neutral + month.negative;
              const height = total === 0 ? 0 : Math.max(2, (total / max) * 100);
              const tipAlign =
                index === 0 ? "left-0" : index === months.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
              const bar = (
                <div
                  className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-[3px]"
                  style={{ height: `${height}%` }}
                >
                  {total > 0 ? (
                    <>
                      <div style={{ height: `${(month.positive / total) * 100}%`, background: CHART.green }} />
                      <div style={{ height: `${(month.neutral / total) * 100}%`, background: CHART.neutral }} />
                      <div style={{ height: `${(month.negative / total) * 100}%`, background: CHART.rose }} />
                    </>
                  ) : null}
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
                <div
                  key={month.key}
                  className="group relative z-0 flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:z-20 focus-within:z-20"
                >
                  {tip}
                  {month.href ? (
                    <a
                      href={month.href}
                      className="flex h-full w-full flex-col items-center justify-end outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-line"
                      aria-label={`${month.label}: ${total} reviews`}
                    >
                      {bar}
                    </a>
                  ) : (
                    bar
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex gap-1 pl-10 sm:gap-2" aria-hidden>
        {months.map((month) => (
          <span key={month.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-3">
            {month.label}
          </span>
        ))}
      </div>
      {(() => {
        const m = monthlySeriesMetrics(
          months.map((month) => ({
            ...month,
            // X labels that are only the month name need the year ("Dec" → "Dec ’24").
            label:
              /^\d{4}-\d{2}/.test(month.key) && !month.label.includes(month.key.slice(2, 4))
                ? `${month.label} ’${month.key.slice(2, 4)}`
                : month.label,
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
    { value: positive, color: CHART.green, label: "Positive", band: "4–5★" },
    { value: neutral, color: CHART.neutral, label: "Neutral", band: "3★" },
    { value: negative, color: CHART.rose, label: "Negative", band: "1–2★" },
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
        <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label="Sentiment mix">
          <circle cx="60" cy="60" r={radius} fill="none" stroke={CHART.track} strokeWidth="12" />
          {total === 0
            ? null
            : segments.map((segment) => {
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
              })}
          <text x="60" y="58" textAnchor="middle" fill="#14181F" fontSize="18" fontWeight="600">
            {total.toLocaleString("en-US")}
          </text>
          <text x="60" y="74" textAnchor="middle" fill="#687283" fontSize="11">
            reviews
          </text>
        </svg>
      </div>
      <ul className="w-full space-y-2 text-[13px]">
        {segments.map((segment) => (
          <li key={segment.label} className="group relative flex items-center justify-between gap-3 hover:z-20">
            <ChartTip
              title={`${segment.label} · ${segment.value.toLocaleString("en-US")}`}
              lines={[total > 0 ? `${Math.round((segment.value / total) * 100)}% of reviews` : "No reviews"]}
              stars={bandStars?.[segment.label]}
              className="bottom-full left-0 mb-1"
            />
            <span className="flex items-center gap-2 text-ink-2">
              <span className="size-2.5 rounded-sm" style={{ background: segment.color }} aria-hidden />
              {segment.label}
              <span className="text-xs text-ink-3">{segment.band}</span>
            </span>
            <span className="tabular-nums text-ink-3">
              {segment.value.toLocaleString("en-US")}
              {total > 0 ? ` · ${Math.round((segment.value / total) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
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
      <div className="flex h-48 items-end gap-2 border-b border-line sm:gap-4">
        {rows.map((row, index) => {
          const height = row.value === 0 ? 3 : Math.max(10, Math.round((row.value / max) * 128));
          const tipAlign = index === 0 ? "left-0" : index === rows.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
          const bar = (
            <span className="flex w-full flex-col items-center justify-end">
              <span className="mb-1 text-xs tabular-nums text-ink-2">{row.value.toLocaleString("en-US")}</span>
              <span className="block w-full max-w-14 rounded-t-[3px] bg-brand" style={{ height }} />
            </span>
          );
          return (
            <div key={row.label} className="group relative z-0 flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:z-20">
              <ChartTip
                title={`${row.label} · ${row.value.toLocaleString("en-US")}`}
                lines={row.lines}
                stars={row.stars}
                className={tipAlign}
                style={{ bottom: height + 22 }}
              />
              {row.href ? (
                <Link
                  href={row.href}
                  className="flex w-full flex-col items-center outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-line"
                  aria-label={`${row.label}: ${row.value}`}
                >
                  {bar}
                </Link>
              ) : (
                bar
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2 sm:gap-4" aria-hidden>
        {rows.map((row) => (
          <span key={row.label} className="min-w-0 flex-1 text-center text-[11px] leading-tight text-ink-3 sm:text-xs">
            {row.label}
          </span>
        ))}
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

/** Legend row for a chart: coloured swatch (or line) and a label per series. */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ color: string; label: string; line?: boolean }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3", className)}>
      {items.map((item) => (
        <LegendDot key={item.label} {...item} />
      ))}
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
