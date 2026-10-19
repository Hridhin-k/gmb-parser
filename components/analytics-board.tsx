import Link from "next/link";
import {
  CHART,
  ChartCard,
  HBarChart,
  MonthVolumeChart,
  ScoreRing,
  SentimentDonut,
  STAR_COLORS,
} from "@/components/charts";
import type { DateRange } from "@/lib/date-range";
import { average, monthBounds, reviewDrillHref, reviewWindow, share, type DashboardFacts } from "@/lib/metrics";
import { themeLabel } from "@/lib/review-inbox";
import type { DashboardContext, DashboardScope } from "@/lib/services/dashboard-metrics";

const HEADING = { fontFamily: "var(--font-heading), sans-serif" };

export const ANALYTICS_SECTIONS = [
  { id: "performance", label: "Performance" },
  { id: "themes", label: "Themes" },
  { id: "competitors", label: "Competitors" },
  { id: "profile", label: "Google profile" },
  { id: "automation", label: "Automation health" },
  { id: "team", label: "Team" },
] as const;

export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number]["id"];

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
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
}: {
  context: DashboardContext;
  range: DateRange;
  scope: DashboardScope;
  section: AnalyticsSection;
  members: Array<{ userId: string; email: string }>;
  query: string;
}) {
  const hrefFor = (id: string) => {
    const params = new URLSearchParams(query);
    if (id === "performance") params.delete("section");
    else params.set("section", id);
    const text = params.toString();
    return text ? `/analytics?${text}` : "/analytics";
  };
  const names = new Map(context.locations.map((location) => [location.id, location.name]));
  const groupNames = new Map(context.groups.map((group) => [group.id, group.name]));
  const drill = (extra?: Record<string, string>) => reviewDrillHref(range, scope, extra);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {ANALYTICS_SECTIONS.map((item) => (
          <Link
            key={item.id}
            href={hrefFor(item.id)}
            aria-current={section === item.id ? "page" : undefined}
            className={
              section === item.id
                ? "rounded-full bg-navy px-3.5 py-1.5 text-sm text-white"
                : "rounded-full border border-silver bg-white px-3.5 py-1.5 text-sm text-graphite hover:border-action-blue hover:text-action-blue"
            }
          >
            {item.label}
          </Link>
        ))}
      </div>
      {section === "performance" ? (
        <Performance facts={context.facts} previous={context.previous} names={names} drill={drill} range={range} scope={scope} />
      ) : null}
      {section === "themes" ? <Themes facts={context.facts} groupNames={groupNames} drill={drill} /> : null}
      {section === "competitors" ? <Competitors /> : null}
      {section === "profile" ? <Profile context={context} scope={scope} /> : null}
      {section === "automation" ? <Automation context={context} scope={scope} /> : null}
      {section === "team" ? <Team facts={context.facts} members={members} drill={drill} /> : null}
      <p className="text-xs leading-relaxed text-slate">
        Negative share is the portion of reviews rated 1–3 stars. Reply rate counts a review once Google has a reply.
        Reply time uses Google’s reply timestamp. Month buckets use {context.timezone}. An empty period shows an em dash
        instead of zero percent.
      </p>
    </div>
  );
}

