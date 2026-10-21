import { themeLabel } from "@/lib/review-inbox";
import { dateRangeParams, type DateRange } from "@/lib/date-range";

/** Share of a count. Null when the denominator is zero. */
export function share(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return part / whole;
}

/** Average of a sum. Null when nothing was counted. */
export function average(sum: number, count: number): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return sum / count;
}

/** Counts of 1★, 2★, 3★, 4★, and 5★ reviews, in that order. */
export type StarCounts = [number, number, number, number, number];

export const EMPTY_STARS: StarCounts = [0, 0, 0, 0, 0];

export function addStarCounts(left: StarCounts, right: StarCounts): StarCounts {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2], left[3] + right[3], left[4] + right[4]];
}

export interface DashboardFacts {
  reviews: number;
  ratingSum: number;
  /** 1–2 star reviews. */
  negative: number;
  /** 1–3 star reviews. This is the negative share used on the dashboard. */
  oneToThree: number;
  positive: number;
  replied: number;
  unreplied: number;
  drafts: number;
  failed: number;
  responseHoursSum: number;
  responseCount: number;
  stars: [number, number, number, number, number];
  buckets: { under1h: number; under24h: number; under3d: number; later: number };
  openEscalations: number;
  overdueEscalations: number;
  pendingNow: number;
  months: Array<{
    month: string;
    reviews: number;
    ratingSum: number;
    positive: number;
    oneToThree: number;
    negative: number;
    replied: number;
    stars?: StarCounts;
  }>;
  locations: Array<{
    locationId: string;
    reviews: number;
    ratingSum: number;
    oneToThree: number;
    replied: number;
    unreplied: number;
    drafts: number;
    responseHoursSum: number;
    responseCount: number;
    stars?: StarCounts;
  }>;
  themeMonths: Array<{ month: string; theme: string; count: number; stars?: StarCounts }>;
  groups: Array<{
    groupId: string | null;
    reviews: number;
    ratingSum: number;
    oneToThree: number;
    replied: number;
    stars?: StarCounts;
  }>;
  themeGroups: Array<{ groupId: string | null; theme: string; count: number; stars?: StarCounts }>;
  team: Array<{
    userId: string;
    assignedReviews: number;
    openEscalations: number;
    resolvedEscalations: number;
  }>;
}

export const EMPTY_FACTS: DashboardFacts = {
  reviews: 0,
  ratingSum: 0,
  negative: 0,
  oneToThree: 0,
  positive: 0,
  replied: 0,
  unreplied: 0,
  drafts: 0,
  failed: 0,
  responseHoursSum: 0,
  responseCount: 0,
  stars: [0, 0, 0, 0, 0],
  buckets: { under1h: 0, under24h: 0, under3d: 0, later: 0 },
  openEscalations: 0,
  overdueEscalations: 0,
  pendingNow: 0,
  months: [],
  locations: [],
  themeMonths: [],
  groups: [],
  themeGroups: [],
  team: [],
};

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function starCounts(row: Record<string, unknown>): StarCounts | undefined {
  if (!("r1" in row) && !("r2" in row) && !("r3" in row) && !("r4" in row) && !("r5" in row)) return undefined;
  return [num(row.r1), num(row.r2), num(row.r3), num(row.r4), num(row.r5)];
}

