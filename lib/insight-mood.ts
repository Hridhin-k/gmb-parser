import { insightTopicLabel } from "@/lib/insight-dashboard";

/**
 * Customer mood for the insights page: the share of praise among praise and
 * complaint mentions, by calendar month, overall and per topic. Pure: the
 * counts come from `lib/services/insight-mood.ts`.
 */

/** A month needs this many praise + complaint mentions before its share is shown. */
export const MIN_MONTH_MENTIONS = 3;
/** A topic or location cell needs this many mentions before it is scored. */
export const MIN_CELL_MENTIONS = 3;
/** Change in points (late vs early) that counts as getting better or worse. */
export const TREND_POINTS = 6;

export interface MoodMonthCounts {
  month: string;
  positive: number;
  negative: number;
}

export interface ReviewMonthCounts {
  month: string;
  reviews: number;
  /** Average star rating of that month's reviews; null when there are none. */
  rating: number | null;
}

export interface TopicMonthCounts {
  topic: string;
  month: string;
  positive: number;
  negative: number;
}

export interface MoodPoint {
  /** YYYY-MM */
  month: string;
  /** "Mar" */
  label: string;
  /** "March 2026" */
  fullLabel: string;
  /** 0–100, or null when the month has too few mentions. */
  happy: number | null;
  /** The same calendar month a year earlier. */
  lastYear: number | null;
  positive: number;
  negative: number;
  reviews: number;
  rating: number | null;
  /** First and last day (YYYY-MM-DD), for links to that month's reviews. */
  from: string;
  to: string;
}

export type TrendStatus = "worse" | "better" | "steady";

export interface TopicTrend {
  topic: string;
  label: string;
  /** Happy share per month, aligned with the mood series. */
  series: Array<number | null>;
  mentions: number;
  /** Latest month with enough mentions. */
  now: number | null;
  /** Share over the first half of the months. */
  early: number | null;
  /** Share over the last three months. */
  late: number | null;
  delta: number | null;
  status: TrendStatus;
}

export interface MonthDriver {
  topic: string;
  label: string;
  direction: "up" | "down";
  /** Points of change in that topic's share against the month before. */
  points: number;
  text: string;
}

const MONTH = /^\d{4}-\d{2}$/;

function parseMonth(month: string): { year: number; index: number } {
  return { year: Number(month.slice(0, 4)), index: Number(month.slice(5, 7)) - 1 };
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const { year, index } = parseMonth(month);
  return monthKey(new Date(Date.UTC(year, index + by, 1)));
}

