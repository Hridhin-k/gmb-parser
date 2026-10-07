/**
 * Shared time-range filter. URL shape: ?range=3m, or ?range=custom&from=2026-01-01&to=2026-03-31.
 * Custom dates are whole UTC days; `end` is exclusive (the day after `to`).
 */

export const DATE_RANGE_PRESETS = [
  { key: "1m", label: "Last month", months: 1 },
  { key: "3m", label: "Last 3 months", months: 3 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "12m", label: "Last 12 months", months: 12 },
] as const;

export type DateRangePresetKey = (typeof DATE_RANGE_PRESETS)[number]["key"];
export type DateRangeKey = DateRangePresetKey | "custom" | "all";

export const DATE_RANGE_OPTIONS: ReadonlyArray<{ key: DateRangeKey; label: string }> = [
  ...DATE_RANGE_PRESETS,
  { key: "custom", label: "Custom dates" },
  { key: "all", label: "All time" },
];

/** Default window for the agency home usage list. */
export const AGENCY_DEFAULT_RANGE: DateRangeKey = "1m";

export interface DateRange {
  key: DateRangeKey;
  /** YYYY-MM-DD, only for custom ranges. */
  from: string;
  to: string;
  start: Date | null;
  /** Exclusive. null means "now". */
  end: Date | null;
  label: string;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isoDay(value: string): Date | null {
  if (!ISO_DAY.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsBefore(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() - months);
  return out;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function presetMonths(key: string): number | null {
  return DATE_RANGE_PRESETS.find((p) => p.key === key)?.months ?? null;
}

export function isDateRangeKey(value: string): value is DateRangeKey {
  return DATE_RANGE_OPTIONS.some((o) => o.key === value);
}

/**
 * Reads range/from/to from search params. A bare from/to (older audit links)
 * is treated as a custom range.
 */
export function parseDateRange(
  params: { range?: unknown; from?: unknown; to?: unknown },
  fallback: DateRangeKey = "all",
  now: Date = new Date()
): DateRange {
  const rawKey = str(params.range);
  let fromDay = isoDay(str(params.from));
  let toDay = isoDay(str(params.to));
  const key: DateRangeKey = isDateRangeKey(rawKey)
    ? rawKey
    : fromDay || toDay
      ? "custom"
      : fallback;

  if (key === "custom") {
    if (!fromDay && !toDay) return parseDateRange({}, fallback === "custom" ? "all" : fallback, now);
    if (fromDay && toDay && fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
    const from = fromDay ? toIsoDay(fromDay) : "";
    const to = toDay ? toIsoDay(toDay) : "";
    return {
      key,
      from,
      to,
      start: fromDay,
      end: toDay ? new Date(toDay.getTime() + DAY_MS) : null,
      label: fromDay && toDay
        ? `${dayLabel(fromDay)} – ${dayLabel(toDay)}`
        : fromDay
          ? `Since ${dayLabel(fromDay)}`
          : `Until ${dayLabel(toDay!)}`,
    };
  }

  const months = presetMonths(key);
  if (months) {
    return {
      key,
      from: "",
      to: "",
      start: monthsBefore(now, months),
      end: null,
      label: DATE_RANGE_OPTIONS.find((o) => o.key === key)!.label,
    };
  }

  return { key: "all", from: "", to: "", start: null, end: null, label: "All time" };
}

/** The same-length window immediately before `range`, for "vs previous" comparisons. */
export function previousDateRange(range: DateRange, now: Date = new Date()): { start: Date; end: Date } | null {
  if (!range.start) return null;
  const months = presetMonths(range.key);
  if (months) return { start: monthsBefore(range.start, months), end: range.start };
  const end = range.end ?? now;
  const span = end.getTime() - range.start.getTime();
  return span > 0 ? { start: new Date(range.start.getTime() - span), end: range.start } : null;
}

/** Search params for a range, omitting the page default. */
export function dateRangeParams(range: DateRange, fallback: DateRangeKey): Record<string, string> {
  if (range.key === fallback && range.key !== "custom") return {};
  if (range.key !== "custom") return { range: range.key };
  const out: Record<string, string> = { range: "custom" };
  if (range.from) out.from = range.from;
  if (range.to) out.to = range.to;
  return out;
}

/** Defaults for the date pickers when someone switches to "Custom dates". */
export function defaultCustomDays(now: Date = new Date()): { from: string; to: string } {
  return { from: toIsoDay(monthsBefore(now, 1)), to: toIsoDay(now) };
}
