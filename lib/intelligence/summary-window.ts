import { parseDateRange, previousDateRange, type DateRange, type DateRangeKey } from "@/lib/date-range";
import { SUMMARY_TIMEZONES, type SummaryTimezone } from "@/lib/intelligence/identity";

export const SUMMARY_DEFAULT_TIMEZONE: SummaryTimezone = "Asia/Kolkata";

/**
 * Bounds are absolute instants. Custom URL dates stay whole UTC days, matching
 * the existing date filter: start inclusive, end exclusive.
 * A preset such as "12m" is frozen until the next UTC midnight so two requests
 * on the same UTC day share one row. Month labels inside a summary use
 * `timezone`. All-time has no bounds and means every review with a parseable
 * review_create_time in the scope.
 */
export interface SummaryWindow {
  kind: "all" | "bounded";
  start: string | null;
  end: string | null;
  timezone: SummaryTimezone;
  label: string;
  comparison: { start: string; end: string } | null;
}

export function assertSummaryTimezone(value: string): SummaryTimezone {
  if ((SUMMARY_TIMEZONES as readonly string[]).includes(value)) return value as SummaryTimezone;
  throw new Error("Unsupported summary timezone");
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function monthsBefore(end: Date, months: number): Date {
  const out = new Date(end);
  out.setUTCMonth(out.getUTCMonth() - months);
  return out;
}

const PRESET_MONTHS: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };

export function summaryWindow(range: DateRange, timezone: SummaryTimezone, now: Date = new Date()): SummaryWindow {
  if (range.key === "all") {
    return { kind: "all", start: null, end: null, timezone, label: "All time", comparison: null };
  }
  if (range.key === "custom") {
    if (!range.start || !range.end) throw new Error("A custom summary needs both dates");
    const start = range.start.toISOString();
    const end = range.end.toISOString();
    const previous = previousDateRange(range, now);
    return {
      kind: "bounded",
      start,
      end,
      timezone,
      label: range.label,
      comparison: previous ? { start: previous.start.toISOString(), end: previous.end.toISOString() } : null,
    };
  }
  const months = PRESET_MONTHS[range.key];
  if (!months) throw new Error("Unsupported summary range");
  const end = nextUtcMidnight(now);
  const start = monthsBefore(end, months);
  const bounded: DateRange = {
    key: range.key,
    from: "",
    to: "",
    start,
    end,
    label: range.label,
  };
  const previous = previousDateRange(bounded, end);
  return {
    kind: "bounded",
    start: start.toISOString(),
    end: end.toISOString(),
    timezone,
    label: range.label,
    comparison: previous ? { start: previous.start.toISOString(), end: previous.end.toISOString() } : null,
  };
}

export function summaryWindowFromParams(
  params: { range?: unknown; from?: unknown; to?: unknown },
  timezone: SummaryTimezone = SUMMARY_DEFAULT_TIMEZONE,
  now: Date = new Date(),
  fallback: DateRangeKey = "12m"
): SummaryWindow {
  return summaryWindow(parseDateRange(params, fallback, now), timezone, now);
}

export function windowContains(window: Pick<SummaryWindow, "kind" | "start" | "end">, iso: string | null): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  if (window.kind === "all") return true;
  if (!window.start || !window.end) return false;
  return time >= Date.parse(window.start) && time < Date.parse(window.end);
}

/** Month key in the summary timezone. Bounds themselves stay UTC instants. */
export function summaryMonth(iso: string, timezone: SummaryTimezone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(iso));
  return parts.slice(0, 7);
}
