import { DAY_RANGE_PRESETS, isDayRangeKey, parseDateRange, type DateRange, type DayRangeKey } from "@/lib/date-range";
import type { OverviewKpis, OverviewThemeBar } from "@/lib/overview-board";

/**
 * Today page numbers. Pure helpers so the page and tests share them.
 *
 * The page only offers 7, 30 and 90 days. Another period carried in from a
 * different page maps to the nearest of those, and no period means 30 days.
 * A day is a calendar day in the workspace timezone. A "low" day has at least
 * one 1–2 star review.
 */

export const TODAY_DEFAULT_RANGE: DayRangeKey = "30d";

const DAY_MS = 86_400_000;

export function todayRange(
  params: { range?: unknown; from?: unknown; to?: unknown },
  now: Date = new Date()
): DateRange {
  const asked = parseDateRange(params, "all", now);
  if (isDayRangeKey(asked.key)) return asked;
  let key: DayRangeKey = TODAY_DEFAULT_RANGE;
  if (asked.start) {
    const span = ((asked.end ?? now).getTime() - asked.start.getTime()) / DAY_MS;
    key = span <= 10 ? "7d" : span <= 45 ? "30d" : "90d";
  }
  return parseDateRange({ range: key }, TODAY_DEFAULT_RANGE, now);
}

export function rangeDays(range: DateRange): number {
  return DAY_RANGE_PRESETS.find((preset) => preset.key === range.key)?.days ?? 30;
}

/** One review in the window, reduced to what the Today charts need. */
export interface TodayReviewRow {
  createdAt: string;
  stars: number;
  replied: boolean;
  /** Hours from review to Google reply. Null when there is no reply time. */
  responseHours: number | null;
}

export interface TodayDay {
  /** yyyy-mm-dd in the workspace timezone. */
  day: string;
  reviews: number;
  ratingSum: number;
  /** 1–2 star reviews. */
  low: number;
  replied: number;
  responseHoursSum: number;
  responseCount: number;
}

export function dayKeyInZone(value: Date | string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/**
 * `days` calendar days ending today. Reviews from the rolling window that fall
 * before the first day count toward it, so the bars add up to the window total.
 */
export function buildDays(rows: TodayReviewRow[], input: { days: number; now: Date; timeZone: string }): TodayDay[] {
  const today = dayKeyInZone(input.now, input.timeZone);
  const list: TodayDay[] = [];
  for (let index = input.days - 1; index >= 0; index -= 1) {
    list.push({ day: shiftDay(today, -index), reviews: 0, ratingSum: 0, low: 0, replied: 0, responseHoursSum: 0, responseCount: 0 });
  }
  if (list.length === 0) return list;
  const byDay = new Map(list.map((day) => [day.day, day]));
  const first = list[0]!;
  for (const row of rows) {
    if (row.stars < 1 || row.stars > 5) continue;
    const key = dayKeyInZone(row.createdAt, input.timeZone);
    if (!key || key > today) continue;
    const day = byDay.get(key) ?? (key < first.day ? first : null);
    if (!day) continue;
    day.reviews += 1;
    day.ratingSum += row.stars;
    if (row.stars <= 2) day.low += 1;
    if (row.replied) day.replied += 1;
    if (row.responseHours !== null && Number.isFinite(row.responseHours) && row.responseHours >= 0) {
      day.responseHoursSum += row.responseHours;
      day.responseCount += 1;
    }
  }
  return list;
}

/** Splits the days into at most `count` even runs, oldest first. Only the oldest run can be short. */
function buckets(days: TodayDay[], count: number): TodayDay[][] {
  const size = Math.max(1, Math.ceil(days.length / count));
  const out: TodayDay[][] = [];
  for (let end = days.length; end > 0; end -= size) out.unshift(days.slice(Math.max(0, end - size), end));
  return out;
}

function sum(days: TodayDay[], key: keyof Omit<TodayDay, "day">): number {
  return days.reduce((total, day) => total + day[key], 0);
}

export interface TodaySparks {
  rating: Array<number | null>;
  /** Reviews per day. */
  reviews: number[];
  replyRate: Array<number | null>;
  replyHours: Array<number | null>;
}

/** Sparkline series over up to eight runs of days. New reviews is the daily average in each run. */
export function sparkSeries(days: TodayDay[]): TodaySparks {
  const runs = buckets(days, 8);
  return {
    rating: runs.map((run) => {
      const reviews = sum(run, "reviews");
      return reviews > 0 ? sum(run, "ratingSum") / reviews : null;
    }),
    reviews: runs.map((run) => sum(run, "reviews") / run.length),
    replyRate: runs.map((run) => {
      const reviews = sum(run, "reviews");
      return reviews > 0 ? sum(run, "replied") / reviews : null;
    }),
    replyHours: runs.map((run) => {
      const count = sum(run, "responseCount");
      return count > 0 ? sum(run, "responseHoursSum") / count : null;
    }),
  };
}

export interface SparkShape {
  points: string;
  endX: number;
  endY: number;
}

/** Polyline points in a 112×40 box. Missing values are skipped. Null with fewer than two values. */
export function sparkShape(values: Array<number | null>, width = 112, height = 40): SparkShape | null {
  const known = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value !== null && Number.isFinite(item.value));
  if (known.length < 2) return null;
  const min = Math.min(...known.map((item) => item.value));
  const max = Math.max(...known.map((item) => item.value));
  const span = max - min || 1;
  const last = Math.max(1, values.length - 1);
  const top = 4;
  const usable = height - top * 2;
  const points = known.map((item) => ({
    x: Math.round((item.index / last) * width),
    y: Math.round(height - top - (max === min ? usable / 2 : ((item.value - min) / span) * usable)),
  }));
  const end = points[points.length - 1]!;
  return { points: points.map((point) => `${point.x},${point.y}`).join(" "), endX: end.x, endY: end.y };
}

