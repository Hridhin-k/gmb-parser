"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { BusinessCard, LocationCardRow } from "@/lib/services/locations-board";
import { cn } from "@/lib/utils";

const SWATCHES = ["#1f4ed8", "#b45309", "#15803d", "#6d28d9", "#0e7490", "#b91c1c"];

function swatch(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SWATCHES[hash % SWATCHES.length];
}

function rating(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** Connected, or what to do about it. Expired access reads as Reconnect, as on the board. */
function googleState(row: LocationCardRow): { label: string; tone: "ok" | "warn" | "bad" | "muted"; href: string | null } {
  switch (row.connection.kind) {
    case "connected":
      return { label: "Connected", tone: "ok", href: null };
    case "expired":
      return { label: "Reconnect", tone: "warn", href: "/settings?section=integrations" };
    case "unknown":
      return { label: "Not connected", tone: "warn", href: "/settings?section=integrations" };
    case "paused":
      return { label: "Paused", tone: "muted", href: null };
    default:
      return { label: row.connection.label, tone: "warn", href: `/locations?view=groups&location=${row.id}` };
  }
}

const TONE = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-ink-3",
} as const;

function LocationRows({ rows }: { rows: LocationCardRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="border-t border-line-2 px-5 py-4 text-[13px] text-ink-3">
        No Google locations on this business yet. Assign one from the new locations above, or open the business to manage it.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto border-t border-line-2">
      <table className="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th scope="col" className="px-5 py-2.5 font-medium">Location</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Rating</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Need a reply</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Google</th>
            <th scope="col" className="px-5 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = googleState(row);
            const action = state.href
              ? { label: "Fix", href: state.href }
              : { label: row.unreplied > 0 ? "Open reviews" : "View", href: `/reviews?location=${row.id}` };
            return (
              <tr key={row.id} className="border-t border-line-2">
                <td className="px-5 py-3.5">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{row.name}</span>
                    {row.address ? <span className="text-xs text-ink-3">{row.address}</span> : null}
                  </span>
                </td>
                <td className="px-3 py-3.5 tabular-nums text-ink">{rating(row.rating)}</td>
                <td className="px-3 py-3.5 tabular-nums text-ink">{row.unreplied.toLocaleString("en-US")}</td>
                <td className="px-3 py-3.5">
                  <span className={cn("inline-flex items-center gap-1.5 text-[13px]", TONE[state.tone])}>
                    <span className="size-[7px] rounded-full bg-current" aria-hidden />
                    {state.label}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Link href={action.href} className="text-[13px] font-medium text-brand hover:text-brand-hover">
                    {action.label}
                    <span className="sr-only"> · {row.name}</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One card per business. Opening a card shows its locations; the first card starts open. */
export function LocationBusinessCards({ businesses, canManage }: { businesses: BusinessCard[]; canManage: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    businesses[0] ? { [businesses[0].id]: true } : {}
  );

  return (
    <div className="flex flex-col gap-4">
      {businesses.map((business) => {
        const expanded = Boolean(open[business.id]);
        const panelId = `business-${business.id}`;
        return (
          <section key={business.id} className="overflow-hidden rounded-xl border border-line bg-white">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen((current) => ({ ...current, [business.id]: !expanded }))}
              className="flex w-full flex-wrap items-center gap-x-5 gap-y-3 px-5 py-[18px] text-left outline-none hover:bg-[#fafbfd] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-line"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-[9px] text-sm font-bold text-white"
                style={{ background: swatch(business.id) }}
                aria-hidden
              >
                {business.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-ink">{business.name}</span>
                <span className="text-[13px] text-ink-3">{plural(business.locations.length, "location", "locations")}</span>
              </span>
              <span className="flex gap-5 text-[13px] text-ink-2">
                <span>
                  <strong className="text-[15px] font-semibold tabular-nums text-ink">{rating(business.rating)}</strong> avg
                </span>
                <span>
                  <strong className={cn("text-[15px] font-semibold tabular-nums", business.unreplied === 0 ? "text-ok" : "text-ink")}>
                    {business.unreplied.toLocaleString("en-US")}
                  </strong>{" "}
                  need a reply
                </span>
              </span>
              <ChevronDown
                className={cn("size-[18px] shrink-0 text-ink-3 transition-transform", expanded && "rotate-180")}
                aria-hidden
              />
            </button>
            {expanded ? (
              <div id={panelId}>
                <LocationRows rows={business.locations} />
                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-line-2 px-5 py-2.5 text-[13px]">
                  <Link href={`/locations?view=groups&brand=${business.id}`} className="font-medium text-brand hover:text-brand-hover">
                    Groups and rules
                  </Link>
                  {canManage ? (
                    <Link href={`/businesses/${business.id}`} className="font-medium text-brand hover:text-brand-hover">
                      Manage business
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
