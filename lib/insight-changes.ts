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
