"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface VolumeDay {
  day: string;
  /** "Tue 3 Nov" */
  label: string;
  reviews: number;
  avgRating: number | null;
  low: number;
}

/**
 * New reviews per day. One y-axis from zero, bars with 4px rounded tops,
 * days with a 1–2 star review in red (named in the legend too).
 */
export function VolumeChart({
  days,
  yMax,
  summary,
}: {
  days: VolumeDay[];
  yMax: number;
  summary: string;
}) {
  const [hover, setHover] = useState(-1);
  const tip = hover >= 0 ? days[hover] : undefined;
  const left = hover >= 0 ? Math.min(88, Math.max(12, ((hover + 0.5) / days.length) * 100)) : 0;
  const gap = days.length > 45 ? "gap-px" : "gap-0.5";

  return (
    <div role="img" aria-label={summary} className="relative flex flex-col gap-2">
      <div className="relative h-[200px] border-b border-line">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-dashed border-line-2" />
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-2" />
        <span aria-hidden="true" className="absolute -top-4 right-0 text-[11px] text-ink-3 tabular-nums">
          {yMax.toLocaleString("en-US")}
        </span>
        <div className={cn("absolute inset-0 flex items-end", gap)} onMouseLeave={() => setHover(-1)}>
          {days.map((day, index) => (
            <div
              key={day.day}
              onMouseEnter={() => setHover(index)}
              className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end"
            >
              {day.reviews > 0 ? (
                <div
                  className={cn(
                    "rounded-t-[4px] motion-safe:transition-opacity",
                    day.low > 0 ? "bg-bad" : "bg-brand",
                    hover === -1 || hover === index ? "opacity-100" : "opacity-45"
                  )}
                  style={{ height: `${Math.max(1, (day.reviews / yMax) * 100)}%` }}
                />
              ) : null}
            </div>
          ))}
        </div>
        {tip ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-2 text-xs leading-[1.45] text-white shadow-[0_4px_12px_rgba(20,24,31,0.18)]"
            style={{ left: `${left}%` }}
          >
            <div className="font-semibold">{tip.label}</div>
            <div>
              {tip.reviews.toLocaleString("en-US")} {tip.reviews === 1 ? "review" : "reviews"}
              {tip.avgRating !== null ? ` · ${tip.avgRating.toFixed(1)} average` : ""}
            </div>
            <div className="text-[#c3c9d3]">
              {tip.low > 0
                ? `${tip.low.toLocaleString("en-US")} with 1–2 stars`
                : tip.reviews > 0
                  ? "No low ratings"
                  : "No reviews"}
            </div>
          </div>
        ) : null}
      </div>
      <div aria-hidden="true" className="flex justify-between text-[11px] text-ink-3">
        <span>{days[0]?.label}</span>
        <span>{days[days.length - 1]?.label}</span>
      </div>
    </div>
  );
}
