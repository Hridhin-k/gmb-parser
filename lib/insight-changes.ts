import type { TopicCount } from "@/lib/review-intelligence";
import { insightTopicLabel } from "@/lib/insight-dashboard";

export interface ThemeRow {
  topic: string;
  label: string;
  praise: number;
  complaints: number;
  praiseReviews: number;
  complaintReviews: number;
  /** Mentions in the previous period; null when there is nothing to compare with. */
  praisePrev: number | null;
  complaintsPrev: number | null;
}

/** One row per theme with praise and complaints side by side, most mentioned first. */
export function mergeThemes(
  current: { positive: TopicCount[]; negative: TopicCount[] },
  previous: { positive: TopicCount[]; negative: TopicCount[] } | null
): ThemeRow[] {
  const rows = new Map<string, ThemeRow>();
  const row = (topic: string): ThemeRow => {
    let found = rows.get(topic);
    if (!found) {
      found = {
        topic,
        label: insightTopicLabel(topic),
        praise: 0,
        complaints: 0,
        praiseReviews: 0,
        complaintReviews: 0,
        praisePrev: previous ? 0 : null,
        complaintsPrev: previous ? 0 : null,
      };
      rows.set(topic, found);
    }
    return found;
  };
  for (const entry of current.positive) {
    const r = row(entry.topic);
    r.praise = entry.count;
    r.praiseReviews = entry.reviews;
  }
  for (const entry of current.negative) {
    const r = row(entry.topic);
    r.complaints = entry.count;
    r.complaintReviews = entry.reviews;
  }
  if (previous) {
    for (const entry of previous.positive) row(entry.topic).praisePrev = entry.count;
    for (const entry of previous.negative) row(entry.topic).complaintsPrev = entry.count;
  }
  return [...rows.values()].sort(
    (a, b) => b.praise + b.complaints - (a.praise + a.complaints) || a.topic.localeCompare(b.topic)
  );
}

export interface Change {
  tone: "good" | "bad";
  text: string;
}

const mentions = (n: number) => `${n} ${n === 1 ? "mention" : "mentions"}`;

/**
 * Plain statements about what moved since the previous period, computed from
 * the counts. Small moves are ignored so a one-mention wobble is not news.
 */
export function describeChanges(rows: ThemeRow[], limit = 4): Change[] {
  const changes: Array<Change & { size: number }> = [];
  for (const r of rows) {
    if (r.complaintsPrev !== null) {
      const delta = r.complaints - r.complaintsPrev;
      if (delta >= 2) {
        changes.push({ tone: "bad", size: delta, text: `Complaints about ${r.label} rose from ${mentions(r.complaintsPrev)} to ${r.complaints}.` });
      } else if (delta <= -2) {
        changes.push({ tone: "good", size: -delta, text: `Complaints about ${r.label} fell from ${mentions(r.complaintsPrev)} to ${r.complaints}.` });
      }
    }
    if (r.praisePrev !== null) {
      const delta = r.praise - r.praisePrev;
      if (delta >= 2) {
        changes.push({ tone: "good", size: delta, text: `Praise for ${r.label} rose from ${mentions(r.praisePrev)} to ${r.praise}.` });
      } else if (delta <= -2) {
        changes.push({ tone: "bad", size: -delta, text: `Praise for ${r.label} fell from ${mentions(r.praisePrev)} to ${r.praise}.` });
      }
    }
  }
  return changes
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .map(({ tone, text }) => ({ tone, text }));
}

export interface SpottedChange {
  /** YYYY-MM */
  month: string;
  topic: string;
  tone: "good" | "bad";
  text: string;
}

const MULTIPLE_WORDS: Record<number, string> = { 2: "doubled", 3: "tripled" };

/**
 * Months where a theme's complaints or praise jumped against the month
 * before, for pins on the mood timeline. A jump needs at least `min`
 * mentions and at least twice the previous month, so noise is not news, and
 * the month before must have readings at all.
 * The biggest jumps first, at most one per month.
 */
export function spotMonthlyChanges(
  months: string[],
  rows: Array<{ topic: string; month: string; positive: number; negative: number }>,
  options: { min?: number; limit?: number } = {}
): SpottedChange[] {
  const min = options.min ?? 4;
  const limit = options.limit ?? 3;
  const counts = new Map<string, { positive: number; negative: number }>();
  const topics = new Set<string>();
  const monthTotals = new Map<string, number>();
  for (const row of rows) {
    monthTotals.set(row.month, (monthTotals.get(row.month) ?? 0) + row.positive + row.negative);
    const key = `${row.topic}|${row.month}`;
    const existing = counts.get(key) ?? { positive: 0, negative: 0 };
    counts.set(key, { positive: existing.positive + row.positive, negative: existing.negative + row.negative });
    topics.add(row.topic);
  }
  const found: Array<SpottedChange & { size: number }> = [];
  for (let i = 1; i < months.length; i++) {
    // The first month with any readings is where the data starts, not a jump.
    if (!monthTotals.get(months[i - 1])) continue;
    for (const topic of topics) {
      const now = counts.get(`${topic}|${months[i]}`);
      if (!now) continue;
      const before = counts.get(`${topic}|${months[i - 1]}`) ?? { positive: 0, negative: 0 };
      const label = insightTopicLabel(topic);
      const jump = (current: number, previous: number) =>
        current >= min && current >= previous * 2 && current - previous >= 2 ? current / Math.max(1, previous) : 0;
      const complaintJump = jump(now.negative, before.negative);
      if (complaintJump > 0) {
        const times = Math.floor(complaintJump);
        const verb = before.negative > 0 && MULTIPLE_WORDS[times] ? MULTIPLE_WORDS[times] : `rose to ${now.negative}`;
        found.push({
          month: months[i],
          topic,
          tone: "bad",
          size: now.negative - before.negative,
          text: `Complaints about ${label} ${verb}${before.negative > 0 && MULTIPLE_WORDS[times] ? ` (${before.negative} to ${now.negative})` : ""}`,
        });
      }
      const praiseJump = jump(now.positive, before.positive);
      if (praiseJump > 0) {
        found.push({
          month: months[i],
          topic,
          tone: "good",
          size: now.positive - before.positive,
          text: `Praise for ${label} rose from ${before.positive} to ${now.positive}`,
        });
      }
    }
  }
  const perMonth = new Map<string, SpottedChange & { size: number }>();
  for (const change of found.sort((a, b) => b.size - a.size || a.topic.localeCompare(b.topic))) {
    if (!perMonth.has(change.month)) perMonth.set(change.month, change);
  }
  return [...perMonth.values()]
    .sort((a, b) => b.size - a.size)
    .slice(0, limit)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ month, topic, tone, text }) => ({ month, topic, tone, text }));
}