export function monthBounds(month: string): { from: string; to: string } {
  const { year, index } = parseMonth(month);
  const from = new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function monthShortLabel(month: string): string {
  const { year, index } = parseMonth(month);
  return new Date(Date.UTC(year, index, 2)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

export function monthFullLabel(month: string): string {
  const { year, index } = parseMonth(month);
  return new Date(Date.UTC(year, index, 2)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Calendar months the mood chart shows for a period. A partial first month is
 * dropped when there are more than three, so "Last 12 months" reads as twelve
 * whole months ending with the current one. Open-ended ranges stop at `now`.
 */
export function chartMonths(start: Date | null, end: Date | null, now: Date = new Date(), allTimeMonths = 24): string[] {
  // `end` is exclusive.
  const last = monthKey(new Date((end ?? now).getTime() - 1));
  const first = start ? monthKey(start) : shiftMonth(last, -(allTimeMonths - 1));
  if (first > last) return [last];
  const months: string[] = [];
  for (let m = first; m <= last && months.length < 120; m = shiftMonth(m, 1)) months.push(m);
  if (start && start.getUTCDate() !== 1 && months.length > 3) months.shift();
  return months;
}

/** Rounded share of praise, or null when there are too few mentions to say. */
export function happyShare(positive: number, negative: number, min = MIN_MONTH_MENTIONS): number | null {
  const total = positive + negative;
  if (total <= 0 || total < min) return null;
  return Math.round((positive / total) * 100);
}

export function buildMoodSeries(
  months: string[],
  mood: MoodMonthCounts[],
  reviews: ReviewMonthCounts[]
): MoodPoint[] {
  const byMonth = new Map(mood.filter((row) => MONTH.test(row.month)).map((row) => [row.month, row]));
  const reviewsByMonth = new Map(reviews.map((row) => [row.month, row]));
  return months.map((month) => {
    const row = byMonth.get(month);
    const prior = byMonth.get(shiftMonth(month, -12));
    const review = reviewsByMonth.get(month);
    const positive = row?.positive ?? 0;
    const negative = row?.negative ?? 0;
    return {
      month,
      label: monthShortLabel(month),
      fullLabel: monthFullLabel(month),
      happy: happyShare(positive, negative),
      lastYear: prior ? happyShare(prior.positive, prior.negative) : null,
      positive,
      negative,
      reviews: review?.reviews ?? 0,
      rating: review?.rating ?? null,
      ...monthBounds(month),
    };
  });
}

function windowShare(rows: Array<{ positive: number; negative: number } | undefined>): number | null {
  let positive = 0;
  let negative = 0;
  for (const row of rows) {
    positive += row?.positive ?? 0;
    negative += row?.negative ?? 0;
  }
  return happyShare(positive, negative, MIN_CELL_MENTIONS);
}

export function trendStatus(delta: number | null): TrendStatus {
  if (delta === null) return "steady";
  if (delta <= -TREND_POINTS) return "worse";
  if (delta >= TREND_POINTS) return "better";
  return "steady";
}

/**
 * One trend per topic over the chart months, most mentioned topics only,
 * sorted by the size of the change (late three months against the first half).
 */
export function buildTopicTrends(
  months: string[],
  rows: TopicMonthCounts[],
  options: { limit?: number; minMentions?: number } = {}
): TopicTrend[] {
  const limit = options.limit ?? 6;
  const minMentions = options.minMentions ?? 5;
  const inChart = new Set(months);
  const byTopic = new Map<string, Map<string, TopicMonthCounts>>();
  for (const row of rows) {
    if (!inChart.has(row.month) || !row.topic) continue;
    const topic = byTopic.get(row.topic) ?? new Map<string, TopicMonthCounts>();
    const existing = topic.get(row.month);
    topic.set(
      row.month,
      existing
        ? { ...existing, positive: existing.positive + row.positive, negative: existing.negative + row.negative }
        : row
    );
    byTopic.set(row.topic, topic);
  }
  const half = Math.max(1, Math.floor(months.length / 2));
  const lateStart = Math.max(half, months.length - 3);
  const trends: TopicTrend[] = [];
  for (const [topic, byMonth] of byTopic) {
    let mentions = 0;
    for (const row of byMonth.values()) mentions += row.positive + row.negative;
    if (mentions < minMentions) continue;
    const series = months.map((month) => {
      const row = byMonth.get(month);
      return row ? happyShare(row.positive, row.negative, 1) : null;
    });
    const early = months.length >= 2 ? windowShare(months.slice(0, half).map((m) => byMonth.get(m))) : null;
    const late = months.length >= 2 ? windowShare(months.slice(lateStart).map((m) => byMonth.get(m))) : null;
    const delta = early !== null && late !== null ? late - early : null;
    let now: number | null = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] !== null) {
        now = series[i];
        break;
      }
    }
    trends.push({ topic, label: insightTopicLabel(topic), series, mentions, now, early, late, delta, status: trendStatus(delta) });
  }
  return trends
    .sort((a, b) => b.mentions - a.mentions || a.topic.localeCompare(b.topic))
    .slice(0, limit)
    .sort((a, b) => Math.abs(b.delta ?? -1) - Math.abs(a.delta ?? -1) || b.mentions - a.mentions);
}

/**
 * The topics whose share moved most in one month against the month before.
 * Each topic needs mentions in both months, so a single review does not
 * become "what moved it".
 */
export function monthDrivers(
  months: string[],
  rows: TopicMonthCounts[],
  index: number,
  limit = 2
): MonthDriver[] {
  const month = months[index];
  const previous = index > 0 ? months[index - 1] : null;
  if (!month || !previous) return [];
  const current = new Map<string, TopicMonthCounts>();
  const before = new Map<string, TopicMonthCounts>();
  for (const row of rows) {
    if (row.month === month) current.set(row.topic, row);
    else if (row.month === previous) before.set(row.topic, row);
  }
  const drivers: Array<MonthDriver & { weight: number }> = [];
  for (const [topic, now] of current) {
    const then = before.get(topic);
    if (!then) continue;
    const a = happyShare(now.positive, now.negative, 2);
    const b = happyShare(then.positive, then.negative, 2);
    if (a === null || b === null || a === b) continue;
    const points = a - b;
    const label = insightTopicLabel(topic);
    const complaintsNow = now.negative;
    const complaintsThen = then.negative;
    const text =
      points < 0 && complaintsNow > complaintsThen
        ? `complaints up from ${complaintsThen} to ${complaintsNow}`
        : points > 0 && complaintsNow < complaintsThen
          ? `complaints down from ${complaintsThen} to ${complaintsNow}`
          : `${points > 0 ? "up" : "down"} ${Math.abs(points)} pts to ${a}% happy`;
    drivers.push({
      topic,
      label,
      direction: points > 0 ? "up" : "down",
      points,
      text,
      weight: Math.abs(points) * Math.min(1, (now.positive + now.negative) / 5),
    });
  }
  return drivers
    .sort((x, y) => y.weight - x.weight || x.topic.localeCompare(y.topic))
    .slice(0, limit)
    .map(({ topic, label, direction, points, text }) => ({ topic, label, direction, points, text }));
}

export function signedPoints(value: number): string {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

/* ---------------- Topics tab ---------------- */

export interface DivergingRow {
  topic: string;
  label: string;
  praise: number;
  complaints: number;
  /** 0–100, share of the widest side across all rows. */
  praiseWidth: number;
  complaintWidth: number;
}

export function divergingRows(
  rows: Array<{ topic: string; label: string; praise: number; complaints: number }>,
  limit = 10
): DivergingRow[] {
  const top = rows.filter((row) => row.praise + row.complaints > 0).slice(0, limit);
  const max = Math.max(1, ...top.map((row) => Math.max(row.praise, row.complaints)));
  return top.map((row) => ({
    ...row,
    praiseWidth: Math.round((row.praise / max) * 100),
    complaintWidth: Math.round((row.complaints / max) * 100),
  }));
}

/* ---------------- Locations tab ---------------- */

export interface LocationTopicCounts {
  locationId: string;
  topic: string;
  positive: number;
  negative: number;
}

/** −2 … +2 on the five-step diverging scale. */
export type HeatStep = -2 | -1 | 0 | 1 | 2;

export interface HeatCell {
  topic: string;
  /** −100 to +100: (praise − complaints) ÷ mentions. Null when too few mentions. */
  score: number | null;
  step: HeatStep | null;
  mentions: number;
}

export interface HeatRow {
  locationId: string;
  cells: HeatCell[];
  mentions: number;
}

export function heatScore(positive: number, negative: number, min = MIN_CELL_MENTIONS): number | null {
  const total = positive + negative;
  if (total < Math.max(1, min)) return null;
  return Math.round(((positive - negative) / total) * 100);
}

export function heatStep(score: number | null): HeatStep | null {
  if (score === null) return null;
  if (score <= -50) return -2;
  if (score <= -15) return -1;
  if (score < 15) return 0;
  if (score < 50) return 1;
  return 2;
}

/** Locations × the most mentioned topics, busiest locations first. */
export function locationHeatmap(
  rows: LocationTopicCounts[],
  options: { topics?: number; locations?: number } = {}
): { topics: Array<{ topic: string; label: string }>; rows: HeatRow[] } {
  const topicTotals = new Map<string, number>();
  const locationTotals = new Map<string, number>();
  const cells = new Map<string, LocationTopicCounts>();
  for (const row of rows) {
    const mentions = row.positive + row.negative;
    if (mentions <= 0) continue;
    topicTotals.set(row.topic, (topicTotals.get(row.topic) ?? 0) + mentions);
    locationTotals.set(row.locationId, (locationTotals.get(row.locationId) ?? 0) + mentions);
    cells.set(`${row.locationId}|${row.topic}`, row);
  }
  const topics = [...topicTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.topics ?? 6)
    .map(([topic]) => ({ topic, label: insightTopicLabel(topic) }));
  const locations = [...locationTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.locations ?? 25);
  return {
    topics,
    rows: locations.map(([locationId, mentions]) => ({
      locationId,
      mentions,
      cells: topics.map(({ topic }) => {
        const cell = cells.get(`${locationId}|${topic}`);
        const score = cell ? heatScore(cell.positive, cell.negative) : null;
        return { topic, score, step: heatStep(score), mentions: cell ? cell.positive + cell.negative : 0 };
      }),
    })),
  };
}

/**
 * A quote for each chart month that matches which way the mood went: a
 * complaint when it fell against the month before, praise otherwise.
 */
export function monthQuotes(
  points: Array<{ month: string; happy: number | null }>,
  quotes: Array<{ month: string; sentiment: "positive" | "negative"; excerpt: string }>
): Array<string | null> {
  const byMonth = new Map<string, { positive?: string; negative?: string }>();
  for (const quote of quotes) {
    const entry = byMonth.get(quote.month) ?? {};
    entry[quote.sentiment] ??= quote.excerpt;
    byMonth.set(quote.month, entry);
  }
  return points.map((point, index) => {
    const entry = byMonth.get(point.month);
    if (!entry) return null;
    const before = index > 0 ? points[index - 1].happy : null;
    const fell = point.happy !== null && before !== null && point.happy < before;
    return (fell ? entry.negative ?? entry.positive : entry.positive ?? entry.negative) ?? null;
  });
}

/**
 * One plain sentence under the heatmap: the most negative scored cell, set
 * against the same topic at the other locations. Null when nothing stands out.
 */
export function heatmapNote(
  heat: { topics: Array<{ topic: string; label: string }>; rows: HeatRow[] },
  names: Map<string, string>
): string | null {
  let worst: { row: HeatRow; cell: HeatCell } | null = null;
  for (const row of heat.rows) {
    for (const cell of row.cells) {
      if (cell.score !== null && cell.score <= -15 && (!worst || cell.score < (worst.cell.score as number))) worst = { row, cell };
    }
  }
  if (!worst) return null;
  const { row, cell } = worst;
  const label = heat.topics.find((topic) => topic.topic === cell.topic)?.label ?? insightTopicLabel(cell.topic);
  const name = names.get(row.locationId) ?? "One location";
  const others = heat.rows
    .filter((other) => other.locationId !== row.locationId)
    .map((other) => other.cells.find((c) => c.topic === cell.topic)?.score ?? null)
    .filter((score): score is number => score !== null);
  const score = `−${Math.abs(cell.score as number)}`;
  if (others.length === 0) return `${label} is the weakest topic at ${name} (${score}).`;
  const negativeElsewhere = others.filter((other) => other < 0).length;
  const average = Math.round(others.reduce((sum, other) => sum + other, 0) / others.length);
  if (negativeElsewhere === 0) {
    return `${name} is the only location where ${label.toLowerCase()} is negative (${score}). Elsewhere it averages ${average > 0 ? "+" : ""}${average}.`;
  }
  return `${label} is lowest at ${name} (${score}), against an average of ${average > 0 ? "+" : average < 0 ? "−" : ""}${Math.abs(average)} at the other locations.`;
}
