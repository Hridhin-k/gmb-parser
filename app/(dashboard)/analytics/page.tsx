import { Download } from "lucide-react";
import { getActiveWorkspace } from "@/lib/services/session";
import {
  getAnalyticsData,
  type TrendMonth,
  type TrendSummary,
} from "@/lib/services/analytics";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { PageHeader } from "@/components/page-header";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { cn } from "@/lib/utils";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_RANGE = "6m";

const JAKARTA = { fontFamily: "var(--font-heading), sans-serif" };

function monthLabel(iso: string, withYear = false) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function axisLabel(iso: string, dense: boolean) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: dense ? "2-digit" : "numeric",
    timeZone: "UTC",
  });
}

/** Evenly spaced indexes, always including the first and last month. */
function tickIndexes(count: number, maxTicks: number) {
  if (count <= 1) return [0];
  if (count <= maxTicks) return Array.from({ length: count }, (_, index) => index);
  const step = Math.ceil((count - 1) / (maxTicks - 1));
  const ticks: number[] = [];
  for (let index = 0; index < count; index += step) ticks.push(index);
  const last = count - 1;
  if (ticks[ticks.length - 1] !== last) {
    if (last - ticks[ticks.length - 1] < step / 2) ticks[ticks.length - 1] = last;
    else ticks.push(last);
  }
  return ticks;
}

function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return "< 1 h";
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function Delta({
  current,
  previous,
  format,
  higherIsBetter = true,
}: {
  current: number | null;
  previous: number | null;
  format: (diff: number) => string;
  higherIsBetter?: boolean;
}) {
  if (current === null || previous === null) {
    return <span className="text-xs text-slate">No earlier data</span>;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return <span className="text-xs text-slate">Same as before</span>;
  }
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span
      className={cn(
        "text-xs font-medium",
        good ? "text-green-600" : "text-red-600",
      )}
    >
      {diff > 0 ? "▲" : "▼"} {format(Math.abs(diff))} vs previous
    </span>
  );
}

function SummaryTiles({
  current,
  previous,
}: {
  current: TrendSummary;
  previous: TrendSummary | null;
}) {
  const tiles = [
    {
      label: "Reviews",
      value: current.reviewCount.toLocaleString(),
      delta: (
        <Delta
          current={current.reviewCount}
          previous={previous?.reviewCount || null}
          format={(d) => d.toLocaleString()}
        />
      ),
    },
    {
      label: "Average rating",
      value: current.avgRating === null ? "—" : current.avgRating.toFixed(2),
      tone:
        current.avgRating === null
          ? ""
          : current.avgRating >= 4
            ? "text-green-600"
            : current.avgRating >= 3
              ? "text-yellow-600"
              : "text-red-600",
      delta: (
        <Delta
          current={current.avgRating}
          previous={previous?.avgRating ?? null}
          format={(d) => d.toFixed(2)}
        />
      ),
    },
    {
      label: "Reply rate",
      value: formatPercent(current.replyRate),
      delta: (
        <Delta
          current={current.replyRate}
          previous={previous?.replyRate ?? null}
          format={(d) => `${Math.round(d * 100)} pts`}
        />
      ),
    },
    {
      label: "Avg. reply time",
      value: formatHours(current.avgResponseHours),
      delta: (
        <Delta
          current={current.avgResponseHours}
          previous={previous?.avgResponseHours ?? null}
          format={(d) => formatHours(d)}
          higherIsBetter={false}
        />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-silver overflow-hidden rounded-xl bg-white shadow-card lg:grid-cols-4 lg:divide-y-0">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-1 p-4 sm:p-5">
          <p className="text-xs font-medium text-slate">{t.label}</p>
          <p
            className={cn("text-[26px] leading-tight text-graphite", t.tone)}
            style={JAKARTA}
          >
            {t.value}
          </p>
          {t.delta}
        </div>
      ))}
    </div>
  );
}

