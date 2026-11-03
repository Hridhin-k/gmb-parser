"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Minus, ArrowDownRight, ArrowUpRight, Plus, X } from "lucide-react";
import { MoodChart, type MoodChartEvent } from "@/components/mood-chart";
import type { MonthDriver, MoodPoint, TopicTrend, TrendStatus } from "@/lib/insight-mood";

/** Tones shared by every Insights card: orange for worse, green for better. */
export const MOOD_TONE = {
  worse: { text: "text-[#c2410c]", bg: "bg-[#fdeee6]", line: "#c2410c" },
  better: { text: "text-ok", bg: "bg-ok-tint", line: "#1f4ed8" },
  steady: { text: "text-ink-2", bg: "bg-line-2", line: "#1f4ed8" },
} as const;

export interface MoodEvent {
  key: string;
  index: number;
  kind: "note" | "ai";
  text: string;
  /** Set for notes this person may remove. */
  removableId: string | null;
}

interface InsightsMoodProps {
  points: MoodPoint[];
  trends: TopicTrend[];
  /** "What moved it", one list per chart month. */
  drivers: MonthDriver[][];
  /** One quote per chart month, matching which way the mood went. */
  quotes: Array<string | null>;
  events: MoodEvent[];
  initialIndex: number;
  scopeParams: { client?: string; group?: string; location?: string };
  /** Scope query (no dates) for links to a month's reviews. */
  reviewsQuery: string;
  canNote: boolean;
}

const STATUS_LABEL: Record<TrendStatus, string> = { worse: "Getting worse", better: "Getting better", steady: "Steady" };

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
}

function chipTone(a: number, b: number) {
  return a >= b ? "bg-ok-tint text-ok" : "bg-[#fdeee6] text-[#c2410c]";
}

function StatusIcon({ status, className }: { status: TrendStatus; className?: string }) {
  const Icon = status === "worse" ? ArrowDownRight : status === "better" ? ArrowUpRight : Minus;
  return <Icon aria-hidden className={className ?? "size-3"} strokeWidth={3} />;
}