function Performance({
  facts,
  previous,
  names,
  drill,
  range,
  scope,
}: {
  facts: DashboardFacts;
  previous: DashboardFacts | null;
  names: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
  range: DateRange;
  scope: DashboardScope;
}) {
  const current = reviewWindow(facts);
  const before = previous ? reviewWindow(previous) : null;
  const maxStar = Math.max(1, ...facts.stars);
  const threeStar = Math.max(0, facts.oneToThree - facts.negative);
  const score = current.avgRating === null ? null : Math.round((current.avgRating / 5) * 100);
  const rows = [...facts.locations]
    .filter((row) => names.has(row.locationId))
    .sort((a, b) => b.ratingSum / Math.max(b.reviews, 1) - a.ratingSum / Math.max(a.reviews, 1) || b.reviews - a.reviews);
  const replyBuckets = [
    { label: "Under 1 hour", value: facts.buckets.under1h, color: CHART.green },
    { label: "1–24 hours", value: facts.buckets.under24h, color: CHART.sky },
    { label: "1–3 days", value: facts.buckets.under3d, color: CHART.amber },
    { label: "Over 3 days", value: facts.buckets.later, color: CHART.rose },
  ];
  const maxBucket = Math.max(1, ...replyBuckets.map((row) => row.value));
  const monthMax = Math.max(1, ...facts.months.map((month) => month.reviews));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Reviews"
          value={facts.reviews.toLocaleString("en-US")}
          tone="blue"
          delta={
            before
              ? `${facts.reviews - (previous?.reviews ?? 0) >= 0 ? "+" : ""}${(facts.reviews - (previous?.reviews ?? 0)).toLocaleString("en-US")} vs previous`
              : undefined
          }
        />
        <Tile
          label="Average rating"
          value={current.avgRating === null ? "—" : current.avgRating.toFixed(2)}
          tone="green"
          delta={
            before == null || before.avgRating === null || current.avgRating === null
              ? undefined
              : `${(current.avgRating - before.avgRating).toFixed(2)} vs previous`
          }
        />
        <Tile label="Negative share (1–3★)" value={percent(current.negativeShare)} tone="rose" />
        <Tile label="Reply time" value={hours(current.avgResponseHours)} tone="amber" />
      </div>
      <p className="text-sm text-slate">
        {before && previous
          ? `Previous period: ${previous.reviews.toLocaleString("en-US")} reviews, average ${before.avgRating === null ? "—" : before.avgRating.toFixed(2)}, negative share ${percent(before.negativeShare)}.`
          : "All time has no earlier period to compare."}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
        <ChartCard title="Reviews by month" hint="Stacked by star band. The line is average rating.">
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
                  href: reviewDrillHref(
                    {
                      ...range,
                      key: "custom",
                      from: bounds.from,
                      to: bounds.to,
                      start: null,
                      end: null,
                      label: month.month,
                    },
                    scope
                  ),
                };
              })}
            />
          )}
        </ChartCard>

        <ChartCard title="Sentiment" hint="Positive 4–5★ · Neutral 3★ · Negative 1–2★">
          <SentimentDonut positive={facts.positive} neutral={threeStar} negative={facts.negative} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Rating distribution" hint="Tap a bar to open those reviews in the inbox.">
          <HBarChart
            max={maxStar}
            rows={facts.stars.map((count, index) => ({
              label: `${index + 1} star`,
              value: count,
              color: STAR_COLORS[index],
              href: drill({ rating: String(index + 1) }),
            }))}
          />
        </ChartCard>

        <ChartCard title="Reply speed" hint="How long until Google recorded a reply.">
          <div className="mb-4 flex justify-center">
            <ScoreRing
              score={score}
              caption={
                score === null
                  ? "No rating score yet."
                  : `${current.avgRating?.toFixed(2)} average, shown out of 100.`
              }
            />
          </div>
          <HBarChart max={maxBucket} rows={replyBuckets} />
          <p className="mt-3 text-xs text-slate">
            {facts.reviews - facts.responseCount > 0
              ? `${(facts.reviews - facts.responseCount).toLocaleString("en-US")} ${facts.reviews - facts.responseCount === 1 ? "review has" : "reviews have"} no confirmed Google reply time.`
              : "Every review in this period has a confirmed reply time."}
          </p>
        </ChartCard>
      </div>

      <ChartCard title="Location leaderboard" hint="Sorted by average rating in this period.">
        {rows.length === 0 ? (
          <p className="text-sm text-slate">No reviews in this period.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row, index) => {
              const rating = row.ratingSum / row.reviews;
              const replyRate = share(row.replied, row.reviews);
              return (
                <li key={row.locationId}>
                  <Link href={drill({ location: row.locationId })} className="block rounded-xl border border-silver px-3 py-3 hover:border-sky">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-graphite">
                        <span className="mr-2 text-slate">{index + 1}.</span>
                        {names.get(row.locationId)}
                      </p>
                      <p className="text-sm tabular-nums text-navy">{rating.toFixed(2)}</p>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: CHART.track }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(rating / 5) * 100}%`,
                          background: rating >= 4.5 ? CHART.green : rating >= 3.5 ? CHART.amber : CHART.rose,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate">
                      {row.reviews.toLocaleString("en-US")} reviews · {percent(replyRate)} replied ·{" "}
                      {hours(average(row.responseHoursSum, row.responseCount))} reply time
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ChartCard>

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
                href: reviewDrillHref(
                  {
                    ...range,
                    key: "custom",
                    from: bounds.from,
                    to: bounds.to,
                    start: null,
                    end: null,
                    label: month.month,
                  },
                  scope
                ),
                suffix: month.reviews ? `· ${(month.ratingSum / month.reviews).toFixed(2)}` : undefined,
              };
            })}
          />
        </ChartCard>
      ) : null}
    </div>
  );
}

function Themes({
  facts,
  groupNames,
  drill,
}: {
  facts: DashboardFacts;
  groupNames: Map<string, string>;
  drill: (extra?: Record<string, string>) => string;
}) {
  const themes = [...new Set(facts.themeGroups.map((row) => row.theme))];
  const groups = [...new Set(facts.groups.map((row) => row.groupId))];
  const max = Math.max(1, ...facts.themeGroups.map((row) => row.count));
  const themeTotals = new Map<string, number>();
  for (const row of facts.themeMonths) {
    themeTotals.set(row.theme, (themeTotals.get(row.theme) ?? 0) + row.count);
  }
  const ranked = [...themeTotals.entries()].sort((a, b) => b[1] - a[1]);
  const themeColors = [CHART.rose, CHART.orange, CHART.amber, CHART.indigo, CHART.blue, CHART.sky];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Complaint themes" hint="1–3 star reviews tagged from the review text.">
          {ranked.length === 0 ? (
            <p className="text-sm text-slate">No 1–3 star reviews in this period.</p>
          ) : (
            <HBarChart
              max={Math.max(1, ...ranked.map(([, count]) => count))}
              rows={ranked.map(([theme, count], index) => ({
                label: themeLabel(theme) ?? theme,
                value: count,
                color: themeColors[index % themeColors.length],
                href: drill({ theme, stars: "low" }),
              }))}
            />
          )}
        </ChartCard>

        <ChartCard title="Group comparison" hint="Review volume and 1–3★ share by group.">
          {facts.groups.length === 0 ? (
            <p className="text-sm text-slate">No reviews in this period.</p>
          ) : (
            <HBarChart
              max={Math.max(1, ...facts.groups.map((group) => group.reviews))}
              rows={facts.groups
                .slice()
                .sort((a, b) => b.reviews - a.reviews)
                .map((group, index) => ({
                  label: group.groupId ? groupNames.get(group.groupId) ?? "Removed group" : "No group",
                  value: group.reviews,
                  color: themeColors[index % themeColors.length],
                  href: group.groupId ? drill({ group: group.groupId }) : drill(),
                  suffix: `· ${percent(share(group.oneToThree, group.reviews))} 1–3★`,
                }))}
            />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Complaint themes by group" hint="Darker cells mean more complaints with that theme.">
        {themes.length === 0 ? (
          <p className="text-sm text-slate">No 1–3 star reviews in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate">
                  <th className="py-2 pr-3 font-medium">Group</th>
                  {themes.map((theme) => (
                    <th key={theme} className="py-2 pr-3 font-medium">
                      {themeLabel(theme) ?? theme}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((groupId) => (
                  <tr key={groupId ?? "none"} className="border-t border-silver">
                    <td className="py-2 pr-3 text-graphite">
                      {groupId ? groupNames.get(groupId) ?? "Removed group" : "No group"}
                    </td>
                    {themes.map((theme) => {
                      const count =
                        facts.themeGroups.find((row) => row.groupId === groupId && row.theme === theme)?.count ?? 0;
                      const intensity = count === 0 ? 0 : 0.12 + (count / max) * 0.75;
                      return (
                        <td key={theme} className="py-2 pr-3">
                          <Link
                            href={drill({ ...(groupId ? { group: groupId } : {}), theme, stars: "low" })}
                            className="inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 tabular-nums text-graphite"
                            style={{ background: `rgba(244, 63, 94, ${intensity})` }}
                          >
                            {count}
                          </Link>
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
    </div>
  );
}

function Competitors() {
  return (
    <ChartCard title="Competitors">
      <p className="max-w-xl text-sm text-slate">
        Competitor ratings are not connected. This screen does not estimate them or compare a location with another business.
      </p>
    </ChartCard>
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
                  <td className="py-2">{location.lastSyncedAt ? location.lastSyncedAt.slice(0, 10) : "Not synced"}</td>
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
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "rose";
  delta?: string;
}) {
  const tones = {
    blue: { bar: CHART.blue, wash: "#eff6ff" },
    green: { bar: CHART.green, wash: "#ecfdf5" },
    amber: { bar: CHART.amber, wash: "#fffbeb" },
    rose: { bar: CHART.rose, wash: "#fff1f2" },
  }[tone];
  return (
    <div className="overflow-hidden rounded-xl border border-silver bg-white shadow-[0_1px_2px_rgba(15,39,79,0.04)]">
      <div className="h-1" style={{ background: tones.bar }} />
      <div className="p-4" style={{ background: `linear-gradient(180deg, ${tones.wash} 0%, #ffffff 70%)` }}>
        <p className="text-xs text-slate">{label}</p>
        <p className="mt-1 text-2xl text-graphite" style={HEADING}>
          {value}
        </p>
        {delta ? <p className="mt-1 text-xs text-slate">{delta}</p> : null}
      </div>
    </div>
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
