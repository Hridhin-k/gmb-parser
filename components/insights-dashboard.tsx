import Link from "next/link";
import type { ObservationAggregates } from "@/lib/review-intelligence";
import type { InsightRecord } from "@/lib/insight-report";
import { insightTrendMonths } from "@/lib/insight-dashboard";
import { monthlySeriesMetrics } from "@/lib/chart-metrics";
import { MetricStrip } from "@/components/charts";

/**
 * Dashboard visualisation for the insights page. Pure server-rendered
 * SVG/divs — every number comes from the aggregates and saved report
 * the page already loaded. No client fetching, no invented metrics:
 * sentiment share is praise-vs-complaint mentions, outlet sentiment is
 * positive observations ÷ (positive + negative) for that outlet.
 */

function topicLabel(topic: string): string {
  return topic.replace(/_/g, " ");
}

export function SentimentDonut({
  positive,
  negative,
  centerLabel = "positive",
}: {
  positive: number;
  negative: number;
  /** Word under the percent. Overview uses "praise" so it is not read as the 4–5★ share. */
  centerLabel?: string;
}) {
  const total = positive + negative;
  const pct = total > 0 ? Math.round((positive / total) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (pct / 100) * c;
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={`${pct}% of praise and complaint mentions are ${centerLabel}`}>
      <svg viewBox="0 0 128 128" className="h-36 w-36 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#e2e8f0" strokeWidth="13" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold text-graphite">{pct}%</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate">{centerLabel}</span>
      </div>
    </div>
  );
}

