import { formatHours } from "@/lib/analytics-metrics";
import { insightTopicInboxExtra, insightTopicLabel } from "@/lib/insight-dashboard";
import { average, reviewWindow, type DashboardFacts } from "@/lib/metrics";

/**
 * Overview numbers for one scope and one date window.
 *
 * Average rating is the sum of star ratings divided by the number of reviews.
 * It is never the average of location averages.
 * 1–3 star share is reviews of 1–3 stars divided by all reviews in the window.
 * The month chart keeps 3 stars separate: 4–5 positive, 3 neutral, 1–2 negative.
 * Main complaint is the outlet's most common negative insight topic.
 * Reply rate is reviews with a Google reply divided by all reviews in the window.
 * A location is ranked only by its own average rating. Ties go to the location
 * with more reviews, then by name. Locations with no reviews in the window are left out.
 *
 * When the selected range is All time (or any other window), KPI totals and the
 * month chart both use every month bucket returned for that scope. Chart props
 * stay lean (no per-month star arrays) so long histories do not bloat HTML.
 */

export interface BoardPlace {
  id: string;
  name: string;
  clientId: string | null;
  groupName: string | null;
}

/** The negative insight topic with the most mentions at one outlet. */
export interface BoardComplaint {
  locationId: string;
  topic: string;
  count: number;
}

export interface BoardTopic {
  topic: string;
  count: number;
  reviews: number;
}

export interface BoardLinks {
  reviews: (extra?: Record<string, string>) => string;
  escalations: (extra?: Record<string, string>) => string;
  location: (place: BoardPlace) => string;
  analytics: string;
  insights: string;
  reports: string;
  settings: string;
}

export interface OverviewKpis {
  avgRating: number | null;
  previousAvgRating: number | null;
  reviews: number;
  previousReviews: number | null;
  negativeShare: number | null;
  previousNegativeShare: number | null;
  replyRate: number | null;
  previousReplyRate: number | null;
  /** Mean hours among reviews that have a Google reply timestamp. Null when none do. */
  avgResponseHours: number | null;
  previousAvgResponseHours: number | null;
  unreplied: number;
  openEscalations: number;
  overdueEscalations: number;
}

export interface OverviewStoreRow {
  id: string;
  name: string;
  groupName: string | null;
  rating: number;
  reviews: number;
  negativeShare: number;
  replyRate: number;
  ratingChange: number | null;
  complaint: string | null;
  rank: number;
  rankedCount: number;
  href: string;
  reviewsHref: string;
  negativeHref: string;
  /** Inbox filtered to this outlet’s unanswered reviews. */
  unansweredHref: string;
}

export interface OverviewMonthBar {
  key: string;
  label: string;
  /** 4–5 star reviews. */
  positive: number;
  /** 3 star reviews. */
  neutral: number;
  /** 1–2 star reviews. */
  negative: number;
  avgRating: number | null;
  href: string;
}

