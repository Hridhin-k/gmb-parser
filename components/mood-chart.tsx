"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/** Shared with the explorer legend so the swatches match the lines. */
export const MOOD_COLORS = {
  main: "#1f4ed8",
  second: "#8a93a3",
  grid: "#eef0f3",
  axis: "#d5d9e0",
  ink: "#14181f",
  ink3: "#687283",
  note: "#14181f",
  ai: "#6d28d9",
} as const;

export interface MoodChartSeries {
  /** Direct label at the line's end ("2026", "Wait time"). */
  name: string;
  values: Array<number | null>;
}

export interface MoodChartEvent {
  index: number;
  n: number;
  kind: "note" | "ai";
  text: string;
}

interface MoodChartProps {
  months: Array<{ label: string; fullLabel: string }>;
  main: MoodChartSeries;
  /** Dashed comparison line: last year, or all topics. */
  second: MoodChartSeries | null;
  secondName: string;
  selected: number;
  onSelect: (index: number) => void;
  events: MoodChartEvent[];
  ariaLabel: string;
}

const PAD = { left: 40, right: 64, top: 36, bottom: 30 };

function lastValue(values: Array<number | null>): { index: number; value: number } | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value !== null) return { index: i, value };
  }
  return null;
}

/** Runs of consecutive months with a value; a gap breaks the line. */
function segments(values: Array<number | null>): Array<Array<{ i: number; v: number }>> {
  const out: Array<Array<{ i: number; v: number }>> = [];
  let current: Array<{ i: number; v: number }> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) out.push(current);
      current = [];
    } else current.push({ i, v });
  });
  if (current.length) out.push(current);
  return out;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(280, Math.round(node.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Customer mood over the chart months: one 0–100% axis, an area under the
 * main line, an optional dashed comparison, direct end labels and event pins.
 * Hovering or focusing a month selects it and shows its values.
 */
export function MoodChart({ months, main, second, secondName, selected, onSelect, events, ariaLabel }: MoodChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(720);
  const [tip, setTip] = useState(false);
  const n = months.length;
  const narrow = width < 520;
  const height = narrow ? 230 : 262;
  const left = PAD.left;
  const right = width - (narrow ? 52 : PAD.right);
  const top = PAD.top;
  const bottom = height - PAD.bottom;

  const visible = [...main.values, ...(second?.values ?? [])].filter((v): v is number => v !== null);
  let lo = visible.length ? Math.max(0, Math.floor((Math.min(...visible) - 4) / 10) * 10) : 0;
  let hi = visible.length ? Math.min(100, Math.ceil((Math.max(...visible) + 4) / 10) * 10) : 100;
  if (hi - lo < 20) {
    if (hi + 10 <= 100) hi += 10;
    if (hi - lo < 20) lo = Math.max(0, lo - 10);
  }
  const step = n > 1 ? (right - left) / (n - 1) : 0;
  const X = (i: number) => (n > 1 ? left + i * step : (left + right) / 2);
  const Y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const tickStep = hi - lo > 50 ? 20 : 10;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += tickStep) ticks.push(v);

  const line = (run: Array<{ i: number; v: number }>) => run.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const mainRuns = segments(main.values);
  const secondRuns = second ? segments(second.values) : [];

  // End labels, nudged apart when the lines finish close together.
  const mainEnd = lastValue(main.values);
  const secondEnd = second ? lastValue(second.values) : null;
  let mainLabelY = mainEnd ? Y(mainEnd.value) + 4 : 0;
  let secondLabelY = secondEnd ? Y(secondEnd.value) + 4 : 0;
  if (mainEnd && secondEnd && Math.abs(mainLabelY - secondLabelY) < 14) {
    const mid = (mainLabelY + secondLabelY) / 2;
    const mainAbove = mainEnd.value >= secondEnd.value;
    mainLabelY = mid + (mainAbove ? -7 : 7);
    secondLabelY = mid + (mainAbove ? 7 : -7);
  }

  // Month labels: as many as fit, counted back from the latest month.
  const every = Math.max(1, Math.ceil((n * (narrow ? 34 : 40)) / Math.max(1, right - left)));
  const showLabel = (i: number) =>
    i === selected || (((n - 1 - i) % every === 0) && Math.abs(i - selected) >= Math.max(1, Math.ceil(every / 1.5)));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft" ? selected - 1 : event.key === "ArrowRight" ? selected + 1 : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(Math.max(0, Math.min(n - 1, next)));
    setTip(true);
  }

  const selValue = main.values[selected] ?? null;
  const selSecond = second?.values[selected] ?? null;
  const tipLeft = Math.min(Math.max(X(selected), 70), width - 70);
  const tipTop = selValue !== null ? Math.max(4, Y(selValue) - 58) : top;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel} Use the left and right arrow keys to pick a month.`}
      onKeyDown={onKeyDown}
      onFocus={() => setTip(true)}
      onBlur={() => setTip(false)}
      onMouseLeave={() => setTip(false)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={right} y1={Y(v)} y2={Y(v)} stroke={v === lo ? MOOD_COLORS.axis : MOOD_COLORS.grid} strokeWidth="1" />
            <text x={left - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill={MOOD_COLORS.ink3}>
              {v}%
            </text>
          </g>
        ))}

        {events.map((event) => {
          // Pins in the same month sit side by side above the one guide line.
          const same = events.filter((other) => other.index === event.index);
          const cx = X(event.index) + (same.indexOf(event) - (same.length - 1) / 2) * 20;
          return (
            <g key={`${event.kind}-${event.n}`}>
              {same[0] === event ? (
                <line x1={X(event.index)} x2={X(event.index)} y1={30} y2={bottom} stroke="#c3c9d3" strokeWidth="1" strokeDasharray="3 4" />
              ) : null}
              <circle cx={cx} cy={16} r={9} fill={event.kind === "ai" ? MOOD_COLORS.ai : MOOD_COLORS.note}>
                <title>{event.text}</title>
              </circle>
              <text x={cx} y={20} textAnchor="middle" fontSize="11" fontWeight="700" fill="#ffffff" aria-hidden>
                {event.n}
              </text>
            </g>
          );
        })}

        <line x1={X(selected)} x2={X(selected)} y1={30} y2={bottom} stroke={MOOD_COLORS.ink} strokeWidth="1" opacity="0.2" />

        {mainRuns
          .filter((run) => run.length > 1)
          .map((run) => (
            <polygon
              key={`area-${run[0].i}`}
              points={`${line(run)} ${X(run[run.length - 1].i).toFixed(1)},${bottom} ${X(run[0].i).toFixed(1)},${bottom}`}
              fill={MOOD_COLORS.main}
              opacity="0.08"
            />
          ))}

        {secondRuns.map((run) =>
          run.length > 1 ? (
            <polyline
              key={`second-${run[0].i}`}
              points={line(run)}
              fill="none"
              stroke={MOOD_COLORS.second}
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <circle key={`second-${run[0].i}`} cx={X(run[0].i)} cy={Y(run[0].v)} r={2.5} fill={MOOD_COLORS.second} />
          )
        )}
        {second && secondEnd ? (
          <text x={right + 8} y={secondLabelY} fontSize="12" fontWeight="500" fill={MOOD_COLORS.ink3}>
            {second.name}
          </text>
        ) : null}

        {mainRuns
          .filter((run) => run.length > 1)
          .map((run) => (
            <polyline
              key={`main-${run[0].i}`}
              points={line(run)}
              fill="none"
              stroke={MOOD_COLORS.main}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        {mainEnd ? (
          <text x={right + 8} y={mainLabelY} fontSize="12" fontWeight="600" fill={MOOD_COLORS.ink}>
            {main.name}
          </text>
        ) : null}
        {main.values.map((v, i) =>
          v === null ? null : (
            <circle
              key={`dot-${i}`}
              cx={X(i)}
              cy={Y(v)}
              r={i === selected ? 5.5 : 3}
              fill={i === selected ? MOOD_COLORS.main : "#ffffff"}
              stroke={MOOD_COLORS.main}
              strokeWidth="2"
            />
          )
        )}

        {months.map((month, i) =>
          showLabel(i) ? (
            <text
              key={`x-${i}`}
              x={X(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="12"
              fontWeight={i === selected ? 700 : 400}
              fill={i === selected ? MOOD_COLORS.ink : MOOD_COLORS.ink3}
            >
              {month.label}
            </text>
          ) : null
        )}

        {months.map((month, i) => (
          <rect
            key={`hit-${i}`}
            x={n > 1 ? X(i) - step / 2 : left}
            y={0}
            width={n > 1 ? step : right - left}
            height={height}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => {
              onSelect(i);
              setTip(true);
            }}
            onClick={() => onSelect(i)}
          >
            <title>{month.fullLabel}</title>
          </rect>
        ))}
      </svg>

      {tip && months[selected] ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: tipLeft, top: tipTop }}
          role="status"
        >
          <p className="font-semibold text-ink">{months[selected].fullLabel}</p>
          <p className="tabular-nums text-ink-2">
            {main.name}: {selValue === null ? "too few mentions" : `${selValue}% happy`}
          </p>
          {second ? (
            <p className="tabular-nums text-ink-3">
              {secondName}: {selSecond === null ? "—" : `${selSecond}%`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