export function SentimentTrend({ byMonth }: { byMonth: ObservationAggregates["byMonth"] }) {
  const months = insightTrendMonths(byMonth);
  if (months.length < 2) {
    return <p className="mt-3 text-sm text-slate">Not enough monthly history in this range yet.</p>;
  }
  const max = Math.max(1, ...months.map((m) => Math.max(m.positive, m.negative)));
  const w = 640;
  const h = 190;
  const pad = 14;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (months.length - 1);
  const y = (v: number) => h - 22 - (v / max) * (h - 44);
  const line = (key: "positive" | "negative") =>
    months.map((m, i) => `${x(i)},${y(m[key])}`).join(" ");
  const monthName = (m: string) =>
    new Date(`${m}-02T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const monthLabel = (m: string) =>
    new Date(`${m}-02T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  // Metrics match every month drawn for the selected range.
  const metrics = monthlySeriesMetrics(
    months.map((m) => ({ label: monthLabel(m.month), positive: m.positive, negative: m.negative }))
  );
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" role="img" aria-label="Monthly positive and negative observations">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} stroke="#eef2f7" strokeWidth="1" />
            <text x={w - pad} y={y(max * f) - 3} textAnchor="end" fontSize="9" fill="#94a3b8">
              {Math.round(max * f).toLocaleString()}
            </text>
          </g>
        ))}
        <polyline points={line("positive")} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" />
        <polyline points={line("negative")} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinejoin="round" />
        {months.map((m, i) => (
          <g key={m.month}>
            <circle cx={x(i)} cy={y(m.positive)} r="3" fill="#10b981" />
            <circle cx={x(i)} cy={y(m.negative)} r="3" fill="#f43f5e" />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-slate">
        <span>{monthName(months[0].month)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Positive</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Negative</span>
        </span>
        <span>{monthName(months[months.length - 1].month)}</span>
      </div>
      <MetricStrip
        items={[
          {
            label: "Mentions in chart",
            value: metrics.total.toLocaleString(),
            sub: `${metrics.positive.toLocaleString()} positive · ${metrics.negative.toLocaleString()} negative`,
          },
          ...(metrics.positiveShare !== null
            ? [
                {
                  label: "Positive share",
                  value: `${Math.round(metrics.positiveShare * 100)}%`,
                  sub:
                    metrics.positiveShareChangePoints === null
                      ? "of praise + complaint mentions"
                      : `${metrics.positiveShareChangePoints >= 0 ? "+" : "−"}${Math.abs(metrics.positiveShareChangePoints).toFixed(1)} pts vs first month`,
                },
              ]
            : []),
          ...(metrics.latest
            ? [
                {
                  label: `Latest · ${metrics.latest.label}`,
                  value: metrics.latest.total.toLocaleString(),
                  sub: `${metrics.latest.positive.toLocaleString()} pos · ${metrics.latest.negative.toLocaleString()} neg`,
                },
              ]
            : []),
          ...(metrics.peakNegative
            ? [
                {
                  label: "Most complaints",
                  value: metrics.peakNegative.label,
                  sub: `${metrics.peakNegative.negative.toLocaleString()} negative mentions`,
                },
              ]
            : []),
          ...(metrics.peak
            ? [
                {
                  label: "Busiest month",
                  value: metrics.peak.label,
                  sub: `${metrics.peak.total.toLocaleString()} mentions`,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

interface RankedTheme {
  topic: string;
  count: number;
  reviews: number;
}

function rankedThemes(entries: RankedTheme[], limit: number): RankedTheme[] {
  const byTopic = new Map<string, RankedTheme>();
  for (const entry of entries) {
    if (entry.count <= 0 || entry.topic.length === 0) continue;
    const row = byTopic.get(entry.topic) ?? { topic: entry.topic, count: 0, reviews: 0 };
    row.count += entry.count;
    row.reviews += entry.reviews;
    byTopic.set(entry.topic, row);
  }
  return [...byTopic.values()]
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}

function ThemeRankList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: RankedTheme[];
  tone: "praise" | "complaint";
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.count));
  const bar = tone === "praise" ? "bg-emerald-500" : "bg-rose-400";
  const kind = tone === "praise" ? "praise" : "complaint";
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate">{title}</p>
      <ul className="mt-2 space-y-2.5">
        {rows.map((row) => (
          <li key={row.topic}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="capitalize text-graphite">{topicLabel(row.topic)}</span>
              <span className="text-right text-xs text-slate">
                {row.count.toLocaleString()} {kind} {row.count === 1 ? "mention" : "mentions"}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
              <div className={`h-full ${bar}`} style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopThemes({ aggregates, limit = 5 }: { aggregates: ObservationAggregates; limit?: number }) {
  const praise = rankedThemes(aggregates.positive, limit);
  const complaints = rankedThemes(aggregates.negative, limit);
  if (praise.length === 0 && complaints.length === 0) return <p className="mt-3 text-sm text-slate">No themes yet.</p>;
  return (
    <div className="mt-3 space-y-4">
      <ThemeRankList title="Most praised" rows={praise} tone="praise" />
      <ThemeRankList title="Complaint themes" rows={complaints} tone="complaint" />
      <p className="text-xs text-slate">
        Ranked separately. Complaint counts match Analytics. A mention is one topic in analysed text, not a star rating.
      </p>
    </div>
  );
}

export function LocationPerformance({
  aggregates,
  outletNames,
  limit = 8,
}: {
  aggregates: ObservationAggregates;
  outletNames: Map<string, string>;
  limit?: number;
}) {
  const rows = aggregates.byOutlet
    .map((o) => ({
      ...o,
      reviews: aggregates.outletReviews[o.locationId] ?? 0,
      sentimentTotal: o.positive + o.negative,
    }))
    .sort((a, b) => b.reviews - a.reviews)
    .slice(0, limit);
  if (rows.length === 0) return <p className="mt-3 text-sm text-slate">No outlet data in this scope yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[430px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate">
            <th className="pb-2 font-medium">Location</th>
            <th className="pb-2 font-medium">Analysed</th>
            <th className="pb-2 font-medium">Positive</th>
            <th className="pb-2 font-medium">Negative</th>
            <th className="pb-2 font-medium">Severe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pct = row.sentimentTotal > 0 ? Math.round((row.positive / row.sentimentTotal) * 100) : 0;
            return (
              <tr key={row.locationId} className="border-t border-paper">
                <td className="max-w-[170px] truncate py-2 pr-2 font-medium text-graphite">
                  {outletNames.get(row.locationId) ?? "Outlet"}
                </td>
                <td className="py-2 pr-2 text-slate">{row.reviews.toLocaleString()}</td>
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-2">
                    <span className="w-9 text-emerald-600">{pct}%</span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-paper">
                      <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-xs tabular-nums text-slate">{row.positive.toLocaleString()} mentions</span>
                  </span>
                </td>
                <td className="py-2 pr-2 text-rose-600">{row.negative.toLocaleString()}</td>
                <td className="py-2">
                  {row.severe > 0 ? (
                    <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      {row.severe}
                    </span>
                  ) : (
                    <span className="text-slate">0</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const KEY_INSIGHT_STYLES: Array<{
  key: string;
  label: string;
  href: string;
  classes: string;
  pick: (insights: InsightRecord[]) => InsightRecord | undefined;
}> = [
  {
    key: "concern",
    label: "Rising concern",
    href: "#negative",
    classes: "bg-rose-50 text-rose-600",
    pick: (list) =>
      list.find((i) => i.sentiment === "negative" && i.category !== "serious_incident") ??
      list.find((i) => i.category === "serious_incident"),
  },
  {
    key: "driver",
    label: "Positive driver",
    href: "#positive",
    classes: "bg-emerald-50 text-emerald-600",
    pick: (list) => list.find((i) => i.sentiment === "positive"),
  },
  {
    key: "emerging",
    label: "Emerging signal",
    href: "#trends",
    classes: "bg-violet-50 text-violet-600",
    pick: (list) => list.find((i) => i.category === "trend") ?? list.find((i) => i.category === "relationship"),
  },
  {
    key: "action",
    label: "Recommendation",
    href: "#actions",
    classes: "bg-sky-50 text-sky-600",
    pick: (list) =>
      list.find((i) => i.suggestedAction && i.sentiment === "negative") ??
      list.find((i) => i.suggestedAction),
  },
];

export function KeyInsights({ insights }: { insights: InsightRecord[] }) {
  const cards = KEY_INSIGHT_STYLES.map((style) => ({ style, insight: style.pick(insights) })).filter(
    (c) => c.insight
  );
  if (cards.length === 0) return <p className="mt-3 text-sm text-slate">Generate a report to surface key insights.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {cards.map(({ style, insight }) => (
        <li key={style.key}>
          <a href={style.href} className="flex gap-3 rounded-lg border border-paper p-2.5 transition hover:border-silver hover:bg-paper/60">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${style.classes}`}>
              {style.label.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate">{style.label}</span>
              <span className="mt-0.5 line-clamp-2 block text-sm font-medium text-graphite">{insight!.title}</span>
              <span className="mt-0.5 block text-xs text-slate">
                {insight!.supportingReviews.toLocaleString()} supporting review
                {insight!.supportingReviews === 1 ? "" : "s"}
                {insight!.severity ? ` · severity ${insight!.severity}/5` : ""}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function StaffPraised({ aggregates, limit = 5 }: { aggregates: ObservationAggregates; limit?: number }) {
  const rows = aggregates.staffPraise.slice(0, limit);
  if (rows.length === 0) return <p className="mt-3 text-sm text-slate">No staff named in praise yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  // Share is of every staff-praise mention, including names below the cut.
  const totalPraise = aggregates.staffPraise.reduce((s, r) => s + r.count, 0);
  return (
    <ul className="mt-3 space-y-2.5">
      {rows.map((row) => (
        <li key={row.name}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-graphite">{row.name}</span>
            <span className="text-xs text-slate">
              {row.count} mentions{totalPraise > 0 ? ` · ${Math.round((row.count / totalPraise) * 100)}% of staff praise` : ""}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
            <div className="h-full bg-emerald-500" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SectionCard({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-silver bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-graphite">{title}</h2>
        {hint ? <span className="text-xs text-slate">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