export interface OverviewAttentionRow {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface OverviewThemeBar {
  label: string;
  /** Negative observation mentions. */
  count: number;
  /** Distinct analysed reviews that mentioned the topic. */
  reviews: number;
  href: string;
}

export interface OverviewCoverage {
  analysed: number;
  ratingOnly: number;
}

/** Praise and complaint mentions for one topic, from analysed review text. */
export interface OverviewThemeMix {
  label: string;
  positive: number;
  negative: number;
  total: number;
  /** Share of every theme mention in the period, including topics not shown. */
  share: number;
}

export interface OverviewSentiment {
  positive: number;
  negative: number;
}

export interface OverviewStaffMention {
  name: string;
  count: number;
}

export interface OverviewSevereGlance {
  count: number;
  excerpt: string | null;
  stars: number | null;
}

export interface OverviewInsightGlance {
  kind: "concern" | "strength" | "action";
  label: string;
  title: string;
  detail: string;
  supportingReviews: number;
  excerpt: string | null;
  severity: number | null;
}

/** Written cards from the saved AI report for this scope and period. */
export interface OverviewReportGlance {
  status: "completed" | "partial";
  finishedAt: string | null;
  cards: OverviewInsightGlance[];
}

export interface OverviewStarRow {
  stars: number;
  count: number;
  href: string;
}

export interface OverviewBoard {
  kpis: OverviewKpis;
  /** Two or three sentences that restate this period. They do not invent a cause. */
  brief: string[];
  periodLabel: string;
  worst: OverviewStoreRow | null;
  months: OverviewMonthBar[];
  trendCaption: string | null;
  attention: OverviewAttentionRow[];
  lowest: OverviewStoreRow[];
  rankedCount: number;
  /** Complaint mentions, largest first. Same counts as Analytics → Complaint themes. */
  themes: OverviewThemeBar[];
  /** Praise mentions, largest first. Ranked separately from complaints. */
  praiseThemes: OverviewThemeBar[];
  themeMix: OverviewThemeMix[];
  sentiment: OverviewSentiment;
  staff: OverviewStaffMention[];
  severe: OverviewSevereGlance;
  report: OverviewReportGlance | null;
  /** Praise and complaint cards counted from analysed text, used when no written report is saved. */
  analysis: OverviewInsightGlance[];
  coverage: OverviewCoverage;
  starMix: OverviewStarRow[];
  analyticsHref: string;
  insightsHref: string;
  reportsHref: string;
}

interface LocationFacts {
  locationId: string;
  reviews: number;
  ratingSum: number;
  oneToThree: number;
  replied: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function overviewQueryKey(read: (key: string) => string | null | undefined): string {
  return ["client", "group", "location", "range", "from", "to"].map((key) => read(key) ?? "").join("|");
}

function monthLabel(month: string): string {
  const monthNumber = Number(month.slice(5, 7));
  const name = MONTHS[monthNumber - 1] ?? month.slice(0, 7);
  const year = month.slice(2, 4);
  return year ? `${name} ’${year}` : name;
}

function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  if (!year || !monthNumber) return { from: "", to: "" };
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const mm = String(monthNumber).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

function byLocation(rows: LocationFacts[]): Map<string, LocationFacts> {
  return new Map(rows.map((row) => [row.locationId, row]));
}

function complaintFor(locationId: string, complaints: BoardComplaint[]): string | null {
  const chosen = complaints
    .filter((row) => row.locationId === locationId && row.count > 0 && row.topic.length > 0)
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))[0];
  if (!chosen) return null;
  return insightTopicLabel(chosen.topic);
}

function placeRow(
  place: BoardPlace,
  current: LocationFacts,
  previous: LocationFacts | undefined,
  complaints: BoardComplaint[],
  links: BoardLinks,
  rank: number,
  rankedCount: number
): OverviewStoreRow {
  const previousRating = previous ? average(previous.ratingSum, previous.reviews) : null;
  const rating = current.ratingSum / current.reviews;
  return {
    id: place.id,
    name: place.name,
    groupName: place.groupName,
    rating,
    reviews: current.reviews,
    negativeShare: current.oneToThree / current.reviews,
    replyRate: current.replied / current.reviews,
    ratingChange: previousRating === null ? null : rating - previousRating,
    complaint: complaintFor(place.id, complaints),
    rank,
    rankedCount,
    href: links.location(place),
    reviewsHref: links.reviews({ location: place.id }),
    negativeHref: links.reviews({ location: place.id, stars: "low" }),
    unansweredHref: links.reviews({ location: place.id, filter: "unanswered" }),
  };
}

function rankedPlaces(
  places: BoardPlace[],
  facts: DashboardFacts,
  previous: DashboardFacts | null,
  complaints: BoardComplaint[],
  links: BoardLinks
): OverviewStoreRow[] {
  const earlier = byLocation(previous?.locations ?? []);
  const names = new Map(places.map((place) => [place.id, place]));
  return facts.locations
    .flatMap((row) => {
      const place = names.get(row.locationId);
      if (!place || row.reviews <= 0) return [];
      return [{ place, row, previous: earlier.get(row.locationId) }];
    })
    .sort((a, b) => {
      const left = a.row.ratingSum / a.row.reviews;
      const right = b.row.ratingSum / b.row.reviews;
      return left - right || b.row.reviews - a.row.reviews || a.place.name.localeCompare(b.place.name);
    })
    .map((item, index, list) =>
      placeRow(item.place, item.row, item.previous, complaints, links, index + 1, list.length)
    );
}