/** "45 min", "2h 50m", "3.2 days". */
export function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (hours < 48) {
    const whole = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${whole}h ${rest}m` : `${whole}h`;
  }
  const days = hours / 24;
  return `${days >= 10 ? Math.round(days) : days.toFixed(1)} days`;
}

export type Tone = "good" | "bad" | "flat";
export type Direction = "up" | "down" | "flat";

export interface TodayKpi {
  id: "rating" | "reviews" | "replied" | "reply-time";
  label: string;
  value: string;
  delta: string;
  tone: Tone;
  direction: Direction;
  spark: SparkShape | null;
  /** Screen-reader summary of the tile. */
  summary: string;
}

function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${text}`;
}

function direction(diff: number, epsilon: number): Direction {
  if (Math.abs(diff) < epsilon) return "flat";
  return diff > 0 ? "up" : "down";
}

const NO_EARLIER = "No earlier period";

export function buildKpis(kpis: OverviewKpis, sparks: TodaySparks): TodayKpi[] {
  const out: TodayKpi[] = [];

  {
    const value = kpis.avgRating;
    const before = kpis.previousAvgRating;
    const diff = value !== null && before !== null ? value - before : null;
    const dir = diff === null ? "flat" : direction(diff, 0.05);
    out.push({
      id: "rating",
      label: "Average rating",
      value: value === null ? "—" : value.toFixed(1),
      delta: diff === null ? NO_EARLIER : dir === "flat" ? "No change" : signed(diff, 1),
      tone: dir === "flat" ? "flat" : dir === "up" ? "good" : "bad",
      direction: dir,
      spark: sparkShape(sparks.rating),
      summary: "",
    });
  }

  {
    const before = kpis.previousReviews;
    const change = before !== null && before > 0 ? (kpis.reviews - before) / before : null;
    const dir = change === null ? "flat" : direction(change, 0.005);
    out.push({
      id: "reviews",
      label: "New reviews",
      value: kpis.reviews.toLocaleString("en-US"),
      delta: change === null ? (before === 0 && kpis.reviews > 0 ? "None before" : NO_EARLIER) : dir === "flat" ? "No change" : `${signed(change * 100, 0)}%`,
      tone: dir === "flat" ? "flat" : dir === "up" ? "good" : "bad",
      direction: dir,
      spark: sparkShape(sparks.reviews),
      summary: "",
    });
  }

  {
    const value = kpis.replyRate;
    const before = kpis.previousReplyRate;
    const diff = value !== null && before !== null ? (value - before) * 100 : null;
    const dir = diff === null ? "flat" : direction(diff, 0.5);
    out.push({
      id: "replied",
      label: "Replied",
      value: value === null ? "—" : `${Math.round(value * 100)}%`,
      delta: diff === null ? NO_EARLIER : dir === "flat" ? "No change" : `${signed(diff, 0)} pts`,
      tone: dir === "flat" ? "flat" : dir === "up" ? "good" : "bad",
      direction: dir,
      spark: sparkShape(sparks.replyRate),
      summary: "",
    });
  }

  {
    const value = kpis.avgResponseHours;
    const before = kpis.previousAvgResponseHours;
    const diff = value !== null && before !== null ? value - before : null;
    // Faster is better, so a drop in hours is the good direction.
    const dir = diff === null ? "flat" : direction(diff, 1 / 60);
    out.push({
      id: "reply-time",
      label: "Time to reply",
      value: formatDuration(value),
      delta:
        diff === null
          ? NO_EARLIER
          : dir === "flat"
            ? "No change"
            : `${formatDuration(Math.abs(diff))} ${diff < 0 ? "faster" : "slower"}`,
      tone: dir === "flat" ? "flat" : dir === "down" ? "good" : "bad",
      direction: dir,
      spark: sparkShape(sparks.replyHours),
      summary: "",
    });
  }

  for (const tile of out) {
    tile.summary = `${tile.label} ${tile.value}. ${tile.delta === NO_EARLIER ? "No earlier period to compare." : `${tile.delta} on the previous period.`}`;
  }
  return out;
}

