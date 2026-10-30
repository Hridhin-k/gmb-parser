"use client";

import Link from "next/link";
import { CHART, ChartCard, ChartTip, HBarChart, MonthVolumeChart, SentimentDonut, STAR_COLORS, VBarChart } from "@/components/charts";
import { NoData, Panel, Segmented } from "@/components/analytics-panel";
import { PageTabs } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Delta, KpiGrid, KpiTile } from "@/components/ui/kpi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatHours,
  rankRows,
  REPLY_SPEED_LABELS,
  rollupByGroup,
  type AnalyticsCompare,
  type RankBy,
  type RankShow,
} from "@/lib/analytics-metrics";
import type { AnalyticsSlice } from "@/lib/services/analytics-slice";
import { dateRangeParams, type DateRange } from "@/lib/date-range";
import { average, monthBounds, reviewDrillHref, reviewWindow, share, type DashboardFacts, type StarCounts } from "@/lib/metrics";
import { sumStarCounts } from "@/lib/star-breakdown";
import { insightTopicLabel, type InsightDashboardData } from "@/lib/insight-dashboard";
import { themeLabel } from "@/lib/review-inbox";
import type { DashboardContext, DashboardScope } from "@/lib/services/dashboard-metrics";
import { formatFriendlyDate } from "@/lib/format-date";
import { formatPercent as percent } from "@/lib/format";
import { ANALYTICS_SECTIONS, type AnalyticsSection } from "@/lib/analytics-sections";
import { cn } from "@/lib/utils";

/** Tab labels follow the redesign; ids stay the URL values the page parses. */
const SECTION_LABELS: Record<AnalyticsSection, string> = {
  performance: "Performance",
  themes: "Customer themes",
  profile: "Google profile health",
  automation: "Automation health",
  team: "Team",
};

const ALL_TIME: DateRange = { key: "all", from: "", to: "", start: null, end: null, label: "All time" };

function insightsHref(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of ["rankBy", "show", "compare", "section"]) params.delete(key);
  const text = params.toString();
  return text ? `/insights?${text}` : "/insights";
}

function analyticsHref(query: string, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete("page");
  const text = params.toString();
  return text ? `/analytics?${text}` : "/analytics";
}

function hours(value: number | null) {
  if (value === null) return "—";
  if (value < 1) return "< 1 h";
  if (value < 48) return `${Math.round(value)} h`;
  return `${(value / 24).toFixed(1)} days`;
}