function finite(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface LooseInsight {
  title: string;
  detail: string;
  sentiment: "positive" | "negative";
  category: string;
  suggestedAction: string | null;
  supportingReviews: number;
  excerpt: string | null;
  severity: number | null;
}

function looseInsights(raw: unknown): LooseInsight[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || row.title.trim().length === 0) return [];
    if (row.sentiment !== "positive" && row.sentiment !== "negative") return [];
    const excerpts = Array.isArray(row.evidenceExcerpts)
      ? row.evidenceExcerpts.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const severity = typeof row.severity === "number" && Number.isFinite(row.severity) ? row.severity : null;
    return [
      {
        title: row.title.trim(),
        detail: typeof row.detail === "string" ? row.detail.trim() : "",
        sentiment: row.sentiment,
        category: typeof row.category === "string" ? row.category : "",
        suggestedAction:
          typeof row.suggestedAction === "string" && row.suggestedAction.trim().length > 0
            ? row.suggestedAction.trim()
            : null,
        supportingReviews: finite(row.supportingReviews),
        excerpt: excerpts[0]?.trim() ?? null,
        severity,
      },
    ];
  });
}

function glanceCard(
  kind: OverviewInsightGlance["kind"],
  label: string,
  insight: LooseInsight,
  detail: string
): OverviewInsightGlance {
  return {
    kind,
    label,
    title: insight.title,
    detail,
    supportingReviews: insight.supportingReviews,
    excerpt: insight.excerpt,
    severity: insight.severity,
  };
}

/** Up to three cards: a concern, a strength, and a suggested next step. */
export function glanceInsights(raw: unknown): OverviewInsightGlance[] {
  const records = looseInsights(raw);
  const concern =
    records.find((insight) => insight.sentiment === "negative" && insight.category !== "serious_incident") ??
    records.find((insight) => insight.category === "serious_incident");
  const strength = records.find((insight) => insight.sentiment === "positive");
  const action =
    records.find((insight) => insight.suggestedAction && insight.sentiment === "negative") ??
    records.find((insight) => insight.suggestedAction);
  const cards: OverviewInsightGlance[] = [];
  if (concern && concern.detail.length > 0) cards.push(glanceCard("concern", "Main concern", concern, concern.detail));
  if (strength && strength.detail.length > 0 && strength.title !== concern?.title) {
    cards.push(glanceCard("strength", "What is working", strength, strength.detail));
  }
  if (action?.suggestedAction) {
    const duplicate = cards.some((card) => card.title === action.title && card.detail === action.suggestedAction);
    if (!duplicate) cards.push(glanceCard("action", "Suggested next step", action, action.suggestedAction));
  }
  return cards;
}

const THEME_LIST_LIMIT = 6;

function themeBars(
  topics: BoardTopic[],
  reviews: BoardLinks["reviews"],
  tone: "praise" | "complaint"
): OverviewThemeBar[] {
  return topics
    .filter((topic) => topic.count > 0 && topic.topic.length > 0)
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, THEME_LIST_LIMIT)
    .map((topic) => ({
      label: insightTopicLabel(topic.topic),
      count: topic.count,
      reviews: topic.reviews,
      href: reviews(insightTopicInboxExtra(topic.topic, tone)),
    }));
}

function themeMix(positive: BoardTopic[], negative: BoardTopic[]): OverviewThemeMix[] {
  const byTopic = new Map<string, { label: string; positive: number; negative: number }>();
  for (const topic of positive) {
    if (topic.count <= 0 || topic.topic.length === 0) continue;
    const row = byTopic.get(topic.topic) ?? { label: insightTopicLabel(topic.topic), positive: 0, negative: 0 };
    row.positive += topic.count;
    byTopic.set(topic.topic, row);
  }
  for (const topic of negative) {
    if (topic.count <= 0 || topic.topic.length === 0) continue;
    const row = byTopic.get(topic.topic) ?? { label: insightTopicLabel(topic.topic), positive: 0, negative: 0 };
    row.negative += topic.count;
    byTopic.set(topic.topic, row);
  }
  const rows = [...byTopic.values()].map((row) => ({ ...row, total: row.positive + row.negative }));
  const mentions = rows.reduce((sum, row) => sum + row.total, 0);
  return rows
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((row) => ({
      label: row.label,
      positive: row.positive,
      negative: row.negative,
      total: row.total,
      share: mentions > 0 ? row.total / mentions : 0,
    }));
}

