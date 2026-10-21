import { parseDateRange, type DateRange } from "@/lib/date-range";
import { buildInsights, reviewWindow, type DashboardFacts, type StarCounts } from "@/lib/metrics";
import { sumStarCounts } from "@/lib/star-breakdown";
import { themeLabel } from "@/lib/review-inbox";

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MobileRangeKey = "7d" | "30d";

export function mobileRangeKey(value: unknown): MobileRangeKey {
  return value === "7d" ? "7d" : "30d";
}

/** 7 days is a rolling UTC window. 30 days uses the same month preset as the desktop dashboard. */
export function mobileDateRange(key: MobileRangeKey, now: Date = new Date()): DateRange {
  if (key === "30d") {
    const range = parseDateRange({ range: "1m" }, "1m", now);
    return { ...range, label: "30 days" };
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return {
    key: "custom",
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
    start,
    end,
    label: "7 days",
  };
}

export function skippedIds(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id)) seen.add(id);
    if (seen.size >= 40) break;
  }
  return [...seen];
}

export function oneId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

export function slaRemaining(dueAt: string, now: Date = new Date()): { label: string; overdue: boolean } {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return { label: "No due time is stored", overdue: false };
  const ms = due - now.getTime();
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return { overdue, label: overdue ? `${days} days past the due time` : `${days} days left` };
  }
  if (hours >= 1) {
    return {
      overdue,
      label: overdue ? `${hours}h ${minutes}m past the due time` : `${hours}h ${minutes}m left`,
    };
  }
  return { overdue, label: overdue ? `${Math.max(minutes, 1)}m past the due time` : `${minutes}m left` };
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((now.getTime() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ratingDeltaLabel(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return "Same as the previous period";
  return diff > 0
    ? `${diff.toFixed(2)} higher than the previous period`
    : `${Math.abs(diff).toFixed(2)} lower than the previous period`;
}

export function countDeltaLabel(current: number, previous: number | null): string | null {
  if (previous === null || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return "Same number as the previous period";
  return pct > 0 ? `${pct}% more than the previous period` : `${Math.abs(pct)}% fewer than the previous period`;
}

/** One paragraph from the stored 7-day aggregates. It does not invent a cause. */
export function weekBrief(input: {
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  scopeLabel: string;
}): string {
  return buildInsights({
    periodLabel: "Last 7 days",
    scopeLabel: input.scopeLabel,
    facts: input.facts,
    previous: input.previous,
    lowestLocation: null,
  }).join(" ");
}

export function themeBars(facts: DashboardFacts): Array<{ id: string; label: string; count: number; width: number; stars?: StarCounts }> {
  const totals = new Map<string, number>();
  const starRows = new Map<string, Array<StarCounts | undefined>>();
  for (const row of facts.themeMonths) {
    if (!row.theme || row.count <= 0) continue;
    totals.set(row.theme, (totals.get(row.theme) ?? 0) + row.count);
    const list = starRows.get(row.theme) ?? [];
    list.push(row.stars);
    starRows.set(row.theme, list);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = ranked[0]?.[1] ?? 0;
  return ranked.map(([id, count]) => ({
    id,
    label: themeLabel(id) ?? id,
    count,
    width: max > 0 ? Math.max(8, Math.round((count / max) * 100)) : 0,
    stars: sumStarCounts(starRows.get(id) ?? []),
  }));
}

export function replyRateLabel(facts: DashboardFacts): {
  rate: string;
  detail: string;
} {
  const current = reviewWindow(facts);
  if (facts.reviews === 0 || current.replyRate === null) {
    return { rate: "—", detail: "No reviews in this period." };
  }
  return {
    rate: `${Math.round(current.replyRate * 100)}%`,
    detail: `${facts.unreplied.toLocaleString("en-US")} without a reply`,
  };
}

export function mobileHref(path: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