function monthShort(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

/** Month plus year so a 12-month window never repeats a label. */
function monthWithYear(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/** Percentage-point change between two shares, rounded to 0.1. */
function points(now: number | null, before: number | null | undefined): number | null {
  if (now === null || before === null || before === undefined) return null;
  return Math.round((now - before) * 1000) / 10;
}

function rounded(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function AnalyticsBoard({
  context,
  range,
  scope,
  section,
  members,
  query,
  slice,
  insights,
  rankBy,
  show,
  compare,
}: {
  context: DashboardContext;
  range: DateRange;
  scope: DashboardScope;
  section: AnalyticsSection;
  members: Array<{ userId: string; email: string }>;
  query: string;
  slice: AnalyticsSlice;
  insights: InsightDashboardData;
  rankBy: RankBy;
  show: RankShow;
  compare: AnalyticsCompare;
}) {
  const names = new Map(context.locations.map((location) => [location.id, location.name]));
  const groupNames = new Map(context.groups.map((group) => [group.id, group.name]));
  const drill = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);
  const groupOf = (locationId: string) => context.locations.find((location) => location.id === locationId)?.groupId ?? null;
  const parentOf = (groupId: string) => context.locations.find((location) => location.groupId === groupId)?.parentGroupId ?? null;
  const unverified = context.locations.filter((location) => location.voiceOfMerchant === false).length;
  const automationIssues = context.facts.failed;

  return (
    <div className="flex flex-col gap-4">
      <PageTabs
        tabs={ANALYTICS_SECTIONS.map((item) => ({
          label: SECTION_LABELS[item.id] ?? item.label,
          href: analyticsHref(query, { section: item.id === "performance" ? null : item.id }),
          active: section === item.id,
          count:
            item.id === "profile" && unverified > 0
              ? unverified
              : item.id === "automation" && automationIssues > 0
                ? automationIssues
                : null,
          tone: item.id === "profile" || item.id === "automation" ? "bad" : "default",
        }))}
      />
      {section === "performance" ? (
        <Performance
          facts={context.facts}
          previous={context.previous}
          names={names}
          groupNames={groupNames}
          drill={drill}
          range={range}
          scope={scope}
          slice={slice}
          rankBy={rankBy}
          show={show}
          compare={compare}
          query={query}
          groupOf={groupOf}
          parentOf={parentOf}
        />
      ) : null}
      {section === "themes" ? (
        <Themes
          facts={context.facts}
          groupNames={groupNames}
          names={names}
          drill={drill}
          insights={insights}
          insightsHref={insightsHref(query)}
          parentOf={parentOf}
        />
      ) : null}
      {section === "profile" ? <Profile context={context} scope={scope} /> : null}
      {section === "automation" ? <Automation context={context} scope={scope} drill={drill} /> : null}
      {section === "team" ? <Team facts={context.facts} members={members} drill={drill} /> : null}
      <details className="rounded-lg border border-line bg-white px-4 py-3 text-xs leading-relaxed text-ink-3">
        <summary className="cursor-pointer font-medium text-ink-2">How these numbers are calculated</summary>
        <p className="mt-2">
          1–3 star share is the portion of reviews rated 1–3 stars. The month chart splits reviews into 4–5 stars, 3 stars, and 1–2 stars. Reply rate counts a review once Google has a reply.
          Average rating is the sum of stars divided by reviews. Reply rate is reviews with a Google reply divided by reviews.
          Median reply time is the middle elapsed time among reviews whose Google reply timestamp is present and not earlier
          than the review. Hour buckets are under 1 hour, 1–6 hours, 6–24 hours, and over 24 hours. Reviews without that
          timestamp stay out of the median and the bars. Since onboarding compares every review before the onboarding
          timestamp with every review from that timestamp on, in this scope, and ignores the date range above. Language
          shares use the stored language and count a missing language as Not set.
          Month buckets use {context.timezone}. An empty population shows an em dash. These figures follow the latest sync,
          not a live feed.
          {slice.truncated ? " Reply-time and language figures use the first 8,000 reviews in the window." : ""}
        </p>
      </details>
    </div>
  );
}

function Performance({
  facts,
  previous,
  names,
  groupNames,
  drill,
  range,
  scope,
  slice,
  rankBy,
  show,
  compare,
  query,
  groupOf,
  parentOf,
}: {
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  names: Map<string, string>;
  groupNames: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
  range: DateRange;
  scope: DashboardScope;
  slice: AnalyticsSlice;
  rankBy: RankBy;
  show: RankShow;
  compare: AnalyticsCompare;
  query: string;
  groupOf: (locationId: string) => string | null;
  parentOf: (groupId: string) => string | null;
}) {
  const current = reviewWindow(facts);
  const before = previous ? reviewWindow(previous) : null;
  const threeStar = Math.max(0, facts.oneToThree - facts.negative);
  const replyBuckets = (["under1h", "h1to6", "h6to24", "over24h"] as const).map((id) => ({
    label: REPLY_SPEED_LABELS[id],
    value: slice.window.buckets[id],
    stars: slice.window.bucketStars[id],
    lines: ["Reviews with a confirmed reply time in this bucket"],
  }));
  const repliedHref = drill({ filter: "published" });
  const onboarding = slice.onboarding;
  const beforeOnboarding = onboarding.completedAt ? onboarding.before : null;
  const afterOnboarding = onboarding.completedAt ? onboarding.after : null;
  const onboardingMode = compare === "onboarding";
  const hasPrevious = !onboardingMode && before !== null && previous !== null;

  const ratingDetail = onboardingMode ? (
    beforeOnboarding && afterOnboarding && beforeOnboarding.avgRating !== null && afterOnboarding.avgRating !== null ? (
      `${beforeOnboarding.avgRating.toFixed(2)} → ${afterOnboarding.avgRating.toFixed(2)} since onboarding`
    ) : undefined
  ) : hasPrevious && before.avgRating !== null && current.avgRating !== null ? (
    <>
      <Delta value={rounded(current.avgRating - before.avgRating)} /> vs {before.avgRating.toFixed(2)}
    </>
  ) : undefined;
  const volumeDetail = onboardingMode ? (
    beforeOnboarding && afterOnboarding ? (
      `${beforeOnboarding.reviews.toLocaleString("en-US")} → ${afterOnboarding.reviews.toLocaleString("en-US")} since onboarding`
    ) : undefined
  ) : hasPrevious ? (
    <>
      <Delta
        value={previous.reviews > 0 ? rounded(((facts.reviews - previous.reviews) / previous.reviews) * 100, 1) : null}
        suffix="%"
      />{" "}
      vs {previous.reviews.toLocaleString("en-US")}
    </>
  ) : undefined;
  const replyDetail = onboardingMode ? (
    beforeOnboarding && afterOnboarding ? `${percent(beforeOnboarding.replyRate)} → ${percent(afterOnboarding.replyRate)} since onboarding` : undefined
  ) : hasPrevious ? (
    <>
      <Delta value={points(current.replyRate, before.replyRate)} suffix=" pts" /> · {facts.unreplied.toLocaleString("en-US")} unanswered
    </>
  ) : (
    `${facts.unreplied.toLocaleString("en-US")} unanswered`
  );
  const negativeDetail = hasPrevious ? (
    <>
      <Delta value={points(current.negativeShare, before.negativeShare)} suffix=" pts" goodWhen="down" /> ·{" "}
      {facts.oneToThree.toLocaleString("en-US")} reviews
    </>
  ) : (
    `${facts.oneToThree.toLocaleString("en-US")} reviews`
  );
  const medianDetail = onboardingMode && beforeOnboarding && afterOnboarding
    ? `${formatHours(beforeOnboarding.medianHours)} → ${formatHours(afterOnboarding.medianHours)} since onboarding`
    : `Average ${hours(current.avgResponseHours)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Segmented
          label="Compare"
          options={[
            { label: "Previous period", href: analyticsHref(query, { compare: null }), current: compare === "previous" },
            { label: "Since onboarding", href: analyticsHref(query, { compare: "onboarding" }), current: compare === "onboarding" },
          ]}
        />
        <Segmented
          label="Rank by"
          options={(
            [
              ["rating", "Rating"],
              ["reviews", "Reviews"],
              ["reply", "Reply rate"],
              ["time", "Reply time"],
            ] as const
          ).map(([id, label]) => ({
            label,
            href: analyticsHref(query, { rankBy: id === "rating" ? null : id }),
            current: rankBy === id,
          }))}
        />
        <Segmented
          label="Show"
          options={[
            { label: "Locations", href: analyticsHref(query, { show: null }), current: show === "locations" },
            { label: "Groups", href: analyticsHref(query, { show: "groups" }), current: show === "groups" },
          ]}
        />
        <span className="text-xs text-ink-3 lg:ml-auto">Every number opens the reviews behind it.</span>
      </div>

      <KpiGrid>
        <KpiTile label="Reviews received" value={facts.reviews.toLocaleString("en-US")} detail={volumeDetail} href={drill()} />
        <KpiTile
          label="Average rating"
          value={current.avgRating === null ? "—" : current.avgRating.toFixed(2)}
          detail={ratingDetail}
          href={drill()}
        />
        <KpiTile label="1–3★ share" value={percent(current.negativeShare)} detail={negativeDetail} href={drill({ stars: "low" })} />
        <KpiTile label="Reply rate" value={percent(current.replyRate)} detail={replyDetail} href={drill({ filter: "published" })} />
        <KpiTile label="Median time to reply" value={formatHours(slice.window.medianHours)} detail={medianDetail} href={repliedHref} />
        <KpiTile
          label="Unanswered"
          value={facts.unreplied.toLocaleString("en-US")}
          detail="No Google reply yet"
          href={drill({ filter: "unanswered" })}
          tone={facts.unreplied > 0 ? undefined : "ok"}
        />
        <KpiTile
          label="Open escalations"
          value={facts.openEscalations.toLocaleString("en-US")}
          detail={facts.overdueEscalations > 0 ? `${facts.overdueEscalations.toLocaleString("en-US")} overdue` : "None overdue"}
          href={escalationHref(range, scope)}
          tone={facts.overdueEscalations > 0 ? "bad" : undefined}
        />
      </KpiGrid>
      <p className="text-xs text-ink-3">
        {onboardingMode
          ? "Deltas compare the period before onboarding with the period since onboarding."
          : before && previous
            ? `Deltas compare this date range with the previous range of the same length: ${previous.reviews.toLocaleString("en-US")} reviews, average ${before.avgRating === null ? "—" : before.avgRating.toFixed(2)}, 1–3★ share ${percent(before.negativeShare)}.`
            : "All time has no earlier period to compare."}{" "}
        View options do not change the business, group, or location.
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard title="Reviews by month" hint="Stacked by star band. Bar height is the number of reviews. A bar opens that month's reviews.">
          {facts.months.length === 0 || facts.reviews === 0 ? (
            <NoData>No reviews in this period.</NoData>
          ) : (
            <MonthVolumeChart
              months={facts.months.map((month) => {
                const bounds = monthBounds(month.month);
                const three = Math.max(0, month.oneToThree - month.negative);
                return {
                  key: month.month,
                  label: monthShort(month.month),
                  positive: month.positive,
                  neutral: three,
                  negative: month.negative,
                  avgRating: month.reviews ? month.ratingSum / month.reviews : null,
                  stars: month.stars,
                  href: reviewDrillHref(range, scope, { focusFrom: bounds.from, focusTo: bounds.to }),
                };
              })}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Rating distribution"
          hint="Share of reviews in this period. A bar opens that star rating."
          action={<span className="text-xs tabular-nums text-ink-3">{facts.reviews.toLocaleString("en-US")} reviews</span>}
        >
          <HBarChart
            max={Math.max(1, facts.reviews)}
            rows={[...facts.stars].reverse().map((count, index) => {
              const stars = 5 - index;
              return {
                label: `${stars}★`,
                value: count,
                color: STAR_COLORS[stars - 1],
                href: drill({ rating: String(stars) }),
                suffix: facts.reviews > 0 ? `· ${Math.round((count / facts.reviews) * 100)}%` : undefined,
                stars: facts.stars,
                lines: ["Share of reviews in this period"],
              };
            })}
          />
          {hasPrevious && previous.reviews > 0 ? (
            <p className="mt-3 text-xs text-ink-3">
              Previous period: 5★ {Math.round((previous.stars[4] / previous.reviews) * 100)}% · 1★{" "}
              {Math.round((previous.stars[0] / previous.reviews) * 100)}%
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-3">
            {slice.window.languages.length === 0
              ? "No reviews in this period."
              : `Languages: ${slice.window.languages
                  .slice(0, 4)
                  .map((item) => `${item.label} ${item.share === null ? "—" : `${Math.round(item.share * 100)}%`}`)
                  .join(" · ")}`}
          </p>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Time to reply" hint="Elapsed time until Google recorded a reply. A bar opens the replied reviews in this period.">
          {facts.reviews === 0 ? (
            <NoData>No reviews in this period.</NoData>
          ) : (
            <VBarChart rows={replyBuckets.map((row) => ({ ...row, href: repliedHref }))} />
          )}
          <p className="mt-3 text-xs text-ink-3">
            {slice.window.medianHours === null
              ? "No confirmed Google reply time in this period."
              : `Median ${formatHours(slice.window.medianHours)}. Average ${hours(current.avgResponseHours)}.`}
            {slice.window.untimedReplies > 0
              ? ` ${slice.window.untimedReplies.toLocaleString("en-US")} replied reviews have no usable reply timestamp.`
              : ""}
          </p>
        </ChartCard>

        <ChartCard title="Sentiment" hint="Positive 4–5★ · Neutral 3★ · Negative 1–2★">
          <SentimentDonut positive={facts.positive} neutral={threeStar} negative={facts.negative} stars={facts.stars} />
        </ChartCard>

        <ChartCard title="Since onboarding" hint="Every review in this scope, split at the onboarding timestamp. This card ignores the date range.">
          {onboarding.completedAt && beforeOnboarding && afterOnboarding ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="py-1.5 font-medium">Metric</th>
                  <th className="py-1.5 text-right font-medium">Before</th>
                  <th className="py-1.5 text-right font-medium">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                <OnboardingRow label="Reply rate" before={percent(beforeOnboarding.replyRate)} after={percent(afterOnboarding.replyRate)} />
                <OnboardingRow label="Median reply time" before={formatHours(beforeOnboarding.medianHours)} after={formatHours(afterOnboarding.medianHours)} />
                <OnboardingRow
                  label="Average rating"
                  before={beforeOnboarding.avgRating === null ? "—" : beforeOnboarding.avgRating.toFixed(2)}
                  after={afterOnboarding.avgRating === null ? "—" : afterOnboarding.avgRating.toFixed(2)}
                />
                <OnboardingRow label="Sent by autoreply" before={percent(beforeOnboarding.autoShare)} after={percent(afterOnboarding.autoShare)} />
              </tbody>
            </table>
          ) : (
            <NoData>Onboarding is not finished, so there is no before-and-after.</NoData>
          )}
          <p className="mt-3 text-xs text-ink-3">
            Autoreply is the share of replies published from the app whose source is the model. A Google reply with no publish record here is not included.
          </p>
          {onboarding.completedAt ? (
            <Link className="mt-2 inline-block text-xs font-medium text-brand hover:underline" href={drill()}>
              Open reviews in the selected period
            </Link>
          ) : null}
        </ChartCard>
      </div>

      <Leaderboard
        facts={facts}
        previous={hasPrevious ? previous : null}
        names={names}
        groupNames={groupNames}
        rankBy={rankBy}
        show={show}
        drill={drill}
        groupOf={groupOf}
        parentOf={parentOf}
      />

      {facts.months.length > 0 ? (
        <Panel title="Month by month" hint="Totals for each month in the selected scope. A row opens that month's reviews." flush>
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="text-right">Avg rating</TableHead>
                <TableHead className="text-right">4–5★</TableHead>
                <TableHead className="text-right">3★</TableHead>
                <TableHead className="text-right">1–2★</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facts.months.map((month) => {
                const bounds = monthBounds(month.month);
                const href = reviewDrillHref(range, scope, { focusFrom: bounds.from, focusTo: bounds.to });
                return (
                  <TableRow key={month.month}>
                    <TableCell>
                      <Link href={href} className="font-medium text-ink hover:text-brand">
                        {monthWithYear(month.month)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{month.reviews.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{month.reviews ? (month.ratingSum / month.reviews).toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right">{month.positive.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{Math.max(0, month.oneToThree - month.negative).toLocaleString("en-US")}</TableCell>
                    <TableCell className={cn("text-right", month.negative > 0 && "text-bad")}>{month.negative.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">{percent(share(month.replied, month.reviews))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      ) : null}
    </div>
  );
}

function escalationHref(range: DateRange, scope: DashboardScope): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: scope.clientId ?? "",
    group: scope.groupId ?? "",
    location: scope.locationId ?? "",
    ...dateRangeParams(range, "all"),
  })) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `/escalations?${text}` : "/escalations";
}

function OnboardingRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <tr>
      <td className="py-2 text-ink-2">{label}</td>
      <td className="py-2 text-right tabular-nums text-ink-3">{before}</td>
      <td className="py-2 text-right tabular-nums font-medium text-ink">{after}</td>
    </tr>
  );
}

type RankInput = {
  id: string;
  groupId?: string | null;
  reviews: number;
  ratingSum: number;
  replied: number;
  responseHoursSum: number;
  responseCount: number;
};

function locationRows(facts: DashboardFacts, names: Map<string, string>, groupOf: (id: string) => string | null): RankInput[] {
  return facts.locations
    .filter((row) => names.has(row.locationId))
    .map((row) => ({
      id: row.locationId,
      groupId: groupOf(row.locationId),
      reviews: row.reviews,
      ratingSum: row.ratingSum,
      replied: row.replied,
      responseHoursSum: row.responseHoursSum,
      responseCount: row.responseCount,
    }));
}

function Leaderboard({
  facts,
  previous,
  names,
  groupNames,
  rankBy,
  show,
  drill,
  groupOf,
  parentOf,
}: {
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  names: Map<string, string>;
  groupNames: Map<string, string>;
  rankBy: RankBy;
  show: RankShow;
  drill: (extra?: Record<string, string>) => string;
  groupOf: (locationId: string) => string | null;
  parentOf: (groupId: string) => string | null;
}) {
  const build = (source: DashboardFacts) => {
    const rows = locationRows(source, names, groupOf);
    return show === "groups"
      ? rollupByGroup(rows.map((row) => ({ ...row, groupId: row.groupId ?? null })), parentOf)
      : rows.map((row) => ({
          id: row.id,
          reviews: row.reviews,
          ratingSum: row.ratingSum,
          replied: row.replied,
          responseHoursSum: row.responseHoursSum,
          responseCount: row.responseCount,
        }));
  };
  const ranked = rankRows(build(facts), rankBy);
  const before = new Map((previous ? build(previous) : []).map((row) => [row.id, row]));
  const rankLabel = rankBy === "time" ? "reply time" : rankBy === "reply" ? "reply rate" : rankBy;
  return (
    <Panel
      title={`${show === "groups" ? "Groups" : "Locations"} ranked by ${rankLabel}`}
      hint={previous ? "Compared with the previous period of the same length. A name opens its reviews." : "A name opens its reviews."}
      flush
    >
      {ranked.length === 0 ? (
        <NoData>No reviews in this period.</NoData>
      ) : (
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{show === "groups" ? "Group" : "Location"}</TableHead>
              {show === "locations" ? <TableHead>Group</TableHead> : null}
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead className="text-right">Avg rating</TableHead>
              {previous ? <TableHead className="text-right">Δ rating</TableHead> : null}
              <TableHead className="text-right">Reply rate</TableHead>
              <TableHead className="text-right">Avg reply time</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((row, index) => {
              const rating = row.reviews > 0 ? row.ratingSum / row.reviews : null;
              const prior = before.get(row.id);
              const priorRating = prior && prior.reviews > 0 ? prior.ratingSum / prior.reviews : null;
              const directGroup = show === "locations" ? groupOf(row.id) : null;
              const groupId = show === "groups" ? row.id || null : directGroup ? parentOf(directGroup) ?? directGroup : null;
              const href = show === "groups" ? drill({ group: row.id, location: "" }) : drill({ location: row.id });
              const label =
                show === "groups" ? groupNames.get(row.id) ?? (row.id ? "Removed group" : "No group") : names.get(row.id);
              return (
                <TableRow key={row.id || "none"}>
                  <TableCell className="text-ink-3">{index + 1}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    <Link href={href} className="font-medium text-ink hover:text-brand">
                      {label}
                    </Link>
                  </TableCell>
                  {show === "locations" ? (
                    <TableCell className="text-ink-3">{groupId ? groupNames.get(groupId) ?? "Removed group" : "—"}</TableCell>
                  ) : null}
                  <TableCell className="text-right">{row.reviews.toLocaleString("en-US")}</TableCell>
                  <TableCell className="text-right">{rating === null ? "—" : rating.toFixed(2)}</TableCell>
                  {previous ? (
                    <TableCell className="text-right">
                      {rating !== null && priorRating !== null ? (
                        <Delta value={rounded(rating - priorRating)} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">{percent(share(row.replied, row.reviews))}</TableCell>
                  <TableCell className="text-right">{hours(average(row.responseHoursSum, row.responseCount))}</TableCell>
                  <TableCell className="text-right">
                    <Link href={href} className={buttonVariants({ variant: "outline", size: "xs" })}>
                      Reviews
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

/** Light-to-strong red scale for complaint counts; empty cells stay neutral. */
function complaintHeat(ratio: number): { background: string; color: string } {
  const clamped = Math.min(1, Math.max(0, ratio));
  const from = [252, 234, 234]; // bad-tint
  const to = [185, 28, 28]; // bad
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * clamped));
  return {
    background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    color: clamped > 0.5 ? "#ffffff" : "#14181F",
  };
}

function ThemeMatrix({
  facts,
  groupNames,
  drill,
  parentOf,
}: {
  facts: DashboardFacts;
  groupNames: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
  parentOf: (groupId: string) => string | null;
}) {
  const counts = new Map<string, number>();
  const starRows = new Map<string, Array<StarCounts | undefined>>();
  for (const row of facts.themeGroups) {
    const parent = row.groupId ? parentOf(row.groupId) : null;
    const groupId = parent ?? row.groupId ?? "";
    const key = `${groupId}::${row.theme}`;
    counts.set(key, (counts.get(key) ?? 0) + row.count);
    const list = starRows.get(key) ?? [];
    list.push(row.stars);
    starRows.set(key, list);
  }
  const themes = [...new Set(facts.themeGroups.map((row) => row.theme))];
  const groups = [...new Set([...counts.keys()].map((key) => key.split("::")[0]))];
  const max = Math.max(1, ...counts.values());
  return (
    <Panel
      title="1–3★ reviews by theme and group"
      hint="Darker cells hold more 1–3 star reviews with that theme. A cell opens those reviews."
      flush
      footer={
        themes.length > 0 ? (
          <span className="flex items-center gap-2">
            Fewer
            <span className="h-2 w-24 rounded-sm" style={{ background: "linear-gradient(90deg, #FCEAEA, #B91C1C)" }} aria-hidden />
            More
          </span>
        ) : undefined
      }
    >
      {themes.length === 0 ? (
        <NoData>No 1–3 star reviews in this period.</NoData>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-[13px]">
            <thead className="bg-[#fafbfc]">
              <tr className="border-b border-line text-xs text-ink-3">
                <th className="px-3 py-2 font-medium">Theme</th>
                {groups.map((groupId) => (
                  <th key={groupId || "none"} className="px-3 py-2 text-center font-medium">
                    {groupId ? groupNames.get(groupId) ?? "Removed group" : "No group"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {themes.map((theme) => (
                <tr key={theme} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-2 text-ink-2">{themeLabel(theme) ?? theme}</td>
                  {groups.map((groupId) => {
                    const key = `${groupId}::${theme}`;
                    const count = counts.get(key) ?? 0;
                    const heat = complaintHeat(count / max);
                    const groupName = groupId ? groupNames.get(groupId) ?? "Removed group" : "No group";
                    return (
                      <td key={groupId || "none"} className="group relative px-3 py-1.5 text-center hover:z-20">
                        <Link
                          href={drill({ ...(groupId ? { group: groupId, location: "" } : { location: "" }), theme, stars: "low" })}
                          className="inline-flex min-w-10 justify-center rounded-[4px] px-1.5 py-0.5 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand-line"
                          style={count === 0 ? { background: "#F5F6F8", color: "#687283" } : { background: heat.background, color: heat.color }}
                          aria-label={`${themeLabel(theme) ?? theme}, ${groupName}: ${count} reviews`}
                        >
                          {count}
                        </Link>
                        <ChartTip
                          title={`${themeLabel(theme) ?? theme} · ${groupName}`}
                          lines={[`${count.toLocaleString("en-US")} reviews`]}
                          stars={sumStarCounts(starRows.get(key) ?? [])}
                          className="bottom-full left-1/2 mb-1 -translate-x-1/2"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Themes({
  facts,
  groupNames,
  names,
  drill,
  insights,
  insightsHref,
  parentOf,
}: {
  facts: DashboardFacts;
  groupNames: Map<string, string>;
  names: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
  insights: InsightDashboardData;
  insightsHref: string;
  parentOf: (groupId: string) => string | null;
}) {
  const topics = insights.aggregates.negative.filter((topic) => topic.count > 0);
  const praise = insights.aggregates.positive.filter((topic) => topic.count > 0);
  const outlets = [...insights.aggregates.byOutlet].sort(
    (a, b) => b.negative - a.negative || (names.get(a.locationId) ?? "").localeCompare(names.get(b.locationId) ?? "")
  );
  const analysed = insights.counts.alreadyAnalysed;
  const eligible = insights.counts.eligible;
  const ratingOnly = insights.counts.ratingOnly;
  const coverage = eligible > 0 ? Math.round((analysed / eligible) * 1000) / 10 : null;

  return (
    <div className="flex flex-col gap-4">
      <Banner
        tone="ai"
        title="Themes are assigned by AI from review text."
        actions={
          <Link href={insightsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open Insights for interpretation
          </Link>
        }
      >
        Coverage {coverage === null ? "—" : `${coverage}%`} · {analysed.toLocaleString("en-US")} of {eligible.toLocaleString("en-US")} written
        reviews analysed{ratingOnly > 0 ? ` · ${ratingOnly.toLocaleString("en-US")} rating-only reviews have no text` : ""}. Counts are
        observed; the theme labels are the model&apos;s grouping.
      </Banner>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard
          title="Complaint themes"
          hint="Complaint mentions in analysed text, largest first. One review can mention a topic more than once."
          action={<Badge variant="ai">AI-classified</Badge>}
        >
          {topics.length === 0 ? (
            <NoData>No negative topics in analysed reviews for this period.</NoData>
          ) : (
            <HBarChart
              max={Math.max(1, ...topics.map((topic) => topic.count))}
              rows={topics.map((topic) => ({
                label: insightTopicLabel(topic.topic),
                value: topic.count,
                color: CHART.rose,
                href: insightsHref,
                suffix: topic.reviews > 0 ? `mentions · ${topic.reviews.toLocaleString("en-US")} reviews` : "mentions",
                lines: ["Complaint mentions in analysed reviews"],
              }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Praise themes"
          hint="Praise mentions in analysed text, ranked separately from complaints."
          action={<Badge variant="ai">AI-classified</Badge>}
        >
          {praise.length === 0 ? (
            <NoData>No positive topics in analysed reviews for this period.</NoData>
          ) : (
            <HBarChart
              max={Math.max(1, ...praise.map((topic) => topic.count))}
              rows={praise.slice(0, 10).map((topic) => ({
                label: insightTopicLabel(topic.topic),
                value: topic.count,
                color: CHART.green,
                href: insightsHref,
                suffix: topic.reviews > 0 ? `mentions · ${topic.reviews.toLocaleString("en-US")} reviews` : "mentions",
                lines: ["Praise mentions in analysed reviews"],
              }))}
            />
          )}
        </ChartCard>
      </div>

      <ThemeMatrix facts={facts} groupNames={groupNames} drill={drill} parentOf={parentOf} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Mentions by location" hint="Analysed mentions at each location. These are not a count of 1–3 star reviews." flush>
          {outlets.length === 0 ? (
            <NoData>No analysed complaints in this period.</NoData>
          ) : (
            <Table className="min-w-[30rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Negative</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Analysed reviews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outlets.map((row) => (
                  <TableRow key={row.locationId}>
                    <TableCell className="max-w-[14rem] truncate">
                      <Link href={drill({ location: row.locationId })} className="font-medium text-ink hover:text-brand">
                        {names.get(row.locationId) ?? "Removed location"}
                      </Link>
                    </TableCell>
                    <TableCell className={cn("text-right", row.negative > 0 && "text-bad")}>{row.negative.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right text-ok">{row.positive.toLocaleString("en-US")}</TableCell>
                    <TableCell className="text-right">
                      {(insights.aggregates.outletReviews[row.locationId] ?? 0).toLocaleString("en-US")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        <ChartCard title="Group comparison" hint="Review volume and 1–3 star share by group. A bar opens that group's reviews.">
          {facts.groups.length === 0 ? (
            <NoData>No reviews in this period.</NoData>
          ) : (
            <HBarChart
              max={Math.max(1, ...facts.groups.map((group) => group.reviews))}
              rows={facts.groups
                .slice()
                .sort((a, b) => b.reviews - a.reviews)
                .map((group, index) => ({
                  id: group.groupId ?? `none-${index}`,
                  label: group.groupId ? groupNames.get(group.groupId) ?? "Removed group" : "No group",
                  value: group.reviews,
                  color: CHART.blue,
                  href: group.groupId ? drill({ group: group.groupId }) : drill(),
                  suffix: `· ${percent(share(group.oneToThree, group.reviews))} 1–3 stars`,
                  stars: group.stars,
                  lines: ["Reviews in this group"],
                }))}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Profile({ context, scope }: { context: DashboardContext; scope: DashboardScope }) {
  const rows = context.locations.filter(
    (location) =>
      (!scope.clientId || location.clientId === scope.clientId) &&
      (!scope.groupId || location.groupId === scope.groupId || location.parentGroupId === scope.groupId) &&
      (!scope.locationId || location.id === scope.locationId)
  );
  const verified = rows.filter((location) => location.voiceOfMerchant === true).length;
  const unverified = rows.filter((location) => location.voiceOfMerchant === false).length;
  const unknown = rows.length - verified - unverified;
  const held = rows.filter((location) => location.holdReason).length;
  const groupNames = new Map(context.groups.map((group) => [group.id, group.name]));
  // Problems first: unverified, then held, then not returned, then stalest sync.
  const sorted = rows.slice().sort((a, b) => {
    const rank = (row: typeof a) => (row.voiceOfMerchant === false ? 0 : row.holdReason ? 1 : row.voiceOfMerchant === null ? 2 : 3);
    return rank(a) - rank(b) || (a.lastSyncedAt ?? "").localeCompare(b.lastSyncedAt ?? "");
  });

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid>
        <KpiTile label="Verified" value={verified.toLocaleString("en-US")} detail={`of ${rows.length.toLocaleString("en-US")} locations`} href="/locations" />
        <KpiTile
          label="Unverified"
          value={unverified.toLocaleString("en-US")}
          detail="Google has not confirmed ownership"
          href="/locations"
          tone={unverified > 0 ? "bad" : undefined}
        />
        <KpiTile label="Verification holds" value={held.toLocaleString("en-US")} detail="Publishing paused" href="/locations" tone={held > 0 ? "warn" : undefined} />
        <KpiTile label="Not returned" value={unknown.toLocaleString("en-US")} detail="Google sent no status yet" href="/locations" />
        <KpiTile
          label="Google connections"
          value={(context.expiredConnections + context.revokedConnections).toLocaleString("en-US")}
          detail={`${context.expiredConnections} expired · ${context.revokedConnections} revoked (workspace)`}
          href="/settings?section=integrations"
          tone={context.expiredConnections + context.revokedConnections > 0 ? "bad" : undefined}
        />
      </KpiGrid>
      {context.expiredConnections + context.revokedConnections > 0 ? (
        <Banner
          tone="bad"
          title="Some Google connections need attention."
          actions={
            <Link href="/settings?section=integrations" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Review connections
            </Link>
          }
        >
          {context.expiredConnections} expired and {context.revokedConnections} revoked connections in this workspace. Locations behind them stop
          syncing and cannot publish replies.
        </Banner>
      ) : null}
      <Panel
        title="Verification and sync by location"
        hint="Problems first. A name opens that location's reviews."
        flush
        footer={
          <>
            <span>
              {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "location" : "locations"} in this scope
            </span>
            <Link href="/locations" className="font-medium text-brand hover:underline">
              Manage locations
            </Link>
          </>
        }
      >
        {rows.length === 0 ? (
          <NoData>No locations in this scope.</NoData>
        ) : (
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Hold</TableHead>
                <TableHead>Last sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((location) => (
                <TableRow key={location.id}>
                  <TableCell className="max-w-[16rem] truncate">
                    <Link href={reviewDrillHref(ALL_TIME, { locationId: location.id })} className="font-medium text-ink hover:text-brand">
                      {location.name}
                    </Link>
                    {!location.isActive ? <span className="ml-2 text-xs text-ink-3">Paused</span> : null}
                  </TableCell>
                  <TableCell className="text-ink-3">
                    {location.groupId ? groupNames.get(location.parentGroupId ?? location.groupId) ?? groupNames.get(location.groupId) ?? "—" : "—"}
                  </TableCell>
                  <TableCell>
                    {location.voiceOfMerchant === null ? (
                      <Badge>Not returned yet</Badge>
                    ) : location.voiceOfMerchant ? (
                      <Badge variant="ok">Verified</Badge>
                    ) : (
                      <Badge variant="bad">Unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {location.holdReason ? <Badge variant="warn">{location.holdReason}</Badge> : <span className="text-ink-3">—</span>}
                  </TableCell>
                  <TableCell className={cn(!location.lastSyncedAt && "text-ink-3")}>
                    {location.lastSyncedAt ? formatFriendlyDate(location.lastSyncedAt) : "Not synced"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <p className="text-xs text-ink-3">
        Profile completeness (hours, photos, attributes) is not read from Google yet, so it is not shown here.
      </p>
    </div>
  );
}

function Automation({
  context,
  scope,
  drill,
}: {
  context: DashboardContext;
  scope: DashboardScope;
  drill: (extra?: Record<string, string>) => string;
}) {
  const paused =
    context.pauses.workspace ||
    (scope.clientId !== null && context.pauses.clientIds.includes(scope.clientId)) ||
    (scope.locationId !== null && context.pauses.locationIds.includes(scope.locationId));
  const { drafts, failed, pendingNow } = context.facts;

  return (
    <div className="flex flex-col gap-4">
      {paused ? (
        <Banner
          tone="warn"
          title="Automation is paused for this scope."
          actions={
            <Link href="/settings?section=tone" className={buttonVariants({ variant: "outline", size: "sm" })}>
              AI settings
            </Link>
          }
        >
          Background draft generation is blocked until the pause is lifted.
        </Banner>
      ) : (
        <Banner tone="ok" title="Automation is running for this scope.">
          There is no automatic reply sender. A pause blocks background draft generation.
        </Banner>
      )}
      <KpiGrid>
        <KpiTile
          label="Drafts waiting"
          value={drafts.toLocaleString("en-US")}
          detail={drafts === 1 ? "draft in this period awaits approval" : "drafts in this period await approval"}
          href={drill({ filter: "draft" })}
          tone={drafts > 0 ? "ai" : undefined}
        />
        <KpiTile
          label="Failed publishes"
          value={failed.toLocaleString("en-US")}
          detail="Replies in this period that failed to publish"
          href={drill({ filter: "failed" })}
          tone={failed > 0 ? "bad" : undefined}
        />
        <KpiTile
          label="Unconfirmed publishes"
          value={pendingNow.toLocaleString("en-US")}
          detail="Waiting on Google now · ignores the date range"
          href={reviewDrillHref(ALL_TIME, scope, { filter: "approved" })}
          tone={pendingNow > 0 ? "warn" : undefined}
        />
      </KpiGrid>
      <ChartCard title="Reply pipeline" hint="Where replies in this scope are waiting. A bar opens those reviews.">
        <HBarChart
          max={Math.max(1, drafts, failed, pendingNow)}
          rows={[
            { label: "Drafts awaiting approval", value: drafts, color: "#6D28D9", href: drill({ filter: "draft" }) },
            { label: "Failed to publish", value: failed, color: CHART.rose, href: drill({ filter: "failed" }) },
            {
              label: "Publishing, not yet confirmed",
              value: pendingNow,
              color: CHART.sky,
              href: reviewDrillHref(ALL_TIME, scope, { filter: "approved" }),
            },
          ]}
        />
      </ChartCard>
      <p className="text-xs text-ink-3">
        Draft outcomes, edit distance and per-rule run counts are not recorded yet, so they are not shown here. AI spend is on the{" "}
        <Link href="/portfolio/usage" className="text-brand hover:underline">
          usage page
        </Link>
        .
      </p>
    </div>
  );
}

function Team({
  facts,
  members,
  drill,
}: {
  facts: DashboardFacts;
  members: Array<{ userId: string; email: string }>;
  drill: (extra?: Record<string, string>) => string;
}) {
  const emails = new Map(members.map((member) => [member.userId, member.email]));
  const rows = facts.team.slice().sort((a, b) => b.assignedReviews - a.assignedReviews);
  const assigned = rows.reduce((sum, row) => sum + row.assignedReviews, 0);
  const open = rows.reduce((sum, row) => sum + row.openEscalations, 0);
  const resolved = rows.reduce((sum, row) => sum + row.resolvedEscalations, 0);
  const max = Math.max(1, ...rows.map((row) => row.assignedReviews));

  return (
    <div className="flex flex-col gap-4">
      <Banner tone="neutral">
        Numbers measure workflow, not quality. Assignments are reviews in this period; resolutions are escalations closed in this period.
      </Banner>
      <KpiGrid>
        <KpiTile label="Reviews assigned" value={assigned.toLocaleString("en-US")} detail={`${rows.length} people`} href={drill()} />
        <KpiTile label="Open escalations" value={open.toLocaleString("en-US")} detail="Assigned to these people" />
        <KpiTile label="Escalations resolved" value={resolved.toLocaleString("en-US")} detail="In this period" tone={resolved > 0 ? "ok" : undefined} />
      </KpiGrid>
      <Panel title="By person" hint="A name opens the reviews assigned to them." flush>
        {rows.length === 0 ? (
          <NoData>No assignments or resolutions in this period.</NoData>
        ) : (
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Assigned reviews</TableHead>
                <TableHead className="w-[30%]">Share of assignments</TableHead>
                <TableHead className="text-right">Open escalations</TableHead>
                <TableHead className="text-right">Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="max-w-[16rem] truncate">
                    <Link href={drill({ assignee: row.userId })} className="font-medium text-ink hover:text-brand">
                      {emails.get(row.userId) ?? "Workspace member"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{row.assignedReviews.toLocaleString("en-US")}</TableCell>
                  <TableCell>
                    <span className="block h-2 overflow-hidden rounded-[3px] bg-line-2" aria-hidden>
                      <span className="block h-full rounded-[3px] bg-brand" style={{ width: `${(row.assignedReviews / max) * 100}%` }} />
                    </span>
                  </TableCell>
                  <TableCell className={cn("text-right", row.openEscalations > 0 && "text-warn")}>{row.openEscalations.toLocaleString("en-US")}</TableCell>
                  <TableCell className="text-right">{row.resolvedEscalations.toLocaleString("en-US")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <p className="text-xs text-ink-3">Per-person reply time, SLA compliance and draft approval rates are not tracked yet.</p>
    </div>
  );
}
