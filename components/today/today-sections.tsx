import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleAlert, Minus } from "lucide-react";
import { PeriodToggle, type PeriodOption } from "@/components/today/period-toggle";
import { StarBreakdown, type StarRow } from "@/components/today/star-breakdown";
import { VolumeChart, type VolumeDay } from "@/components/today/volume-chart";
import type { NeedsYouTask, TodayKpi, TodayLocationTable, TodayTheme } from "@/lib/today";
import { cn } from "@/lib/utils";

const CARD = "min-w-0 rounded-[14px] border border-line bg-white";

export function TodayHeader({
  dateLine,
  title,
  periods,
}: {
  dateLine: string;
  title: string;
  periods: PeriodOption[];
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] text-ink-3">{dateLine}</span>
        <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
      </div>
      <PeriodToggle options={periods} />
    </header>
  );
}

const TASK_TONES: Record<NeedsYouTask["tone"], string> = {
  bad: "bg-bad-tint text-bad",
  info: "bg-info-tint text-info",
  ai: "bg-ai-tint text-ai",
  warn: "bg-warn-tint text-warn",
};

export function NeedsYouStrip({ tasks, startHref }: { tasks: NeedsYouTask[]; startHref: string }) {
  return (
    <section aria-label="Needs you" className={cn(CARD, "flex flex-wrap items-stretch gap-1 p-2")}>
      {tasks.map((task) => (
        <Link
          key={task.id}
          href={task.href}
          className="flex min-w-0 flex-[1_1_170px] items-center gap-3 rounded-[10px] px-3.5 py-3 text-ink outline-none hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span
            className={cn(
              "flex h-9 min-w-9 flex-none items-center justify-center rounded-[9px] px-2 text-base font-bold tabular-nums",
              task.count > 0 ? TASK_TONES[task.tone] : "bg-paper text-ink-3"
            )}
          >
            {task.count.toLocaleString("en-US")}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="text-sm font-semibold">{task.label}</span>
            <span className="text-xs text-ink-3">{task.hint}</span>
          </span>
        </Link>
      ))}
      <Link
        href={startHref}
        className="mx-1.5 my-1 inline-flex h-11 flex-none items-center gap-2 self-center rounded-full bg-ink px-5 text-sm font-semibold text-white outline-none hover:bg-graphite hover:text-white focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        Start replying
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

const DELTA_TONES: Record<TodayKpi["tone"], string> = {
  good: "text-ok",
  bad: "text-bad",
  flat: "text-ink-3",
};

function DeltaIcon({ direction }: { direction: TodayKpi["direction"] }) {
  const props = { className: "size-3", strokeWidth: 2.25, "aria-hidden": true } as const;
  if (direction === "up") return <ArrowUpRight {...props} />;
  if (direction === "down") return <ArrowDownRight {...props} />;
  return <Minus {...props} />;
}

export function KpiTiles({ kpis }: { kpis: TodayKpi[] }) {
  return (
    <section aria-label="Key numbers" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      {kpis.map((kpi) => (
        <div key={kpi.id} className={cn(CARD, "flex flex-col gap-2.5 px-5 py-[18px]")}>
          <span className="text-[13px] text-ink-3">{kpi.label}</span>
          <div className="flex items-end justify-between gap-3">
            <span className="flex flex-col gap-1">
              <span className="sr-only">{kpi.summary}</span>
              <span aria-hidden="true" className="text-[30px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
                {kpi.value}
              </span>
              <span aria-hidden="true" className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", DELTA_TONES[kpi.tone])}>
                <DeltaIcon direction={kpi.direction} />
                {kpi.delta}
              </span>
            </span>
            {kpi.spark ? (
              <svg viewBox="0 0 112 40" width="112" height="40" aria-hidden="true" className="flex-none overflow-visible">
                <polyline
                  points={kpi.spark.points}
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={kpi.spark.endX} cy={kpi.spark.endY} r="3" fill="var(--color-brand)" stroke="#ffffff" strokeWidth="2" />
              </svg>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

export function VolumeCard({
  days,
  yMax,
  caption,
  summary,
}: {
  days: VolumeDay[];
  yMax: number;
  caption: string;
  summary: string;
}) {
  return (
    <section className={cn(CARD, "flex flex-[999_1_520px] flex-col gap-4 p-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold text-ink">New reviews per day</h2>
          <span className="text-[13px] text-ink-3">{caption}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          <span className="size-2.5 rounded-[3px] bg-bad" aria-hidden="true" />
          Day with a 1–2 star review
        </span>
      </div>
      <VolumeChart days={days} yMax={yMax} summary={summary} />
    </section>
  );
}

export function StarCard({ rows, average }: { rows: StarRow[]; average: number | null }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section className={cn(CARD, "flex flex-[1_1_300px] flex-col gap-4 p-5")}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Star breakdown</h2>
        <span className="text-[13px] text-ink-3">
          {total.toLocaleString("en-US")} {total === 1 ? "review" : "reviews"}
        </span>
      </div>
      <StarBreakdown rows={rows} />
      <div className="mt-auto flex items-baseline gap-2 border-t border-line-2 pt-3.5">
        <span className="text-[28px] font-bold tracking-[-0.02em] text-ink tabular-nums">
          {average === null ? "—" : average.toFixed(1)}
        </span>
        <span className="tracking-[1px] text-star" aria-hidden="true">
          ★★★★★
        </span>
        <span className="text-[13px] text-ink-3">average</span>
      </div>
    </section>
  );
}

function formatChange(change: number | null): { text: string; tone: string } {
  if (change === null) return { text: "—", tone: "text-ink-3" };
  const text = Math.abs(change).toFixed(1);
  if (Number(text) === 0) return { text: "0.0", tone: "text-ink-3" };
  return change > 0 ? { text: `+${text}`, tone: "text-ok" } : { text: `−${text}`, tone: "text-bad" };
}

export function LocationsCard({
  table,
  allHref,
  unrepliedHref,
  placeHref,
}: {
  table: TodayLocationTable;
  allHref: string;
  unrepliedHref: (locationId: string) => string;
  placeHref: (locationId: string) => string;
}) {
  const grouped = table.groups.length > 0 && table.groups[0]!.name !== null;
  return (
    <section className={cn(CARD, "flex-[999_1_520px] overflow-hidden")}>
      <div className="flex items-baseline justify-between gap-2 px-5 pb-3 pt-[18px]">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Locations</h2>
        <Link href={allHref} className="text-[13px] font-medium text-brand hover:text-brand-hover">
          All locations
        </Link>
      </div>
      {table.shown === 0 ? (
        <p className="px-5 pb-5 text-[13px] text-ink-3">No reviews at these locations in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="px-5 py-2 font-medium">Location</th>
                <th scope="col" className="w-[34%] whitespace-nowrap px-3 py-2 font-medium">
                  Rating <span className="font-normal">(bar from {table.barFrom}★)</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Change</th>
                <th scope="col" className="whitespace-nowrap px-5 py-2 text-right font-medium">No reply</th>
              </tr>
            </thead>
            {table.groups.map((group) => (
              <tbody key={group.clientId ?? "all"}>
                {grouped ? (
                  <tr className="border-t border-line-2 bg-paper/60">
                    <th scope="colgroup" colSpan={4} className="px-5 py-2 text-left text-xs font-semibold text-ink-2">
                      {group.name}
                    </th>
                  </tr>
                ) : null}
                {group.rows.map((row) => {
                  const change = formatChange(row.change);
                  return (
                    <tr key={row.id} className="border-t border-line-2">
                      <td className="px-5 py-3 font-medium">
                        <Link href={placeHref(row.id)} className="text-ink hover:text-brand">
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2.5">
                          <span className="w-7 flex-none tabular-nums">{row.rating === null ? "—" : row.rating.toFixed(1)}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-line-2" aria-hidden="true">
                            <span className="block h-2 rounded-full bg-brand" style={{ width: `${row.width * 100}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className={cn("px-3 py-3 tabular-nums", change.tone)}>{change.text}</td>
                      <td className="px-5 py-3 text-right">
                        {row.unreplied > 0 ? (
                          <Link href={unrepliedHref(row.id)} className="font-semibold text-ink tabular-nums hover:text-brand">
                            {row.unreplied.toLocaleString("en-US")}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink-3 tabular-nums">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {table.total > table.shown ? (
        <p className="border-t border-line-2 px-5 py-3 text-xs text-ink-3">
          Showing {table.shown.toLocaleString("en-US")} of {table.total.toLocaleString("en-US")} locations, most open reviews first.
        </p>
      ) : null}
    </section>
  );
}

export function ThemesCard({
  themes,
  note,
  insightsHref,
  emptyText,
}: {
  themes: TodayTheme[];
  note: string | null;
  insightsHref: string;
  emptyText: string;
}) {
  return (
    <section className={cn(CARD, "flex flex-[1_1_300px] flex-col gap-3.5 p-5")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold text-ink">What customers say</h2>
        <Link href={insightsHref} className="text-[13px] font-medium text-brand hover:text-brand-hover">
          Insights
        </Link>
      </div>
      {themes.length === 0 ? (
        <p className="text-[13px] text-ink-3">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {themes.map((theme) => (
            <li key={`${theme.kind}:${theme.label}`} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "inline-flex flex-none items-center gap-1 rounded-full px-[7px] py-0.5 text-[11px] font-semibold",
                  theme.kind === "praise" ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad"
                )}
              >
                {theme.kind === "praise" ? (
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                ) : (
                  <CircleAlert className="size-2.5" strokeWidth={3} aria-hidden="true" />
                )}
                {theme.kind === "praise" ? "Praise" : "Issue"}
              </span>
              <span className="min-w-0 flex-1 text-ink">{theme.label}</span>
              <span className="text-[13px] text-ink-3 tabular-nums">
                {theme.count.toLocaleString("en-US")}
                <span className="sr-only"> mentions</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {note ? (
        <p className="mt-1 border-t border-line-2 pt-3.5 text-[13px] leading-[1.55] text-ink-2">{note}</p>
      ) : null}
    </section>
  );
}