function Sparkline({ values, color }: { values: Array<number | null>; color: string }) {
  const n = values.length;
  const runs: string[] = [];
  let run: string[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
      return;
    }
    const x = n > 1 ? (i / (n - 1)) * 200 : 100;
    run.push(`${x.toFixed(1)},${(46 - (value / 100) * 44).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  return (
    <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="block h-12 w-full" aria-hidden>
      <line x1="0" x2="200" y1="24" y2="24" stroke="#eef0f3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {runs.map((points) =>
        points.includes(" ") ? (
          <polyline
            key={points}
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <circle key={points} cx={points.split(",")[0]} cy={points.split(",")[1]} r="2" fill={color} />
        )
      )}
    </svg>
  );
}

/**
 * Customer mood and what's driving it: the monthly happy share with an
 * optional last-year line, pins for notes and spotted changes, a month
 * detail panel, and one small chart per topic that can take over the main one.
 */
export function InsightsMood(props: InsightsMoodProps) {
  const { points, trends } = props;
  const router = useRouter();
  const [selected, setSelected] = useState(Math.min(Math.max(0, props.initialIndex), Math.max(0, points.length - 1)));
  const [topicId, setTopicId] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const topic = trends.find((trend) => trend.topic === topicId) ?? null;
  const overall = points.map((point) => point.happy);
  const lastYear = points.map((point) => point.lastYear);
  const hasLastYear = lastYear.some((value) => value !== null);
  const main = topic ? topic.series : overall;
  const second = topic ? overall : compare && hasLastYear ? lastYear : null;
  const year = (offset: number) => {
    const last = points[points.length - 1]?.month;
    return last ? String(Number(last.slice(0, 4)) + offset) : "";
  };
  const mainName = topic ? topic.label.split(" ")[0] : year(0);
  const secondName = topic ? "All" : year(-1);

  const latest = (() => {
    for (let i = main.length - 1; i >= 0; i--) if (main[i] !== null) return i;
    return -1;
  })();
  const head = latest >= 0 ? (main[latest] as number) : null;
  const headPrev = latest > 0 ? main[latest - 1] : null;
  const point = points[selected];
  const value = main[selected] ?? null;
  const prev = selected > 0 ? main[selected - 1] : null;
  const against = topic ? overall[selected] : lastYear[selected];
  const events: MoodChartEvent[] = props.events.map((event, i) => ({ index: event.index, n: i + 1, kind: event.kind, text: event.text }));
  const monthEvent = props.events.findIndex((event) => event.index === selected);

  const rangeText = points.length
    ? `${points[0].fullLabel} to ${points[points.length - 1].fullLabel}`
    : "";
  const known = main.filter((v): v is number => v !== null);
  const ariaLabel = known.length
    ? `${topic ? `${topic.label} mood` : "Customer mood"}, ${rangeText}: from ${known[0]}% to ${known[known.length - 1]}% happy, lowest ${Math.min(...known)}%.`
    : `${topic ? `${topic.label} mood` : "Customer mood"}, ${rangeText}: not enough mentions yet.`;

  const monthReviews = (() => {
    if (!point) return "/reviews";
    const query = new URLSearchParams(props.reviewsQuery);
    query.set("range", "custom");
    query.set("from", point.from);
    query.set("to", point.to);
    return `/reviews?${query.toString()}`;
  })();

  function saveNote() {
    const body = draft.trim();
    if (!body || !point) return;
    setNoteError(null);
    startSaving(async () => {
      const response = await fetch("/api/insights/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...props.scopeParams, month: point.month, body }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNoteError(payload.error ?? "Could not save the note.");
        return;
      }
      setAdding(false);
      setDraft("");
      router.refresh();
    });
  }

  function removeNote(id: string) {
    startSaving(async () => {
      const response = await fetch(`/api/insights/notes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setNoteError(payload.error ?? "Could not remove the note.");
        return;
      }
      router.refresh();
    });
  }

  if (points.length === 0) return null;

  return (
    <>
      <section
        aria-labelledby="mood-title"
        className="flex flex-col gap-5 rounded-2xl border border-line bg-white p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id="mood-title" className="text-[15px] font-semibold text-ink">
              {topic ? `Customer mood about ${topic.label.toLowerCase()}` : "Customer mood"}
            </h2>
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
              <span className="text-[40px] font-bold leading-none tracking-[-0.03em] text-ink tabular-nums">
                {head === null ? "—" : `${head}%`}
                <span className="text-lg font-semibold tracking-normal text-ink-2"> happy</span>
              </span>
              {head !== null && headPrev !== null ? (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${chipTone(head, headPrev)}`}>
                  {signed(head - headPrev)} pts vs {points[latest - 1].label}
                </span>
              ) : null}
              <span className="text-[13px] text-ink-3">
                {topic
                  ? `All topics: ${overall[latest] ?? "—"}${overall[latest] !== null ? "%" : ""}`
                  : head !== null && latest >= 0 && lastYear[latest] !== null
                    ? `${signed(head - (lastYear[latest] as number))} pts vs a year ago`
                    : head === null
                      ? "Not enough mentions yet"
                      : "No reviews read for a year ago"}
              </span>
            </div>
            <span className="text-[13px] text-ink-3">
              Share of everything customers said that was positive. 50% means as many complaints as compliments.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!topic && hasLastYear ? (
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={() => setCompare(!compare)}
                  className="size-[18px] cursor-pointer accent-brand"
                />
                Compare with last year
              </label>
            ) : null}
            {topic ? (
              <button
                type="button"
                onClick={() => setTopicId(null)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-tint px-3.5 text-[13px] font-semibold text-brand hover:bg-brand-line/40"
              >
                {topic.label}
                <X aria-hidden className="size-3" strokeWidth={2.5} />
                <span className="sr-only">Show all topics</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-5">
          <div className="flex min-w-0 flex-[999_1_540px] flex-col gap-3">
            {second ? (
              <div className="flex flex-wrap gap-4 text-xs text-ink-2" aria-hidden>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-5 rounded bg-brand" />
                  {topic ? topic.label : `${mainName} · this period`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 border-t-2 border-dashed border-stone" />
                  {topic ? "All topics" : `${secondName} · same months a year earlier`}
                </span>
              </div>
            ) : null}
            <MoodChart
              months={points.map((p) => ({ label: p.label, fullLabel: p.fullLabel }))}
              main={{ name: mainName, values: main }}
              second={second ? { name: secondName, values: second } : null}
              secondName={topic ? "All topics" : "A year earlier"}
              selected={selected}
              onSelect={setSelected}
              events={events}
              ariaLabel={ariaLabel}
            />

            {props.events.length > 0 ? (
              <ol className="flex flex-wrap gap-x-5 gap-y-2">
                {props.events.map((event, i) => (
                  <li key={event.key} className="flex items-center gap-2 text-[13px] text-ink">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                        event.kind === "ai" ? "bg-ai" : "bg-ink"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <button type="button" onClick={() => setSelected(event.index)} className="text-left hover:underline">
                      <strong className="font-semibold">{points[event.index]?.label}</strong> {event.text}
                    </button>
                    <span
                      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ${
                        event.kind === "ai" ? "bg-ai-tint text-ai" : "bg-line-2 text-ink-2"
                      }`}
                    >
                      {event.kind === "ai" ? "Spotted by AI" : "Your note"}
                    </span>
                    {event.removableId ? (
                      <button
                        type="button"
                        onClick={() => removeNote(event.removableId as string)}
                        disabled={saving}
                        className="inline-flex size-6 items-center justify-center rounded-full text-ink-3 hover:bg-line-2 hover:text-ink"
                        aria-label={`Remove note “${event.text}”`}
                      >
                        <X aria-hidden className="size-3" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {props.canNote ? (
              adding ? (
                <form
                  className="flex flex-wrap items-center gap-2 rounded-[10px] bg-paper p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveNote();
                  }}
                >
                  <label htmlFor="note-input" className="text-[13px] font-semibold text-ink">
                    What changed in {point?.fullLabel}?
                  </label>
                  <input
                    id="note-input"
                    type="text"
                    value={draft}
                    maxLength={280}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="e.g. New menu, renovation, staff change"
                    className="h-[38px] min-w-0 flex-[1_1_220px] rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="inline-flex h-[38px] items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNoteError(null);
                    }}
                    className="p-2 text-[13px] font-medium text-ink-2"
                  >
                    Cancel
                  </button>
                  {noteError ? <p className="basis-full text-[13px] text-bad">{noteError}</p> : null}
                </form>
              ) : (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(true);
                      setDraft("");
                      setNoteError(null);
                    }}
                    className="inline-flex items-center gap-1.5 self-start py-1.5 text-left text-[13px] font-medium text-brand hover:text-brand-hover"
                  >
                    <Plus aria-hidden className="size-3.5 shrink-0" />
                    Add a note to {point?.fullLabel} — so you can see what it did to the mood later
                  </button>
                  {noteError ? <p className="text-[13px] text-bad">{noteError}</p> : null}
                </div>
              )
            ) : null}
          </div>

          <aside
            aria-live="polite"
            aria-label={`${point?.fullLabel} in detail`}
            className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5 rounded-[14px] border border-line-2 bg-[#f8f9fb] p-[18px]"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSelected(Math.max(0, selected - 1))}
                disabled={selected === 0}
                aria-label="Previous month"
                className="flex size-9 items-center justify-center rounded-full border border-line bg-white disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="size-3.5" />
              </button>
              <span className="text-[15px] font-semibold text-ink">{point?.fullLabel}</span>
              <button
                type="button"
                onClick={() => setSelected(Math.min(points.length - 1, selected + 1))}
                disabled={selected === points.length - 1}
                aria-label="Next month"
                className="flex size-9 items-center justify-center rounded-full border border-line bg-white disabled:opacity-40"
              >
                <ChevronRight aria-hidden className="size-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[32px] font-bold leading-none tracking-[-0.02em] text-ink tabular-nums">
                {value === null ? "—" : `${value}%`}
                <span className="text-[15px] font-semibold tracking-normal text-ink-2"> happy</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    value !== null && prev !== null ? chipTone(value, prev) : "bg-line-2 text-ink-2"
                  }`}
                >
                  {selected === 0
                    ? "First month shown"
                    : value !== null && prev !== null
                      ? `${signed(value - prev)} pts vs ${points[selected - 1].label}`
                      : `No comparison with ${points[selected - 1].label}`}
                </span>
                {value !== null && against !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chipTone(value, against)}`}>
                    {signed(value - against)} pts vs {topic ? "all topics" : "a year ago"}
                  </span>
                ) : null}
              </div>
              <span className="text-[13px] text-ink-3">
                {point?.reviews.toLocaleString()} {point?.reviews === 1 ? "review" : "reviews"}
                {point?.rating !== null && point?.rating !== undefined ? ` · ${point.rating.toFixed(1)} average` : ""}
              </span>
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <span className="text-[13px] font-semibold text-ink">What moved it</span>
              {props.drivers[selected]?.length ? (
                props.drivers[selected].map((driver) => {
                  const tone = driver.direction === "up" ? "bg-ok-tint text-ok" : "bg-[#fdeee6] text-[#c2410c]";
                  return (
                    <div key={driver.topic} className="flex items-start gap-2 text-[13px] leading-[1.45] text-ink">
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-md ${tone}`}>
                        <StatusIcon status={driver.direction === "up" ? "better" : "worse"} />
                      </span>
                      <span>
                        <strong className="font-semibold">{driver.label}</strong> · {driver.text}
                      </span>
                    </div>
                  );
                })
              ) : (
                <span className="text-[13px] text-ink-3">
                  {selected === 0 ? "Pick a later month to see what changed." : "No topic moved much against the month before."}
                </span>
              )}
            </div>
            {props.quotes[selected] ? (
              <blockquote className="rounded-lg border border-line-2 bg-white px-3 py-2.5 text-[13px] leading-normal text-ink-2">
                “{props.quotes[selected]}”
              </blockquote>
            ) : null}
            {monthEvent >= 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                <span
                  className={`flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                    props.events[monthEvent].kind === "ai" ? "bg-ai" : "bg-ink"
                  }`}
                >
                  {monthEvent + 1}
                </span>
                {props.events[monthEvent].text}
              </div>
            ) : null}
            {point && point.reviews > 0 ? (
              <Link href={monthReviews} className="mt-auto text-[13px] font-medium text-brand hover:text-brand-hover">
                Read {point.label}’s {point.reviews.toLocaleString()} {point.reviews === 1 ? "review" : "reviews"}
              </Link>
            ) : null}
          </aside>
        </div>
      </section>

      {trends.length > 0 ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold text-ink">What’s driving the mood</h2>
            <span className="text-[13px] text-ink-3">
              Each topic over {points.length} {points.length === 1 ? "month" : "months"}, biggest change first. Same 0–100% scale on every
              card. Pick one to see it in the chart above.
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
            {trends.map((trend) => {
              const on = trend.topic === topicId;
              const tone = MOOD_TONE[trend.status];
              return (
                <button
                  key={trend.topic}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTopicId(on ? null : trend.topic)}
                  className={`flex flex-col gap-2.5 rounded-xl border p-4 text-left transition-colors ${
                    on ? "border-brand bg-[#f5f7fe]" : "border-line bg-white hover:border-brand-line"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{trend.label}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-[7px] py-0.5 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
                      <StatusIcon status={trend.status} className="size-2.5" />
                      {STATUS_LABEL[trend.status]}
                    </span>
                  </span>
                  <Sparkline values={trend.series} color={tone.line} />
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold tracking-[-0.01em] text-ink tabular-nums">
                      {trend.now === null ? "—" : `${trend.now}% happy`}
                    </span>
                    <span className="text-xs text-ink-3">
                      {trend.early !== null ? `was ${trend.early}% in the first half` : `${trend.mentions} mentions`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