export function parseDashboardFacts(value: unknown): DashboardFacts {
  if (!value || typeof value !== "object") return EMPTY_FACTS;
  const row = value as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(row[key]) ? row[key] : []);
  return {
    reviews: num(row.reviews),
    ratingSum: num(row.rating_sum),
    negative: num(row.negative),
    oneToThree: num(row.one_to_three),
    positive: num(row.positive),
    replied: num(row.replied),
    unreplied: num(row.unreplied),
    drafts: num(row.drafts),
    failed: num(row.failed),
    responseHoursSum: num(row.response_hours_sum),
    responseCount: num(row.response_count),
    stars: [num(row.r1), num(row.r2), num(row.r3), num(row.r4), num(row.r5)],
    buckets: {
      under1h: num(row.under_1h),
      under24h: num(row.under_24h),
      under3d: num(row.under_3d),
      later: num(row.later),
    },
    openEscalations: num(row.open_escalations),
    overdueEscalations: num(row.overdue_escalations),
    pendingNow: num(row.pending_now),
    months: list("months").map((item) => {
      const month = item as Record<string, unknown>;
      return {
        month: text(month.month).slice(0, 10),
        reviews: num(month.reviews),
        ratingSum: num(month.rating_sum),
        positive: num(month.positive),
        oneToThree: num(month.one_to_three),
        negative: num(month.negative),
        replied: num(month.replied),
        stars: starCounts(month),
      };
    }),
    locations: list("locations").map((item) => {
      const location = item as Record<string, unknown>;
      return {
        locationId: text(location.location_id),
        reviews: num(location.reviews),
        ratingSum: num(location.rating_sum),
        oneToThree: num(location.one_to_three),
        replied: num(location.replied),
        unreplied: num(location.unreplied),
        drafts: num(location.drafts),
        responseHoursSum: num(location.response_hours_sum),
        responseCount: num(location.response_count),
        stars: starCounts(location),
      };
    }),
    themeMonths: list("theme_months").map((item) => {
      const theme = item as Record<string, unknown>;
      return {
        month: text(theme.month).slice(0, 10),
        theme: text(theme.theme),
        count: num(theme.count),
        stars: starCounts(theme),
      };
    }),
    groups: list("groups").map((item) => {
      const group = item as Record<string, unknown>;
      return {
        groupId: typeof group.group_id === "string" ? group.group_id : null,
        reviews: num(group.reviews),
        ratingSum: num(group.rating_sum),
        oneToThree: num(group.one_to_three),
        replied: num(group.replied),
        stars: starCounts(group),
      };
    }),
    themeGroups: list("theme_groups").map((item) => {
      const theme = item as Record<string, unknown>;
      return {
        groupId: typeof theme.group_id === "string" ? theme.group_id : null,
        theme: text(theme.theme),
        count: num(theme.count),
        stars: starCounts(theme),
      };
    }),
    team: list("team").map((item) => {
      const member = item as Record<string, unknown>;
      return {
        userId: text(member.user_id),
        assignedReviews: num(member.assigned_reviews),
        openEscalations: num(member.open_escalations),
        resolvedEscalations: num(member.resolved_escalations),
      };
    }),
  };
}

export function reviewWindow(facts: DashboardFacts): {
  avgRating: number | null;
  negativeShare: number | null;
  replyRate: number | null;
  avgResponseHours: number | null;
} {
  return {
    avgRating: average(facts.ratingSum, facts.reviews),
    negativeShare: share(facts.oneToThree, facts.reviews),
    replyRate: share(facts.replied, facts.reviews),
    avgResponseHours: average(facts.responseHoursSum, facts.responseCount),
  };
}

export interface InsightInput {
  periodLabel: string;
  scopeLabel: string;
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  lowestLocation: { name: string; rating: number; reviews: number } | null;
}

/** Sentences that restate the aggregates. They do not propose a cause. */
export function buildInsights(input: InsightInput): string[] {
  const current = reviewWindow(input.facts);
  const lines = [`${input.periodLabel} · ${input.scopeLabel}.`];
  if (input.facts.reviews === 0) {
    lines.push("No reviews in this period.");
    return lines;
  }
  lines.push(
    `${input.facts.reviews.toLocaleString("en-US")} reviews, average ${current.avgRating?.toFixed(2) ?? "—"}.`
  );
  if (current.negativeShare !== null) {
    lines.push(
      input.facts.oneToThree === 0
        ? "None are 1–3 stars."
        : `${input.facts.oneToThree.toLocaleString("en-US")} of them are 1–3 stars (${Math.round(current.negativeShare * 100)}%).`
    );
  }
  if (current.replyRate !== null) {
    lines.push(`Reply rate is ${Math.round(current.replyRate * 100)}%.`);
  }
  if (input.previous && input.previous.reviews > 0 && current.avgRating !== null) {
    const before = reviewWindow(input.previous);
    if (before.avgRating !== null) {
      const diff = current.avgRating - before.avgRating;
      lines.push(
        `The previous period had ${input.previous.reviews.toLocaleString("en-US")} reviews and an average of ${before.avgRating.toFixed(2)}. The average is ${diff === 0 ? "unchanged" : diff > 0 ? `${diff.toFixed(2)} higher` : `${Math.abs(diff).toFixed(2)} lower`}.`
      );
    }
  }
  const themes = new Map<string, number>();
  for (const row of input.facts.themeMonths) themes.set(row.theme, (themes.get(row.theme) ?? 0) + row.count);
  const top = [...themes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) {
    lines.push(
      `${themeLabel(top[0]) ?? top[0]} is the most common 1–3 star theme, on ${top[1].toLocaleString("en-US")} reviews.`
    );
  }
  if (input.lowestLocation) {
    lines.push(
      `${input.lowestLocation.name} has the lowest average in this scope, ${input.lowestLocation.rating.toFixed(2)} from ${input.lowestLocation.reviews.toLocaleString("en-US")} reviews.`
    );
  }
  return lines;
}