export interface NeedsYouInput {
  unhappyUnreplied: number;
  oldestUnhappyAt: string | null;
  followUps: number;
  overdueFollowUps: number;
  nextFollowUpDue: string | null;
  drafts: number;
  failed: number;
}

export interface NeedsYouTask {
  id: "unhappy" | "follow-ups" | "drafts" | "failed";
  count: number;
  label: string;
  hint: string;
  tone: "bad" | "info" | "ai" | "warn";
  href: string;
}

function ageHint(iso: string | null, now: Date): string {
  if (!iso) return "No reply yet";
  const days = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return "Oldest from today";
  return `Oldest ${days} ${days === 1 ? "day" : "days"}`;
}

function dueHint(input: NeedsYouInput, now: Date, timeZone: string): string {
  if (input.overdueFollowUps > 0) {
    return `${input.overdueFollowUps.toLocaleString("en-US")} past due`;
  }
  if (!input.nextFollowUpDue) return "Nothing due";
  const due = new Date(input.nextFollowUpDue);
  if (!Number.isFinite(due.getTime())) return "Nothing due";
  const sameDay = dayKeyInZone(due, timeZone) === dayKeyInZone(now, timeZone);
  const time = due
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .replace(":00", "")
    .toLowerCase();
  if (sameDay) return `Due ${time}`;
  return `Next due ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}`;
}

export function buildNeedsYou(
  input: NeedsYouInput,
  hrefs: Record<NeedsYouTask["id"], string>,
  now: Date,
  timeZone: string
): NeedsYouTask[] {
  return [
    {
      id: "unhappy",
      count: input.unhappyUnreplied,
      label: "Unhappy, no reply",
      hint: input.unhappyUnreplied > 0 ? ageHint(input.oldestUnhappyAt, now) : "All answered",
      tone: "bad",
      href: hrefs.unhappy,
    },
    {
      id: "follow-ups",
      count: input.followUps,
      label: input.followUps === 1 ? "Call back" : "Call backs",
      hint: input.followUps > 0 ? dueHint(input, now, timeZone) : "None open",
      tone: "info",
      href: hrefs["follow-ups"],
    },
    {
      id: "drafts",
      count: input.drafts,
      label: "Drafts to approve",
      hint: input.drafts > 0 ? "Ready to send" : "None waiting",
      tone: "ai",
      href: hrefs.drafts,
    },
    {
      id: "failed",
      count: input.failed,
      label: "Didn’t reach Google",
      hint: input.failed > 0 ? "Retry needed" : "All published",
      tone: "warn",
      href: hrefs.failed,
    },
  ];
}