function sentence(parts: string[]): string | null {
  const text = parts.filter((part) => part.length > 0).join(", ");
  if (!text) return null;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function periodBrief(input: {
  periodLabel: string;
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  topComplaint: { label: string; count: number } | null;
  topPraise: { label: string; count: number } | null;
}): string[] {
  const current = reviewWindow(input.facts);
  if (input.facts.reviews === 0) return [`${input.periodLabel}. No reviews in this period.`];
  const lines: string[] = [];
  let opening = `${input.periodLabel}. ${input.facts.reviews.toLocaleString("en-US")} reviews, average ${current.avgRating?.toFixed(2) ?? "—"}.`;
  if (input.previous && input.previous.reviews > 0 && current.avgRating !== null) {
    const before = reviewWindow(input.previous);
    if (before.avgRating !== null) {
      const diff = current.avgRating - before.avgRating;
      opening +=
        Math.abs(diff) < 0.005
          ? ` Unchanged from the previous period (${input.previous.reviews.toLocaleString("en-US")} reviews).`
          : ` ${diff > 0 ? "Up" : "Down"} ${Math.abs(diff).toFixed(2)} from the previous period (${input.previous.reviews.toLocaleString("en-US")} reviews, average ${before.avgRating.toFixed(2)}).`;
    }
  }
  lines.push(opening);
  const operations = sentence([
    current.negativeShare === null ? "" : `${Math.round(current.negativeShare * 100)}% are 1–3 stars`,
    current.replyRate === null ? "" : `the reply rate is ${Math.round(current.replyRate * 100)}%`,
    current.avgResponseHours === null ? "" : `the average reply time is ${formatHours(current.avgResponseHours)}`,
  ]);
  if (operations) lines.push(operations);
  const themes = sentence([
    input.topComplaint
      ? `the most mentioned complaint in analysed reviews is ${input.topComplaint.label} (${input.topComplaint.count.toLocaleString("en-US")} mentions)`
      : "",
    input.topPraise
      ? `the most mentioned praise is ${input.topPraise.label} (${input.topPraise.count.toLocaleString("en-US")} mentions)`
      : "",
  ]);
  if (themes) lines.push(themes);
  return lines;
}

function analysisGlances(
  complaint: BoardTopic | undefined,
  praiseTopic: BoardTopic | undefined
): OverviewInsightGlance[] {
  const cards: OverviewInsightGlance[] = [];
  if (complaint) {
    const reviews =
      complaint.reviews > 0 ? `, across ${complaint.reviews.toLocaleString("en-US")} reviews` : "";
    cards.push({
      kind: "concern",
      label: "Main complaint",
      title: insightTopicLabel(complaint.topic),
      detail: `${complaint.count.toLocaleString("en-US")} complaint mentions in analysed reviews${reviews}.`,
      supportingReviews: complaint.reviews,
      excerpt: null,
      severity: null,
    });
  }
  if (praiseTopic) {
    const reviews =
      praiseTopic.reviews > 0 ? `, across ${praiseTopic.reviews.toLocaleString("en-US")} reviews` : "";
    cards.push({
      kind: "strength",
      label: "Strongest praise",
      title: insightTopicLabel(praiseTopic.topic),
      detail: `${praiseTopic.count.toLocaleString("en-US")} praise mentions in analysed reviews${reviews}.`,
      supportingReviews: praiseTopic.reviews,
      excerpt: null,
      severity: null,
    });
  }
  return cards;
}

function trendCaption(months: DashboardFacts["months"]): string | null {
  const filled = months.filter((month) => month.reviews > 0);
  if (filled.length === 0) return null;
  const first = filled[0]!;
  const last = filled[filled.length - 1]!;
  const peak = [...filled].sort((a, b) => {
    const left = a.oneToThree / a.reviews;
    const right = b.oneToThree / b.reviews;
    return right - left || b.reviews - a.reviews;
  })[0]!;
  const parts: string[] = [];
  if (filled.length >= 2 && first.month !== last.month) {
    parts.push(
      last.reviews === first.reviews
        ? `${monthLabel(last.month)} has the same number of reviews as ${monthLabel(first.month)}.`
        : `${monthLabel(last.month)} has ${last.reviews > first.reviews ? "more" : "fewer"} reviews than ${monthLabel(first.month)} (${last.reviews.toLocaleString("en-US")} and ${first.reviews.toLocaleString("en-US")}).`
    );
  }
  parts.push(
    `The highest 1–3 star share was ${monthLabel(peak.month)} (${Math.round((peak.oneToThree / peak.reviews) * 100)}% of ${peak.reviews.toLocaleString("en-US")} reviews).`
  );
  return parts.join(" ");
}

export function buildOverviewBoard(input: {
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  places: BoardPlace[];
  complaints: BoardComplaint[];
  topics: BoardTopic[];
  coverage: OverviewCoverage;
  links: BoardLinks;
  attention: OverviewAttentionRow[];
  praise?: BoardTopic[];
  staff?: OverviewStaffMention[];
  severeCount?: number;
  severeExcerpt?: string | null;
  severeStars?: number | null;
  reportInsights?: unknown;
  reportStatus?: string | null;
  reportFinishedAt?: string | null;
  periodLabel?: string;
}): OverviewBoard {
  const current = reviewWindow(input.facts);
  const earlier = input.previous ? reviewWindow(input.previous) : null;
  const ranked = rankedPlaces(input.places, input.facts, input.previous, input.complaints, input.links);
  const multiple = ranked.length > 1;
  const praise = (input.praise ?? []).filter((topic) => topic.count > 0 && topic.topic.length > 0);
  const complaintsTopics = input.topics.filter((topic) => topic.count > 0 && topic.topic.length > 0);
  const mixed = themeMix(praise, complaintsTopics);
  const topComplaint = [...complaintsTopics].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))[0];
  const topPraise = [...praise].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))[0];
  const periodLabel = input.periodLabel?.trim() || "This period";
  const reportStatus = input.reportStatus === "completed" || input.reportStatus === "partial" ? input.reportStatus : null;
  const firstSevereExcerpt = typeof input.severeExcerpt === "string" && input.severeExcerpt.trim().length > 0
    ? input.severeExcerpt.trim()
    : null;
  return {
    kpis: {
      avgRating: current.avgRating,
      previousAvgRating: earlier?.avgRating ?? null,
      reviews: input.facts.reviews,
      previousReviews: input.previous ? input.previous.reviews : null,
      negativeShare: current.negativeShare,
      previousNegativeShare: earlier?.negativeShare ?? null,
      replyRate: current.replyRate,
      previousReplyRate: earlier?.replyRate ?? null,
      avgResponseHours: current.avgResponseHours,
      previousAvgResponseHours: earlier?.avgResponseHours ?? null,
      unreplied: input.facts.unreplied,
      openEscalations: input.facts.openEscalations,
      overdueEscalations: input.facts.overdueEscalations,
    },
    brief: periodBrief({
      periodLabel,
      facts: input.facts,
      previous: input.previous,
      topComplaint: topComplaint ? { label: insightTopicLabel(topComplaint.topic), count: topComplaint.count } : null,
      topPraise: topPraise ? { label: insightTopicLabel(topPraise.topic), count: topPraise.count } : null,
    }),
    periodLabel,
    worst: multiple ? ranked[0]! : null,
    months: input.facts.months.map((month) => {
      const bounds = monthBounds(month.month);
      const neutral = Math.max(0, month.oneToThree - month.negative);
      return {
        key: month.month,
        label: monthLabel(month.month),
        positive: month.positive,
        neutral,
        negative: month.negative,
        avgRating: average(month.ratingSum, month.reviews),
        href: input.links.reviews({ focusFrom: bounds.from, focusTo: bounds.to }),
      };
    }),
    trendCaption: trendCaption(input.facts.months),
    attention: input.attention,
    lowest: multiple ? ranked.slice(0, 5) : [],
    rankedCount: ranked.length,
    themes: themeBars(complaintsTopics, input.links.reviews, "complaint"),
    praiseThemes: themeBars(praise, input.links.reviews, "praise"),
    themeMix: mixed,
    sentiment: {
      positive: praise.reduce((sum, topic) => sum + topic.count, 0),
      negative: complaintsTopics.reduce((sum, topic) => sum + topic.count, 0),
    },
    staff: (input.staff ?? [])
      .filter((row) => row.name.trim().length > 0 && row.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 4),
    severe: {
      count: Math.max(0, input.severeCount ?? 0),
      excerpt: firstSevereExcerpt,
      stars: typeof input.severeStars === "number" && Number.isFinite(input.severeStars) ? input.severeStars : null,
    },
    report: reportStatus
      ? {
          status: reportStatus,
          finishedAt: typeof input.reportFinishedAt === "string" && input.reportFinishedAt.length > 0 ? input.reportFinishedAt : null,
          cards: glanceInsights(input.reportInsights),
        }
      : null,
    analysis: analysisGlances(topComplaint, topPraise),
    coverage: input.coverage,
    starMix: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: input.facts.stars[stars - 1] ?? 0,
      href: input.links.reviews({ rating: String(stars) }),
    })),
    analyticsHref: input.links.analytics,
    insightsHref: input.links.insights,
    reportsHref: input.links.reports,
  };
}