export function reviewDrillHref(
  range: DateRange,
  scope: { clientId?: string | null; groupId?: string | null; locationId?: string | null },
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: scope.clientId ?? "",
    group: scope.groupId ?? "",
    location: scope.locationId ?? "",
    ...dateRangeParams(range, "all"),
    ...extra,
  })) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/reviews?${qs}` : "/reviews";
}

export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
  if (!year || !monthNumber) return { from: "", to: "" };
  const last = new Date(Date.UTC(year, monthNumber, 0));
  const from = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const to = last.toISOString().slice(0, 10);
  return { from, to };
}

export interface AttentionInput {
  facts: DashboardFacts;
  expiredConnections: number;
  revokedConnections: number;
  heldLocations: number;
  inactiveLocations: number;
  href: (extra?: Record<string, string>) => string;
  escalationHref: string;
}

/** Live problems inside the selected brand, group, and location. Counts follow the date window except connection state. */
export function buildAttention(input: AttentionInput): Array<{ id: string; title: string; detail: string; href: string }> {
  const items: Array<{ id: string; title: string; detail: string; href: string }> = [];
  if (input.facts.overdueEscalations > 0) {
    items.push({
      id: "overdue",
      title: `${input.facts.overdueEscalations.toLocaleString("en-US")} overdue escalations`,
      detail: "Opened in this period and past the due time",
      href: input.escalationHref,
    });
  }
  if (input.facts.drafts > 0) {
    items.push({
      id: "drafts",
      title: `${input.facts.drafts.toLocaleString("en-US")} ${input.facts.drafts === 1 ? "draft is" : "drafts are"} awaiting approval`,
      detail: "Reviews in this period whose reply is still a draft",
      href: input.href({ filter: "draft" }),
    });
  }
  if (input.facts.unreplied > 0) {
    items.push({
      id: "unreplied",
      title: `${input.facts.unreplied.toLocaleString("en-US")} ${input.facts.unreplied === 1 ? "review has" : "reviews have"} no reply`,
      detail: "Reviews in this period with no Google reply",
      href: input.href({ filter: "unanswered" }),
    });
  }
  if (input.facts.failed > 0) {
    items.push({
      id: "failed",
      title: `${input.facts.failed.toLocaleString("en-US")} replies failed to publish`,
      detail: "Reviews in this period",
      href: input.href({ filter: "failed" }),
    });
  }
  if (input.expiredConnections + input.revokedConnections > 0) {
    items.push({
      id: "connections",
      title: `${(input.expiredConnections + input.revokedConnections).toLocaleString("en-US")} Google connections need attention`,
      detail: "Expired or revoked workspace connections. This does not follow the date range.",
      href: "/settings",
    });
  }
  if (input.heldLocations > 0) {
    items.push({
      id: "held",
      title: `${input.heldLocations.toLocaleString("en-US")} locations are held back`,
      detail: "Duplicate or unverified profiles in this scope",
      href: "/clients",
    });
  }
  if (input.inactiveLocations > 0) {
    items.push({
      id: "inactive",
      title: `${input.inactiveLocations.toLocaleString("en-US")} locations are paused`,
      detail: "Inactive locations in this scope",
      href: "/clients",
    });
  }
  return items;
}
