"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CHART,
  ChartCard,
  ChartTip,
  HBarChart,
  MonthVolumeChart,
  SentimentDonut,
  STAR_COLORS,
  VBarChart,
} from "@/components/charts";
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

const HEADING = { fontFamily: "var(--font-heading), sans-serif" };

import { ANALYTICS_SECTIONS, type AnalyticsSection } from "@/lib/analytics-sections";

function insightsHref(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of ["rankBy", "show", "compare", "section"]) params.delete(key);
  const text = params.toString();
  return text ? `/insights?${text}` : "/insights";
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
  const [activeSection, setActiveSection] = useState(section);
  const names = new Map(context.locations.map((location) => [location.id, location.name]));
  const groupNames = new Map(context.groups.map((group) => [group.id, group.name]));
  const drill = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {ANALYTICS_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveSection(item.id)}
            aria-current={activeSection === item.id ? "page" : undefined}
            className={
              activeSection === item.id
                ? "rounded-full bg-navy px-3.5 py-1.5 text-sm text-white"
                : "rounded-full border border-silver bg-white px-3.5 py-1.5 text-sm text-graphite hover:border-action-blue hover:text-action-blue"
            }
          >
            {item.label}
          </button>
        ))}
      </div>
      {activeSection === "performance" ? (
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
          groupOf={(locationId) => context.locations.find((location) => location.id === locationId)?.groupId ?? null}
          parentOf={(groupId) => context.locations.find((location) => location.groupId === groupId)?.parentGroupId ?? null}
        />
      ) : null}
      {activeSection === "themes" ? (
        <Themes
          facts={context.facts}
          groupNames={groupNames}
          names={names}
          drill={drill}
          insights={insights}
          insightsHref={insightsHref(query)}
        />
      ) : null}
      {activeSection === "profile" ? <Profile context={context} scope={scope} /> : null}
      {activeSection === "automation" ? <Automation context={context} scope={scope} /> : null}
      {activeSection === "team" ? <Team facts={context.facts} members={members} drill={drill} /> : null}
      <p className="text-xs leading-relaxed text-slate">
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
  const maxStar = Math.max(1, ...facts.stars);
  const threeStar = Math.max(0, facts.oneToThree - facts.negative);
  const replyBuckets = (["under1h", "h1to6", "h6to24", "over24h"] as const).map((id) => ({
    label: REPLY_SPEED_LABELS[id],
    value: slice.window.buckets[id],
    stars: slice.window.bucketStars[id],
    lines: ["Reviews with a confirmed reply time in this bucket"],
  }));
  const repliedHref = drill({ filter: "published" });
  const monthMax = Math.max(1, ...facts.months.map((month) => month.reviews));
  const onboarding = slice.onboarding;
  const beforeOnboarding = onboarding.completedAt ? onboarding.before : null;
  const afterOnboarding = onboarding.completedAt ? onboarding.after : null;
  const ratingDelta =
    compare === "onboarding"
      ? beforeOnboarding && afterOnboarding && beforeOnboarding.avgRating !== null && afterOnboarding.avgRating !== null
        ? `${beforeOnboarding.avgRating.toFixed(2)} → ${afterOnboarding.avgRating.toFixed(2)} since onboarding`
        : undefined
      : before == null || before.avgRating === null || current.avgRating === null
        ? undefined
        : `${(current.avgRating - before.avgRating).toFixed(2)} vs previous`;
  const volumeDelta =
    compare === "onboarding"
      ? beforeOnboarding && afterOnboarding
        ? `${beforeOnboarding.reviews.toLocaleString("en-US")} → ${afterOnboarding.reviews.toLocaleString("en-US")} since onboarding`
        : undefined
      : before
        ? `${facts.reviews - (previous?.reviews ?? 0) >= 0 ? "+" : ""}${(facts.reviews - (previous?.reviews ?? 0)).toLocaleString("en-US")} vs previous`
        : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          label="Reviews"
          value={facts.reviews.toLocaleString("en-US")}
          tone="blue"
          delta={volumeDelta}
          href={drill()}
        />
        <Tile
          label="Average rating"
          value={current.avgRating === null ? "—" : current.avgRating.toFixed(2)}
          tone="green"
          delta={ratingDelta}
          href={drill()}
        />
        <Tile label="Reply rate" value={percent(current.replyRate)} tone="blue" href={drill({ filter: "published" })} />
        <Tile
          label="1–3 star share"
          value={percent(current.negativeShare)}
          tone="rose"
          href={drill({ stars: "low" })}
        />
        <Tile label="Median reply time" value={formatHours(slice.window.medianHours)} tone="amber" href={repliedHref} />
        <Tile label="Unreplied" value={facts.unreplied.toLocaleString("en-US")} tone="rose" href={drill({ filter: "unanswered" })} />
        <Tile
          label="Open escalations"
          value={facts.openEscalations.toLocaleString("en-US")}
          tone="amber"
          delta={facts.overdueEscalations > 0 ? `${facts.overdueEscalations.toLocaleString("en-US")} overdue` : undefined}
          href={escalationHref(range, scope)}
        />
      </div>
      <p className="text-sm text-slate">
        {before && previous
          ? `Previous period: ${previous.reviews.toLocaleString("en-US")} reviews, average ${before.avgRating === null ? "—" : before.avgRating.toFixed(2)}, negative share ${percent(before.negativeShare)}.`
          : "All time has no earlier period to compare."}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate">Compare</span>
        <FilterLink query={query} changes={{ compare: null }} current={compare === "previous"}>
          Previous period
        </FilterLink>
        <FilterLink query={query} changes={{ compare: "onboarding" }} current={compare === "onboarding"}>
          Since onboarding
        </FilterLink>
        <span className="text-slate sm:ml-3">Rank by</span>
        {(
          [
            ["rating", "Rating"],
            ["reviews", "Reviews"],
            ["reply", "Reply rate"],
            ["time", "Reply time"],
          ] as const
        ).map(([id, label]) => (
          <FilterLink key={id} query={query} changes={{ rankBy: id === "rating" ? null : id }} current={rankBy === id}>
            {label}
          </FilterLink>
        ))}
        <span className="text-slate sm:ml-3">Show</span>
        <FilterLink query={query} changes={{ show: null }} current={show === "locations"}>
          Locations
        </FilterLink>
        <FilterLink query={query} changes={{ show: "groups" }} current={show === "groups"}>
          Groups
        </FilterLink>
      </div>
      <p className="text-sm text-slate">
        {show === "locations" ? "Locations" : "Groups"} ranked by {rankBy === "time" ? "reply time" : rankBy === "reply" ? "reply rate" : rankBy}.{" "}
        {compare === "onboarding"
          ? "Deltas compare the period before onboarding with the period since onboarding."
          : before
            ? "Deltas compare this date range with the previous range of the same length."
            : "All time has no earlier period of the same length."}{" "}
        These controls do not change the organisation, group, or location.
      </p>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Reply time" hint="Elapsed time until Google recorded a reply. A bar opens the replied reviews in this period.">
          {facts.reviews === 0 ? (
            <p className="text-sm text-slate">No reviews in this period.</p>
          ) : (
            <VBarChart rows={replyBuckets.map((row) => ({ ...row, href: repliedHref }))} />
          )}
          <p className="mt-3 text-xs text-slate">
            {slice.window.medianHours === null
              ? "No confirmed Google reply time in this period."
              : `Median ${formatHours(slice.window.medianHours)}. Average ${hours(current.avgResponseHours)}.`}
            {slice.window.untimedReplies > 0
              ? ` ${slice.window.untimedReplies.toLocaleString("en-US")} replied reviews have no usable reply timestamp.`
              : ""}
          </p>
        </ChartCard>

        <ChartCard title="Rating mix" hint="Share of reviews in this period. A bar opens that star rating.">
          <HBarChart
            max={maxStar}
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
          <p className="mt-3 text-xs text-slate">
            {slice.window.languages.length === 0
              ? "No reviews in this period."
              : `Languages: ${slice.window.languages
                  .slice(0, 4)
                  .map((item) => `${item.label} ${item.share === null ? "—" : `${Math.round(item.share * 100)}%`}`)
                  .join(" · ")}`}
          </p>
        </ChartCard>

        <ChartCard title="Since onboarding" hint="Every review in this scope, split at the onboarding timestamp. This card ignores the date range.">
          {onboarding.completedAt && beforeOnboarding && afterOnboarding ? (
            <dl className="divide-y divide-silver text-sm">
              <OnboardingRow label="Reply rate" before={percent(beforeOnboarding.replyRate)} after={percent(afterOnboarding.replyRate)} />
              <OnboardingRow label="Median reply time" before={formatHours(beforeOnboarding.medianHours)} after={formatHours(afterOnboarding.medianHours)} />
              <OnboardingRow
                label="Average rating"
                before={beforeOnboarding.avgRating === null ? "—" : beforeOnboarding.avgRating.toFixed(2)}
                after={afterOnboarding.avgRating === null ? "—" : afterOnboarding.avgRating.toFixed(2)}
              />
              <OnboardingRow label="Sent by autoreply" before={percent(beforeOnboarding.autoShare)} after={percent(afterOnboarding.autoShare)} />
            </dl>
          ) : (
            <p className="text-sm text-slate">Onboarding is not finished, so there is no before-and-after.</p>
          )}
          <p className="mt-3 text-xs text-slate">
            Autoreply is the share of replies published from GRM whose source is the model. A Google reply with no GRM publish record is not included.
          </p>
          {onboarding.completedAt ? (
            <Link className="mt-3 inline-block text-sm text-navy underline" href={drill()}>
              Open reviews in the selected period
            </Link>
          ) : null}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
        <ChartCard title="Reviews by month" hint="Stacked by star band. Bar height is the number of reviews.">
          {facts.months.length === 0 || facts.reviews === 0 ? (
            <p className="text-sm text-slate">No reviews in this period.</p>
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

        <ChartCard title="Sentiment" hint="Positive 4–5★ · Neutral 3★ · Negative 1–2★">
          <SentimentDonut positive={facts.positive} neutral={threeStar} negative={facts.negative} stars={facts.stars} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Leaderboard
          facts={facts}
          names={names}
          groupNames={groupNames}
          rankBy={rankBy}
          show={show}
          drill={drill}
          groupOf={groupOf}
          parentOf={parentOf}
        />
        <ThemeMatrix facts={facts} groupNames={groupNames} drill={drill} parentOf={parentOf} />
      </div>

      {facts.months.length > 0 ? (
        <ChartCard title="Monthly volume bars" hint="Total reviews each month for the selected scope.">
          <HBarChart
            max={monthMax}
            rows={facts.months.map((month) => {
              const bounds = monthBounds(month.month);
              return {
                id: month.month,
                label: monthWithYear(month.month),
                value: month.reviews,
                color: CHART.blue,
                href: reviewDrillHref(range, scope, { focusFrom: bounds.from, focusTo: bounds.to }),
                suffix: month.reviews ? `· ${(month.ratingSum / month.reviews).toFixed(2)}` : undefined,
                stars: month.stars,
                lines: ["Total reviews in this month"],
              };
            })}
          />
        </ChartCard>
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

function FilterLink({
  query,
  changes,
  current,
  children,
}: {
  query: string;
  changes: Record<string, string | null>;
  current: boolean;
  children: string;
}) {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete("page");
  const text = params.toString();
  return (
    <Link
      href={text ? `/analytics?${text}` : "/analytics"}
      aria-current={current ? "page" : undefined}
      className={
        current
          ? "rounded-full bg-navy px-3 py-1 text-white"
          : "rounded-full border border-silver bg-white px-3 py-1 text-graphite"
      }
    >
      {children}
    </Link>
  );
}

function OnboardingRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-slate">{label}</dt>
      <dd className="tabular-nums text-graphite">
        {before} → {after}
      </dd>
    </div>
  );
}

function Leaderboard({
  facts,
  names,
  groupNames,
  rankBy,
  show,
  drill,
  groupOf,
  parentOf,
}: {
  facts: DashboardFacts;
  names: Map<string, string>;
  groupNames: Map<string, string>;
  rankBy: RankBy;
  show: RankShow;
  drill: (extra?: Record<string, string>) => string;
  groupOf: (locationId: string) => string | null;
  parentOf: (groupId: string) => string | null;
}) {
  const ranked =
    show === "groups"
      ? rankRows(
          rollupByGroup(
            facts.locations
              .filter((row) => names.has(row.locationId))
              .map((row) => ({
                id: row.locationId,
                groupId: groupOf(row.locationId),
                reviews: row.reviews,
                ratingSum: row.ratingSum,
                replied: row.replied,
                responseHoursSum: row.responseHoursSum,
                responseCount: row.responseCount,
              })),
            parentOf
          ),
          rankBy
        )
      : rankRows(
          facts.locations
            .filter((row) => names.has(row.locationId))
            .map((row) => ({
              id: row.locationId,
              reviews: row.reviews,
              ratingSum: row.ratingSum,
              replied: row.replied,
              responseHoursSum: row.responseHoursSum,
              responseCount: row.responseCount,
            })),
          rankBy
        );
  return (
    <ChartCard title={show === "groups" ? "Group leaderboard" : "Location leaderboard"} hint="A row opens those reviews.">
      {ranked.length === 0 ? (
        <p className="text-sm text-slate">No reviews in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">{show === "groups" ? "Group" : "Location"}</th>
                {show === "locations" ? <th className="py-2 pr-3 font-medium">Group</th> : null}
                <th className="py-2 pr-3 font-medium">Rating</th>
                <th className="py-2 pr-3 font-medium">Reviews</th>
                <th className="py-2 pr-3 font-medium">Reply rate</th>
                <th className="py-2 font-medium">Reply time</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, index) => {
                const rating = row.reviews > 0 ? row.ratingSum / row.reviews : null;
                const directGroup = show === "locations" ? groupOf(row.id) : null;
                const groupId = show === "groups" ? row.id || null : directGroup ? parentOf(directGroup) ?? directGroup : null;
                const href =
                  show === "groups"
                    ? drill({ group: row.id, location: "" })
                    : drill({ location: row.id });
                return (
                  <tr key={row.id || "none"} className="border-t border-silver">
                    <td className="py-2 pr-3 text-slate">{index + 1}</td>
                    <td className="py-2 pr-3">
                      <Link href={href} className="text-navy hover:underline">
                        {show === "groups" ? groupNames.get(row.id) ?? (row.id ? "Removed group" : "No group") : names.get(row.id)}
                      </Link>
                    </td>
                    {show === "locations" ? (
                      <td className="py-2 pr-3 text-slate">{groupId ? groupNames.get(groupId) ?? "Removed group" : "—"}</td>
                    ) : null}
                    <td className="py-2 pr-3 tabular-nums">{rating === null ? "—" : rating.toFixed(2)}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.reviews.toLocaleString("en-US")}</td>
                    <td className="py-2 pr-3 tabular-nums">{percent(share(row.replied, row.reviews))}</td>
                    <td className="py-2 tabular-nums">{hours(average(row.responseHoursSum, row.responseCount))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

function complaintHeat(ratio: number): { background: string; color: string } {
  const clamped = Math.min(1, Math.max(0, ratio));
  const green = [187, 247, 208];
  const yellow = [250, 204, 21];
  const red = [239, 68, 68];
  const [from, to, blend] = clamped < 0.5 ? [green, yellow, clamped * 2] : [yellow, red, (clamped - 0.5) * 2];
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * blend));
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return {
    background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    color: luminance < 0.55 ? "#ffffff" : "#1e293b",
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
    <ChartCard title="Complaints by theme and group" hint="Cell color runs from green for fewer 1–3 star reviews with that theme, through yellow, to red for more. A cell opens those reviews.">
      {themes.length === 0 ? (
        <p className="text-sm text-slate">No 1–3 star reviews in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate">
                <th className="py-2 pr-3 font-medium">Theme</th>
                {groups.map((groupId) => (
                  <th key={groupId || "none"} className="py-2 pr-3 font-medium">
                    {groupId ? groupNames.get(groupId) ?? "Removed group" : "No group"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {themes.map((theme) => (
                <tr key={theme} className="border-t border-silver">
                  <td className="py-2 pr-3 text-graphite">{themeLabel(theme) ?? theme}</td>
                  {groups.map((groupId) => {
                    const key = `${groupId}::${theme}`;
                    const count = counts.get(key) ?? 0;
                    const heat = complaintHeat(count / max);
                    const groupName = groupId ? groupNames.get(groupId) ?? "Removed group" : "No group";
                    return (
                      <td key={groupId || "none"} className="group relative py-2 pr-3 hover:z-20">
                        <Link
                          href={drill({ ...(groupId ? { group: groupId, location: "" } : { location: "" }), theme, stars: "low" })}
                          className="inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 tabular-nums"
                          style={{ background: heat.background, color: heat.color }}
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
    </ChartCard>
  );
}

function Themes({
  facts,
  groupNames,
  names,
  drill,
  insights,
  insightsHref,
}: {
  facts: DashboardFacts;
  groupNames: Map<string, string>;
  names: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
  insights: InsightDashboardData;
  insightsHref: string;
}) {
  const topics = insights.aggregates.negative.filter((topic) => topic.count > 0);
  const outlets = [...insights.aggregates.byOutlet].sort(
    (a, b) => b.negative - a.negative || (names.get(a.locationId) ?? "").localeCompare(names.get(b.locationId) ?? "")
  );
  const themeColors = [CHART.rose, CHART.orange, CHART.amber, CHART.indigo, CHART.blue, CHART.sky];
  const analysed = insights.counts.alreadyAnalysed;
  const ratingOnly = insights.counts.ratingOnly;

  return (
    <div className="space-y-4">
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <ChartCard title="Complaint themes" hint="Complaint mentions in analysed text, largest first. Overview lists these same counts separately from praise. One review can mention a topic more than once.">
          {topics.length === 0 ? (
            <p className="text-sm text-slate">No negative topics in analysed reviews for this period.</p>
          ) : (
            <HBarChart
              max={Math.max(1, ...topics.map((topic) => topic.count))}
              rows={topics.map((topic, index) => ({
                label: insightTopicLabel(topic.topic),
                value: topic.count,
                color: themeColors[index % themeColors.length],
                href: insightsHref,
                suffix: topic.reviews > 0 ? `mentions · ${topic.reviews.toLocaleString("en-US")} reviews` : "mentions",
                lines: ["Complaint mentions in analysed reviews"],
              }))}
            />
          )}
          <p className="mt-3 text-xs text-slate">
            {`${analysed.toLocaleString("en-US")} reviews analysed${ratingOnly > 0 ? `. ${ratingOnly.toLocaleString("en-US")} reviews in this period have no text` : ""}.`}
          </p>
        </ChartCard>

        <ChartCard title="Group comparison" hint="Review volume and 1–3 star share by group.">
          {facts.groups.length === 0 ? (
            <p className="text-sm text-slate">No reviews in this period.</p>
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
                  color: themeColors[index % themeColors.length],
                  href: group.groupId ? drill({ group: group.groupId }) : drill(),
                  suffix: `· ${percent(share(group.oneToThree, group.reviews))} 1–3 stars`,
                  stars: group.stars,
                  lines: ["Reviews in this group"],
                }))}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Negative mentions by outlet" hint="Negative observation mentions at each outlet. These are analysed mentions, not a count of 1–3 star reviews.">
        {outlets.length === 0 ? (
          <p className="text-sm text-slate">No analysed complaints in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate">
                  <th className="py-2 pr-3 font-medium">Outlet</th>
                  <th className="py-2 pr-3 font-medium">Negative mentions</th>
                  <th className="py-2 pr-3 font-medium">Positive mentions</th>
                  <th className="py-2 font-medium">Analysed reviews</th>
                </tr>
              </thead>
              <tbody>
                {outlets.map((row) => (
                  <tr key={row.locationId} className="border-t border-silver">
                    <td className="py-2 pr-3">
                      <Link href={drill({ location: row.locationId })} className="text-graphite hover:text-navy">
                        {names.get(row.locationId) ?? "Removed outlet"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{row.negative.toLocaleString("en-US")}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.positive.toLocaleString("en-US")}</td>
                    <td className="py-2 tabular-nums">
                      {(insights.aggregates.outletReviews[row.locationId] ?? 0).toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Verified" value={verified.toLocaleString("en-US")} tone="green" />
        <Tile label="Unverified" value={unverified.toLocaleString("en-US")} tone="amber" />
        <Tile label="Not returned" value={unknown.toLocaleString("en-US")} tone="blue" />
      </div>
      <ChartCard
        title="Google profile"
        hint={`${context.expiredConnections} expired and ${context.revokedConnections} revoked Google connections in this workspace.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate">
                <th className="py-2 pr-3 font-medium">Location</th>
                <th className="py-2 pr-3 font-medium">Verification</th>
                <th className="py-2 pr-3 font-medium">Hold</th>
                <th className="py-2 font-medium">Last sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((location) => (
                <tr key={location.id} className="border-t border-silver">
                  <td className="py-2 pr-3">
                    <Link
                      href={reviewDrillHref(
                        { key: "all", from: "", to: "", start: null, end: null, label: "All time" },
                        { locationId: location.id }
                      )}
                      className="text-navy hover:underline"
                    >
                      {location.name}
                    </Link>
                    {!location.isActive ? <p className="text-xs text-slate">Paused</p> : null}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusPill
                      label={
                        location.voiceOfMerchant === null
                          ? "Not returned yet"
                          : location.voiceOfMerchant
                            ? "Verified"
                            : "Unverified"
                      }
                      tone={
                        location.voiceOfMerchant === null ? "blue" : location.voiceOfMerchant ? "green" : "amber"
                      }
                    />
                  </td>
                  <td className="py-2 pr-3">{location.holdReason ?? "—"}</td>
                  <td className="py-2">{location.lastSyncedAt ? formatFriendlyDate(location.lastSyncedAt) : "Not synced"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

function Automation({ context, scope }: { context: DashboardContext; scope: DashboardScope }) {
  const paused =
    context.pauses.workspace ||
    (scope.clientId !== null && context.pauses.clientIds.includes(scope.clientId)) ||
    (scope.locationId !== null && context.pauses.locationIds.includes(scope.locationId));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Drafts waiting" value={context.facts.drafts.toLocaleString("en-US")} tone="amber" />
        <Tile label="Failed publishes" value={context.facts.failed.toLocaleString("en-US")} tone="rose" />
        <Tile label="Unconfirmed publishes" value={context.facts.pendingNow.toLocaleString("en-US")} tone="blue" />
      </div>
      <ChartCard title="Automation health">
        <ul className="space-y-2 text-sm text-graphite">
          <li>
            <StatusPill label={paused ? "Paused for this scope" : "Running for this scope"} tone={paused ? "amber" : "green"} />
          </li>
          <li>There is no automatic reply sender. A pause blocks background draft generation.</li>
          <li>{context.facts.failed.toLocaleString("en-US")} replies in this period failed to publish.</li>
          <li>
            {context.facts.pendingNow.toLocaleString("en-US")} replies in this scope are waiting on an unconfirmed
            publish. This count ignores the date range.
          </li>
          <li>
            {context.facts.drafts.toLocaleString("en-US")}{" "}
            {context.facts.drafts === 1 ? "draft in this period is" : "drafts in this period are"} waiting for approval.
          </li>
        </ul>
        <div className="mt-4">
          <HBarChart
            max={Math.max(1, context.facts.drafts, context.facts.failed, context.facts.pendingNow)}
            rows={[
              { label: "Drafts", value: context.facts.drafts, color: CHART.amber },
              { label: "Failed", value: context.facts.failed, color: CHART.rose },
              { label: "Pending publish", value: context.facts.pendingNow, color: CHART.blue },
            ]}
          />
        </div>
      </ChartCard>
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
  const maxAssigned = Math.max(1, ...facts.team.map((row) => row.assignedReviews));

  return (
    <ChartCard
      title="Team"
      hint="Assignments are reviews in this period. Resolutions are escalations closed in this period."
    >
      {facts.team.length === 0 ? (
        <p className="text-sm text-slate">No assignments or resolutions in this period.</p>
      ) : (
        <HBarChart
          max={maxAssigned}
          rows={facts.team.map((row) => ({
            label: emails.get(row.userId) ?? "Workspace member",
            value: row.assignedReviews,
            color: CHART.indigo,
            href: drill({ assignee: row.userId }),
            suffix: `· ${row.openEscalations} open · ${row.resolvedEscalations} resolved`,
          }))}
        />
      )}
    </ChartCard>
  );
}

function Tile({
  label,
  value,
  tone,
  delta,
  href,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "rose";
  delta?: string;
  href?: string;
}) {
  const tones = {
    blue: { bar: CHART.blue, wash: "#eff6ff" },
    green: { bar: CHART.green, wash: "#ecfdf5" },
    amber: { bar: CHART.amber, wash: "#fffbeb" },
    rose: { bar: CHART.rose, wash: "#fff1f2" },
  }[tone];
  const body = (
    <>
      <div className="h-1" style={{ background: tones.bar }} />
      <div className="p-4" style={{ background: `linear-gradient(180deg, ${tones.wash} 0%, #ffffff 70%)` }}>
        <p className="text-xs text-slate">{label}</p>
        <p className="mt-1 text-2xl text-graphite" style={HEADING}>
          {value}
        </p>
        {delta ? <p className="mt-1 text-xs text-slate">{delta}</p> : null}
      </div>
    </>
  );
  const className = "overflow-hidden rounded-xl border border-silver bg-white shadow-[0_1px_2px_rgba(15,39,79,0.04)]";
  return href ? (
    <Link href={href} className={`${className} block hover:border-sky`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "blue" | "green" | "amber" | "rose" }) {
  const tones = {
    blue: "bg-sky-50 text-sky-800",
    green: "bg-emerald-50 text-emerald-800",
    amber: "bg-amber-50 text-amber-900",
    rose: "bg-rose-50 text-rose-800",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tones}`}>{label}</span>;
}
