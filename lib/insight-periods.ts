/**
 * Calendar-aligned periods for the insights page. They are expressed as custom
 * date ranges (whole UTC days) so the saved report for "Last month" keeps the
 * same cache key all month instead of drifting a day at a time.
 */

export interface InsightPeriod {
  key: string;
  label: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /**
   * YYYY-MM-DD, inclusive. Empty for a period still in progress ("this month",
   * year to date): it stays open-ended so the saved report keeps its identity
   * as days pass, and a fingerprint of the reviews tells when it is out of date.
   */
  to: string;
}

const DAY_MS = 86_400_000;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const firstOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 1));
const lastOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0));

export const DEFAULT_PERIOD_KEY = "last_3";

export function insightPeriods(now: Date = new Date()): InsightPeriod[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return [
    { key: "this_month", label: "This month", from: iso(firstOfMonth(year, month)), to: "" },
    { key: "last_month", label: "Last month", from: iso(firstOfMonth(year, month - 1)), to: iso(lastOfMonth(year, month - 1)) },
    { key: "last_3", label: "Last 3 months", from: iso(firstOfMonth(year, month - 3)), to: iso(lastOfMonth(year, month - 1)) },
    { key: "last_6", label: "Last 6 months", from: iso(firstOfMonth(year, month - 6)), to: iso(lastOfMonth(year, month - 1)) },
    { key: "ytd", label: "Year to date", from: iso(firstOfMonth(year, 0)), to: "" },
  ];
}

export function defaultPeriod(now: Date = new Date()): InsightPeriod {
  return insightPeriods(now).find((period) => period.key === DEFAULT_PERIOD_KEY)!;
}

/** The period whose dates equal this custom range, if any. */
export function matchPeriod(
  range: { key: string; from: string; to: string },
  now: Date = new Date()
): InsightPeriod | null {
  if (range.key !== "custom") return null;
  return insightPeriods(now).find((period) => period.from === range.from && period.to === range.to) ?? null;
}

/** The window of the same length immediately before `start`. */
export function previousWindow(
  start: Date,
  end: Date | null,
  now: Date = new Date()
): { start: Date; end: Date } {
  const length = Math.max(DAY_MS, (end ?? now).getTime() - start.getTime());
  return { start: new Date(start.getTime() - length), end: new Date(start.getTime()) };
}
