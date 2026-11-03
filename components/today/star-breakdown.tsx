"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface StarRow {
  stars: number;
  count: number;
  href: string;
}

/** Count per star level. Hover or focus a row to read its share. */
export function StarBreakdown({ rows }: { rows: StarRow[] }) {
  const [active, setActive] = useState(-1);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <ul className="flex flex-col gap-3" onMouseLeave={() => setActive(-1)}>
      {rows.map((row) => {
        const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
        return (
          <li key={row.stars}>
            <Link
              href={row.href}
              onMouseEnter={() => setActive(row.stars)}
              onFocus={() => setActive(row.stars)}
              onBlur={() => setActive(-1)}
              aria-label={`${row.stars} star: ${row.count.toLocaleString("en-US")} reviews, ${pct}%`}
              className="flex items-center gap-2.5 rounded-md text-[13px] text-ink outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="w-7 flex-none text-ink-2">{row.stars}★</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-line-2">
                <span
                  className={cn("block h-2.5 rounded-full", row.stars <= 2 ? "bg-bad" : "bg-brand")}
                  style={{ width: `${total > 0 ? Math.max(row.count > 0 ? 1 : 0, (row.count / total) * 100) : 0}%` }}
                />
              </span>
              <span className="w-16 flex-none text-right tabular-nums">
                {active === row.stars ? `${pct}%` : row.count.toLocaleString("en-US")}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
