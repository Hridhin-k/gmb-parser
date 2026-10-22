import { insightTopicLabel } from "@/lib/insight-dashboard";
import { average, reviewWindow, type DashboardFacts, type StarCounts } from "@/lib/metrics";

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
  assignHref: string;
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
  stars?: StarCounts;
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

export interface OverviewStarRow {
  stars: number;
  count: number;
  href: string;
}

export interface OverviewBoard {
  kpis: OverviewKpis;
  worst: OverviewStoreRow | null;
  months: OverviewMonthBar[];
  trendCaption: string | null;
  attention: OverviewAttentionRow[];
  lowest: OverviewStoreRow[];
  rankedCount: number;
  themes: OverviewThemeBar[];
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
    assignHref: links.reviews({ location: place.id, filter: "unanswered" }),
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
}): OverviewBoard {
  const current = reviewWindow(input.facts);
  const earlier = input.previous ? reviewWindow(input.previous) : null;
  const ranked = rankedPlaces(input.places, input.facts, input.previous, input.complaints, input.links);
  const multiple = ranked.length > 1;

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
      unreplied: input.facts.unreplied,
      openEscalations: input.facts.openEscalations,
      overdueEscalations: input.facts.overdueEscalations,
    },
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
        href: input.links.reviews({ range: "custom", from: bounds.from, to: bounds.to }),
        stars: month.stars,
      };
    }),
    trendCaption: trendCaption(input.facts.months),
    attention: input.attention,
    lowest: multiple ? ranked.slice(0, 5) : [],
    rankedCount: ranked.length,
    themes: input.topics
      .filter((topic) => topic.count > 0 && topic.topic.length > 0)
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, 5)
      .map((topic) => ({
        label: insightTopicLabel(topic.topic),
        count: topic.count,
        reviews: topic.reviews,
        href: input.links.insights,
      })),
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