export interface TodayLocationInput {
  id: string;
  name: string;
  clientId: string | null;
  reviews: number;
  ratingSum: number;
  previousReviews: number;
  previousRatingSum: number;
  unreplied: number;
}

export interface TodayLocationRow {
  id: string;
  name: string;
  rating: number | null;
  /** 0–1 along the bar scale. */
  width: number;
  change: number | null;
  unreplied: number;
}

export interface TodayLocationGroup {
  clientId: string | null;
  name: string | null;
  rows: TodayLocationRow[];
}

export interface TodayLocationTable {
  groups: TodayLocationGroup[];
  /** Bars start at this rating so small differences show. */
  barFrom: number;
  shown: number;
  total: number;
}

const LOCATION_ROW_LIMIT = 12;

/**
 * Most open reviews first, then lowest rating. When grouped, rows keep that
 * order inside each business and businesses follow their first row.
 */
export function buildLocationTable(
  rows: TodayLocationInput[],
  options: { group: boolean; businessName: (clientId: string | null) => string | null; limit?: number }
): TodayLocationTable {
  const ranked = rows
    .map((row) => {
      const rating = row.reviews > 0 ? row.ratingSum / row.reviews : null;
      const before = row.previousReviews > 0 ? row.previousRatingSum / row.previousReviews : null;
      return {
        input: row,
        rating,
        change: rating !== null && before !== null ? rating - before : null,
      };
    })
    .filter((row) => row.rating !== null || row.input.unreplied > 0)
    .sort(
      (a, b) =>
        b.input.unreplied - a.input.unreplied ||
        (a.rating ?? 6) - (b.rating ?? 6) ||
        a.input.name.localeCompare(b.input.name)
    );
  const shown = ranked.slice(0, options.limit ?? LOCATION_ROW_LIMIT);
  const lowest = Math.min(5, ...shown.map((row) => row.rating ?? 5));
  // Below the lowest rating, so even the lowest row has a visible bar.
  const barFrom = Math.max(1, Math.min(4, Math.ceil(lowest) - 1));
  const toRow = (row: (typeof ranked)[number]): TodayLocationRow => ({
    id: row.input.id,
    name: row.input.name,
    rating: row.rating,
    width: row.rating === null ? 0 : Math.max(0.02, Math.min(1, (row.rating - barFrom) / (5 - barFrom))),
    change: row.change,
    unreplied: row.input.unreplied,
  });
  let groups: TodayLocationGroup[];
  if (options.group) {
    const byClient = new Map<string, TodayLocationGroup>();
    for (const row of shown) {
      const key = row.input.clientId ?? "";
      const group = byClient.get(key) ?? {
        clientId: row.input.clientId,
        name: options.businessName(row.input.clientId) ?? "No business",
        rows: [],
      };
      group.rows.push(toRow(row));
      byClient.set(key, group);
    }
    groups = [...byClient.values()];
  } else {
    groups = [{ clientId: null, name: null, rows: shown.map(toRow) }];
  }
  return { groups, barFrom, shown: shown.length, total: ranked.length };
}

export interface TodayTheme {
  kind: "praise" | "issue";
  label: string;
  count: number;
  href: string;
}

/** Two praise and two complaint topics, topped up from either side when one is short. */
export function buildThemes(praise: OverviewThemeBar[], issues: OverviewThemeBar[], limit = 4): TodayTheme[] {
  const half = Math.ceil(limit / 2);
  const good = praise.filter((row) => row.count > 0);
  const bad = issues.filter((row) => row.count > 0);
  const takeGood = Math.min(good.length, Math.max(half, limit - bad.length));
  const takeBad = Math.min(bad.length, limit - takeGood);
  return [
    ...good.slice(0, takeGood).map((row) => ({ kind: "praise" as const, label: row.label, count: row.count, href: row.href })),
    ...bad.slice(0, takeBad).map((row) => ({ kind: "issue" as const, label: row.label, count: row.count, href: row.href })),
  ];
}

export function greeting(now: Date, timeZone: string, name: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now)
  );
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

export function longDate(now: Date, timeZone: string): string {
  return now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
}

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Top of the bar scale: the busiest day rounded up to a multiple of 5 (at least 5). */
export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  return Math.max(5, Math.ceil(max / 5) * 5);
}
