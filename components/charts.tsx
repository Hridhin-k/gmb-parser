import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  rows: Array<{ id?: string; label: string; value: number; color: string; href?: string; suffix?: string }>;
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
        return (
          <li key={row.id ?? row.label}>
            {row.href ? (
              <a href={row.href} className="block hover:opacity-90">
                {inner}
              </a>
            ) : (
              inner
            )}
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
      <div className="relative h-48">
        <div className="flex h-full items-end gap-1.5 sm:gap-2" role="img" aria-label="Reviews by month">
          {months.map((month) => {
            const total = month.positive + month.neutral + month.negative;
            const height = total === 0 ? 0 : Math.max(8, (total / max) * 100);
            const bar = (
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: `${height}%` }}
                title={`${month.label}: ${total} reviews`}
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
            return (
              <div key={month.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                {month.href ? (
                  <a href={month.href} className="flex h-full w-full flex-col items-center justify-end">
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
    </div>
  );
}

/** Donut for positive / neutral / negative share. */
export function SentimentDonut({
  positive,
  neutral,
  negative,
}: {
  positive: number;
  neutral: number;
  negative: number;
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

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
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
      <ul className="w-full space-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3">
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