function VolumeChart({ months }: { months: TrendMonth[] }) {
  const max = Math.max(1, ...months.map((m) => m.reviewCount));
  const dense = months.length > 18;
  const ticks = tickIndexes(months.length, dense ? 6 : 8);
  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-graphite" style={JAKARTA}>
          Reviews per month
        </h2>
        <div className="flex gap-3 text-xs text-graphite">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> 4–5★
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" /> 3★
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> 1–2★
          </span>
        </div>
      </div>
      <div
        className={cn(
          "mt-5 flex h-44 items-end",
          dense ? "gap-px" : "gap-1.5 sm:gap-3",
        )}
        role="img"
        aria-label="Monthly review volume by rating"
      >
        {months.map((m) => {
          const height = (m.reviewCount / max) * 100;
          return (
            <div
              key={m.month}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              title={`${monthLabel(m.month, true)}: ${m.reviewCount.toLocaleString("en-US")} reviews`}
            >
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-sm bg-paper"
                style={{ height: `${Math.max(height, m.reviewCount > 0 ? 2 : 0)}%` }}
              >
                {m.reviewCount > 0 ? (
                  <>
                    <div
                      className="bg-green-500"
                      style={{
                        height: `${(m.positive / m.reviewCount) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-yellow-400"
                      style={{
                        height: `${(m.neutral / m.reviewCount) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-red-500"
                      style={{
                        height: `${(m.negative / m.reviewCount) * 100}%`,
                      }}
                    />
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-slate">
        {ticks.map((index, tickIndex) => (
          <span
            key={months[index].month}
            className={cn(
              "absolute top-0 whitespace-nowrap",
              tickIndex === 0 && "left-0",
              tickIndex === ticks.length - 1 && "right-0",
              tickIndex > 0 && tickIndex < ticks.length - 1 && "-translate-x-1/2",
            )}
            style={
              tickIndex > 0 && tickIndex < ticks.length - 1
                ? { left: `${(index / Math.max(months.length - 1, 1)) * 100}%` }
                : undefined
            }
          >
            {axisLabel(months[index].month, dense)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RatingChart({ months }: { months: TrendMonth[] }) {
  const width = 600;
  const height = 180;
  const padX = 28;
  const padY = 16;
  const step = months.length > 1 ? (width - padX * 2) / (months.length - 1) : 0;
  const y = (rating: number) => padY + ((5 - rating) / 4) * (height - padY * 2);
  const points = months
    .map((m, i) =>
      m.avgRating === null
        ? null
        : { x: padX + i * step, y: y(m.avgRating), m },
    )
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const dense = months.length > 18;
  const ticks = new Set(tickIndexes(months.length, dense ? 6 : 8));
  const dotRadius = step > 0 && step < 14 ? 2 : 4.5;

  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-white p-5 shadow-card">
      <h2 className="text-lg text-graphite" style={JAKARTA}>
        Average rating
      </h2>
      {points.length === 0 ? (
        <p className="mt-6 text-sm text-slate">
          No reviews in this period yet.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height + 28}`}
          className="mt-4 h-auto w-full"
          role="img"
          aria-label="Average rating per month"
        >
          {[1, 2, 3, 4, 5].map((r) => (
            <g key={r}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y(r)}
                y2={y(r)}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text x={4} y={y(r) + 4} fontSize={11} fill="#6b7280">
                {r}★
              </text>
            </g>
          ))}
          <polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#101010"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p) => (
            <circle
              key={p.m.month}
              cx={p.x}
              cy={p.y}
              r={dotRadius}
              fill="#fff"
              stroke={
                p.m.avgRating! >= 4
                  ? "#22c55e"
                  : p.m.avgRating! >= 3
                    ? "#eab308"
                    : "#ef4444"
              }
              strokeWidth={dotRadius < 3 ? 1.5 : 2.5}
            >
              <title>{`${monthLabel(p.m.month, true)}: ${p.m.avgRating!.toFixed(2)}★`}</title>
            </circle>
          ))}
          {months.map((m, i) =>
            ticks.has(i) ? (
              <text
                key={m.month}
                x={padX + i * step}
                y={height + 18}
                fontSize={11}
                fill="#6b7280"
                textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}
              >
                {axisLabel(m.month, dense)}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}

function MonthTable({ months }: { months: TrendMonth[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-silver bg-paper text-left text-xs font-medium text-slate">
              <th className="px-4 py-3 sm:px-5">Month</th>
              <th className="px-4 py-3 text-right">Reviews</th>
              <th className="px-4 py-3 text-right">Avg</th>
              <th className="px-4 py-3 text-right">1–2★</th>
              <th className="px-4 py-3 text-right">Replied</th>
              <th className="px-4 py-3 text-right sm:pr-5">Reply time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-silver">
            {[...months].reverse().map((m) => (
              <tr key={m.month} className="tabular-nums">
                <td className="px-4 py-3 text-graphite sm:px-5">
                  {monthLabel(m.month, true)}
                </td>
                <td className="px-4 py-3 text-right text-graphite">
                  {m.reviewCount}
                </td>
                <td className="px-4 py-3 text-right text-graphite">
                  {m.avgRating === null ? "—" : m.avgRating.toFixed(2)}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right",
                    m.negative > 0 ? "text-red-600" : "text-slate",
                  )}
                >
                  {m.negative}
                </td>
                <td className="px-4 py-3 text-right text-graphite">
                  {m.reviewCount > 0
                    ? formatPercent(m.replied / m.reviewCount)
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right text-graphite sm:pr-5">
                  {formatHours(m.avgResponseHours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  const [params, { workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const range = parseDateRange(params, DEFAULT_RANGE);
  const clientParam =
    typeof params.client === "string" && /^[0-9a-f-]{36}$/i.test(params.client)
      ? params.client
      : "";

  const locationParam =
    typeof params.location === "string" &&
    /^[0-9a-f-]{36}$/i.test(params.location)
      ? params.location
      : "";

  const data = await getAnalyticsData(
    workspaceId,
    range,
    clientParam || null,
    locationParam || null,
  );

  const exportParams = new URLSearchParams(dateRangeParams(range, "all"));
  if (clientParam) exportParams.set("client", clientParam);
  if (locationParam) exportParams.set("location", locationParam);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="How ratings, volume, and response times are moving across your clients."
      >
        <a
          href={`/api/reviews/export?${exportParams.toString()}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export CSV
        </a>
      </PageHeader>

      <TransitionScope>
        <AnalyticsFilters
          range={{ key: range.key, from: range.from, to: range.to }}
          defaultRange={DEFAULT_RANGE}
          clientId={clientParam}
          clients={data.clients}
          locationId={locationParam}
          locations={data.locations}
        />

        <PendingRegion label="Recalculating analytics…" className="flex flex-col gap-10">
          <SummaryTiles current={data.current} previous={data.previous} />

          <div
            className={cn(
              "grid gap-5",
              data.months.length > 18 ? "grid-cols-1" : "lg:grid-cols-2",
            )}
          >
            <VolumeChart months={data.months} />
            <RatingChart months={data.months} />
          </div>

          <MonthTable months={data.months} />

          <p className="text-xs leading-relaxed text-slate">
            {data.previous
              ? `${range.label}, compared with the same length of time just before it.`
              : `${range.label}.`}{" "}
            Reply time is measured from the review to the latest reply on
            Google.
          </p>
        </PendingRegion>
      </TransitionScope>
    </div>
  );
}
