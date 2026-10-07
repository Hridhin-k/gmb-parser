import { Download } from "lucide-react";
import { getActiveWorkspace } from "@/lib/services/session";
import {
  getAnalyticsData,
  TREND_PERIODS,
  type TrendMonth,
  type TrendPeriod,
  type TrendSummary,
} from "@/lib/services/analytics";
import { PageHeader } from "@/components/page-header";
import { AnalyticsFilters } from "@/components/analytics-filters";
import { cn } from "@/lib/utils";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const JAKARTA = { fontFamily: "var(--font-google-sans-display), sans-serif" };

function monthLabel(iso: string, withYear = false) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
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
    return <span className="text-xs text-[#5f6368]">No earlier data</span>;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return <span className="text-xs text-[#5f6368]">Same as before</span>;
  }
  const good = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={cn("text-xs font-medium", good ? "text-green-600" : "text-red-600")}>
      {diff > 0 ? "▲" : "▼"} {format(Math.abs(diff))} vs previous
    </span>
  );
}

function SummaryTiles({ current, previous }: { current: TrendSummary; previous: TrendSummary }) {
  const tiles = [
    {
      label: "Reviews",
      value: current.reviewCount.toLocaleString(),
      delta: (
        <Delta
          current={current.reviewCount}
          previous={previous.reviewCount || null}
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
        <Delta current={current.avgRating} previous={previous.avgRating} format={(d) => d.toFixed(2)} />
      ),
    },
    {
      label: "Reply rate",
      value: formatPercent(current.replyRate),
      delta: (
        <Delta
          current={current.replyRate}
          previous={previous.replyRate}
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
          previous={previous.avgResponseHours}
          format={(d) => formatHours(d)}
          higherIsBetter={false}
        />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-[#f8f9fa] overflow-hidden rounded-3xl border border-[#dadce0] bg-white lg:grid-cols-4 lg:divide-y-0">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-1 p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5f6368]">{t.label}</p>
          <p
            className={cn("text-[26px] leading-tight tracking-[-0.02em] text-[#202124]", t.tone)}
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
  return (
    <div className="rounded-3xl border border-[#dadce0] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-[#202124]" style={JAKARTA}>
          Reviews per month
        </h2>
        <div className="flex gap-3 text-xs text-[#3c4043]">
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
      <div className="mt-5 flex h-48 items-end gap-1.5 sm:gap-3" role="img" aria-label="Monthly review volume by rating">
        {months.map((m) => {
          const height = (m.reviewCount / max) * 100;
          return (
            <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[11px] tabular-nums text-[#5f6368]">
                {m.reviewCount > 0 ? m.reviewCount : ""}
              </span>
              <div
                className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-md bg-[#f8f9fa]"
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${monthLabel(m.month, true)}: ${m.positive} positive, ${m.neutral} neutral, ${m.negative} negative`}
              >
                {m.reviewCount > 0 ? (
                  <>
                    <div className="bg-green-500" style={{ height: `${(m.positive / m.reviewCount) * 100}%` }} />
                    <div className="bg-yellow-400" style={{ height: `${(m.neutral / m.reviewCount) * 100}%` }} />
                    <div className="bg-red-500" style={{ height: `${(m.negative / m.reviewCount) * 100}%` }} />
                  </>
                ) : null}
              </div>
              <span className="text-[11px] text-[#5f6368]">{monthLabel(m.month)}</span>
            </div>
          );
        })}
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
    .map((m, i) => (m.avgRating === null ? null : { x: padX + i * step, y: y(m.avgRating), m }))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return (
    <div className="rounded-3xl border border-[#dadce0] bg-white p-5">
      <h2 className="text-lg text-[#202124]" style={JAKARTA}>
        Average rating
      </h2>
      {points.length === 0 ? (
        <p className="mt-6 text-sm text-[#5f6368]">No reviews in this period yet.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height + 20}`}
          className="mt-4 h-auto w-full"
          role="img"
          aria-label="Average rating per month"
        >
          {[1, 2, 3, 4, 5].map((r) => (
            <g key={r}>
              <line x1={padX} x2={width - padX} y1={y(r)} y2={y(r)} stroke="#f8f9fa" strokeWidth={1} />
              <text x={4} y={y(r) + 4} fontSize={11} fill="#5f6368">
                {r}★
              </text>
            </g>
          ))}
          <polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#1a73e8"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p) => (
            <g key={p.m.month}>
              <circle
                cx={p.x}
                cy={p.y}
                r={4.5}
                fill="#fff"
                stroke={p.m.avgRating! >= 4 ? "#22c55e" : p.m.avgRating! >= 3 ? "#eab308" : "#ef4444"}
                strokeWidth={2.5}
              >
                <title>{`${monthLabel(p.m.month, true)}: ${p.m.avgRating!.toFixed(2)}★`}</title>
              </circle>
            </g>
          ))}
          {months.map((m, i) => (
            <text
              key={m.month}
              x={padX + i * step}
              y={height + 14}
              fontSize={11}
              fill="#5f6368"
              textAnchor="middle"
            >
              {monthLabel(m.month)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function MonthTable({ months }: { months: TrendMonth[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[#dadce0] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#f8f9fa] bg-[#f8f9fa] text-left text-xs font-medium text-[#5f6368]">
              <th className="px-4 py-3 sm:px-5">Month</th>
              <th className="px-4 py-3 text-right">Reviews</th>
              <th className="px-4 py-3 text-right">Avg</th>
              <th className="px-4 py-3 text-right">1–2★</th>
              <th className="px-4 py-3 text-right">Replied</th>
              <th className="px-4 py-3 text-right sm:pr-5">Reply time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f8f9fa]">
            {[...months].reverse().map((m) => (
              <tr key={m.month} className="tabular-nums">
                <td className="px-4 py-3 text-[#202124] sm:px-5">{monthLabel(m.month, true)}</td>
                <td className="px-4 py-3 text-right text-[#202124]">{m.reviewCount}</td>
                <td className="px-4 py-3 text-right text-[#202124]">
                  {m.avgRating === null ? "—" : m.avgRating.toFixed(2)}
                </td>
                <td className={cn("px-4 py-3 text-right", m.negative > 0 ? "text-red-600" : "text-[#5f6368]")}>
                  {m.negative}
                </td>
                <td className="px-4 py-3 text-right text-[#202124]">
                  {m.reviewCount > 0 ? formatPercent(m.replied / m.reviewCount) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-[#202124] sm:pr-5">
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

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const [params, { workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);

  const monthsParam = Number(params.months);
  const period: TrendPeriod = (TREND_PERIODS as readonly number[]).includes(monthsParam)
    ? (monthsParam as TrendPeriod)
    : 6;
  const clientParam =
    typeof params.client === "string" && /^[0-9a-f-]{36}$/i.test(params.client)
      ? params.client
      : "";

  const data = await getAnalyticsData(workspaceId, period, clientParam || null);

  const exportParams = new URLSearchParams({ months: String(period) });
  if (clientParam) exportParams.set("client", clientParam);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="How ratings, volume, and response times are moving across your clients."
      >
        <a
          href={`/api/reviews/export?${exportParams.toString()}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#dadce0] bg-white px-4 text-sm font-medium text-[#202124] hover:border-[#1a73e8]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Export CSV
        </a>
      </PageHeader>

      <AnalyticsFilters
        period={period}
        periods={TREND_PERIODS}
        clientId={clientParam}
        clients={data.clients}
      />

      <SummaryTiles current={data.current} previous={data.previous} />

      <div className="grid gap-5 lg:grid-cols-2">
        <VolumeChart months={data.months} />
        <RatingChart months={data.months} />
      </div>

      <MonthTable months={data.months} />

      <p className="text-xs leading-relaxed text-[#5f6368]">
        Compared with the {period} months before. Reply time is measured from the review to the
        latest reply on Google.
      </p>
    </div>
  );
}
