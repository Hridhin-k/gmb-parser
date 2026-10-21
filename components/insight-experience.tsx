import Link from "next/link";
import { BackfillAction } from "@/components/backfill-action";
import { DeepDiveAction } from "@/components/deep-dive-action";
import { ChartCard, CHART, MonthVolumeChart } from "@/components/charts";
import { reconcileBriefLists } from "@/lib/intelligence/brief";
import { findingsForScope } from "@/lib/insight-page";
import { average, share } from "@/lib/metrics";
import type { DashboardFacts } from "@/lib/metrics";
import type { ComplaintSample } from "@/lib/services/insight-evidence";
import type { ClusterBoardItem } from "@/lib/services/intelligence-cluster";
import type { FindingEvidenceRow, InsightBoard, InsightFindingView } from "@/lib/services/insight-report";
import { formatFriendlyDate, formatFriendlyDateTime } from "@/lib/format-date";

const SECTIONS: Array<{ title: string; categories: InsightFindingView["category"][]; hint: string }> = [
  {
    title: "Rating and severity",
    categories: ["rating_drag", "rare_severe", "location_drag", "fan_friction", "anomaly"],
    hint: "Topics sitting next to low stars, harsh even when rare, or weaker at one outlet.",
  },
  { title: "Complaints", categories: ["recurring_issue"], hint: "Each complaint stays separate, including a single visit. Praise of the same topic is a separate count. Reviews with no complaint text are listed here and are not given a topic." },
  { title: "People named in reviews", categories: ["staff_mention"], hint: "A name is counted only when the review itself writes it." },
  { title: "Customer requests", categories: ["customer_request"], hint: "Asks copied from the review text." },
  { title: "Repeated phrases", categories: ["micro_topic"], hint: "Short phrases customers repeat. These are wording, not a separate problem." },
  { title: "Changes", categories: ["emerging_topic", "trend", "location_comparison"], hint: "Shifts and outlet differences in this window." },
  { title: "Praise", categories: ["positive_driver"], hint: "What 4 and 5 star reviews mention most." },
];

const NEGATIVE_CATEGORIES = new Set<InsightFindingView["category"]>([
  "rating_drag",
  "location_drag",
  "rare_severe",
  "recurring_issue",
  "emerging_topic",
  "fan_friction",
  "anomaly",
  "trend",
  "location_comparison",
]);

const THEME_COLORS = [CHART.indigo, CHART.blue, CHART.amber, CHART.orange, CHART.rose, CHART.green, CHART.slate] as const;

const KIND_LABEL: Partial<Record<InsightFindingView["category"], string>> = {
  rating_drag: "Rising concern",
  location_drag: "Outlet gap",
  fan_friction: "Inside happy reviews",
  rare_severe: "Rare but severe",
  positive_driver: "Positive driver",
  emerging_topic: "Emerging issue",
  trend: "Change",
  anomaly: "Unusual change",
  recurring_issue: "Recurring issue",
  staff_mention: "Staff named",
  customer_request: "Customer request",
  micro_topic: "In their words",
  recommendation: "Recommendation",
  location_comparison: "Location comparison",
};

export function InsightExperience(props: {
  scopeTitle: string;
  period: string;
  bounds: string;
  query: string;
  facts: DashboardFacts;
  places: Array<{ id: string; name: string }>;
  locationIds: readonly string[];
  board: InsightBoard;
  clusters: ClusterBoardItem[];
  clustersUnavailable: string | null;
  openFinding: InsightFindingView | null;
  evidence: { rows: FindingEvidenceRow[]; total: number; page: number; pageSize: number; unavailable: string | null } | null;
  canPrepare: boolean;
  hidden: Record<string, string>;
  notice: string | null;
  samples: Array<ComplaintSample & { href: string }>;
  analyticsHref: string;
  reviewsHref: string;
}) {
  const findings = findingsForScope(props.board.report?.findings ?? [], props.locationIds)
    .filter((finding) => !isBucketFinding(finding))
    .map((finding) => nameTheOutlet(finding, props.places));
  const shown = findings.find((finding) => finding.key === props.openFinding?.key) ?? null;
  const rating = average(props.facts.ratingSum, props.facts.reviews);
  const replyRate = share(props.facts.replied, props.facts.reviews);
  const responseHours = props.facts.responseCount > 0 ? props.facts.responseHoursSum / props.facts.responseCount : null;
  const positive = props.facts.positive;
  const negative = props.facts.negative;
  const neutral = Math.max(0, props.facts.reviews - positive - negative);
  const months = props.facts.months
    .filter((month) => month.reviews > 0)
    .map((month) => ({
      key: month.month,
      label: monthLabel(month.month),
      positive: month.positive,
      negative: month.negative,
      neutral: Math.max(0, month.reviews - month.positive - month.negative),
      avgRating: month.reviews > 0 ? month.ratingSum / month.reviews : null,
      stars: month.stars,
      reviews: month.reviews,
      replied: month.replied,
    }));
  const chartMonths = months.length > 12 ? months.slice(-12) : months;
  const outlets = props.places
    .map((place) => {
      const row = props.facts.locations.find((item) => item.locationId === place.id);
      if (!row || row.reviews <= 0) return null;
      return {
        id: place.id,
        name: place.name,
        reviews: row.reviews,
        rating: row.ratingSum / row.reviews,
        low: row.oneToThree,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.low - a.low || a.rating - b.rating || a.name.localeCompare(b.name));
  const brief = props.board.report?.brief ?? null;
  const reconciled = reconcileBriefLists(brief?.highlights ?? [], brief?.risks ?? []);
  const derived = standoutFromFindings(findings);
  const risks = reconciled.risks.length > 0 ? reconciled.risks : derived.risks;
  const issueCounts = props.board.report?.issueCounts ?? [];
  const themes = issueCounts.length > 0 ? issueCounts : themeBars(risks, findings);
  const synthesis = leadInsights(props.board.report?.synthesis ?? [], findings);
  const attention = pickAttention(findings);
  const staff = findings.filter((finding) => finding.category === "staff_mention").sort(compareFindings);
  const praiseFindings = findings.filter((finding) => finding.category === "positive_driver").sort((a, b) => b.evidenceCount - a.evidenceCount).slice(0, 4);
  const headline = factualHeadline(props.scopeTitle, props.facts.reviews, rating, outlets.length);
  const lowStars = props.facts.oneToThree;

  return (
    <div className="mb-8 space-y-4">
      {props.notice ? <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite">{props.notice}</p> : null}

      <section className="rounded-2xl border border-[#dbe4f0] bg-white p-5 shadow-[0_1px_2px_rgba(15,39,79,0.04)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#2563eb]">
              {props.board.freshness?.headline ?? "Overview"} · {props.period}
            </p>
            <h2 className="mt-2 max-w-2xl font-heading text-2xl leading-snug text-ink sm:text-3xl">{headline}</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate">
              {props.bounds}.
              {props.board.freshness?.generatedAt ? ` Report completed ${formatFriendlyDateTime(props.board.freshness.generatedAt)}.` : " No completed report yet."}
              {props.board.freshness?.labelledStale ? " This is the last completed report." : ""}
              {props.board.unavailable ? ` ${props.board.unavailable}` : ""}
              {props.board.notice ? ` ${props.board.notice}` : ""}
            </p>
            {props.facts.reviews > 0 ? (
              <SentimentBar positive={positive} neutral={neutral} negative={negative} total={props.facts.reviews} lowStars={lowStars} />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <RatingRing rating={rating} reviews={props.facts.reviews} />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total reviews" value={props.facts.reviews.toLocaleString("en-US")} series={months.map((month) => month.reviews)} href={props.reviewsHref} />
        <Kpi label="Average rating" value={rating === null ? "—" : rating.toFixed(2)} series={months.map((month) => month.avgRating ?? 0)} href={props.reviewsHref} />
        <Kpi
          label="Reply rate"
          value={replyRate === null ? "—" : `${Math.round(replyRate * 100)}%`}
          series={months.map((month) => (month.reviews > 0 ? month.replied / month.reviews : 0))}
          href={props.reviewsHref}
        />
        <Kpi label="Avg. response time" value={responseLabel(responseHours)} series={[]} href={props.reviewsHref} />
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg text-ink">Read these first</h2>
            <p className="mt-1 text-xs text-slate">Each card is one complaint. Open it to see the reviews behind the number.</p>
          </div>
        </div>
        {attention.length === 0 ? (
          <div className="rounded-2xl border border-silver bg-white px-4 py-6 text-sm text-slate">
            {issueCounts.length > 0 ? (
              <>
                <p>These complaints are counted from the reviews in this window. Praise of the same topic is kept separate. Regenerate insights to open the reviews behind each count.</p>
                <ul className="mt-3 space-y-1 text-ink">
                  {issueCounts.map((row) => (
                    <li key={row.label}>
                      {row.label}
                      <span className="ml-2 tabular-nums text-slate">{row.count.toLocaleString("en-US")} reviews</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                {props.board.report?.insufficient
                  ? props.board.report.insufficientReason || "There is not enough evidence for a finding in this period."
                  : "No complaint finding is stored for this window yet."}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {attention.map((finding) => {
              const copy = synthesis.find((item) => item.findingKey === finding.key);
              const outlet = singleOutlet(finding, props.places);
              const avg = metricValue(finding, "topic_average_rating");
              const low = metricValue(finding, "low_star_reviews");
              const active = shown?.key === finding.key;
              return (
                <Link
                  key={finding.key}
                  href={findingHref(props.query, finding.key)}
                  className={`flex flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,39,79,0.04)] ${active ? "border-[#163a7a]" : "border-silver hover:border-[#163a7a]/40"}`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-negative">
                    {complaintKind(finding)}
                  </span>
                  <span className="mt-2 font-heading text-lg leading-snug text-ink">{topicLabel(finding.title)}</span>
                  {outlet ? <span className="mt-1 text-xs text-graphite">{outlet}</span> : null}
                  <span className="mt-3 text-2xl font-medium tabular-nums text-ink">{finding.evidenceCount.toLocaleString("en-US")}</span>
                  <span className="text-xs text-slate">
                    reviews
                    {avg > 0 ? ` · ${avg.toFixed(1)} average` : ""}
                    {low > 0 ? ` · ${low.toLocaleString("en-US")} at 1–2★` : ""}
                  </span>
                  <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-graphite">{copy?.summary ?? finding.explanation}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {praiseFindings.length > 0 ? (
        <section>
          <div className="mb-3">
            <h2 className="font-heading text-lg text-ink">Praise, kept separate</h2>
            <p className="mt-1 text-xs text-slate">4 and 5 star reviews that name this. A complaint about the same topic is in the section above and is not subtracted here.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {praiseFindings.map((finding) => {
              const active = shown?.key === finding.key;
              return (
                <Link
                  key={finding.key}
                  href={findingHref(props.query, finding.key)}
                  className={`flex flex-col rounded-2xl border bg-white p-4 ${active ? "border-[#047857]" : "border-silver hover:border-[#047857]/40"}`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#047857]">Praise</span>
                  <span className="mt-2 font-heading text-lg leading-snug text-ink">{topicLabel(finding.title)}</span>
                  <span className="mt-3 text-2xl font-medium tabular-nums text-ink">{finding.evidenceCount.toLocaleString("en-US")}</span>
                  <span className="text-xs text-slate">reviews at 4–5★</span>
                  <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-graphite">{finding.explanation}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {shown ? (
        <FindingDetail
          finding={shown}
          places={props.places}
          query={props.query}
          board={props.board}
          evidence={props.evidence}
          canPrepare={props.canPrepare}
          hidden={props.hidden}
        />
      ) : null}

      {props.facts.reviews === 0 ? (
        <ChartCard title="Sentiment trend" hint={props.bounds}>
          <p className="text-sm text-slate">No reviews in this period, so the chart has nothing to draw.</p>
        </ChartCard>
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          <ChartCard
            className="xl:col-span-3"
            title="Sentiment trend"
            hint={
              months.length > 12
                ? `${props.period}. Showing the latest 12 months in this window. Each bar is that month’s 4–5★, 3★, and 1–2★ reviews.`
                : `${props.period}. Each bar is that month’s 4–5★, 3★, and 1–2★ reviews. The line is that month’s own average.`
            }
          >
            {chartMonths.length === 0 ? (
              <p className="text-sm text-slate">No dated reviews fall in this window.</p>
            ) : (
              <MonthVolumeChart months={chartMonths} />
            )}
          </ChartCard>
          <ChartCard
            className="xl:col-span-2"
            title="Complaint themes"
            hint="One bar per complaint. The count is reviews that mention it. Share is of every review in this window."
            action={
              <Link href={props.analyticsHref} className="text-sm font-medium text-[#163a7a]">
                View all
              </Link>
            }
          >
            {themes.length === 0 ? (
              <p className="text-sm text-slate">No theme count is stored for this window yet.</p>
            ) : (
              <ul className="space-y-3">
                {themes.map((theme, index) => (
                  <li key={`${index}-${theme.label}`}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: THEME_COLORS[index % THEME_COLORS.length] }} />
                        <span className="truncate text-graphite">{theme.label}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3 tabular-nums text-slate">
                        <span>{theme.count.toLocaleString("en-US")}</span>
                        <span className="w-12 text-right">{shareLabel(theme.count, props.facts.reviews)}</span>
                      </span>
                    </div>
                    <span className="mt-1.5 block h-2 overflow-hidden rounded-full" style={{ background: CHART.track }}>
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (theme.count / Math.max(1, themes[0]?.count ?? 1)) * 100)}%`,
                          background: THEME_COLORS[index % THEME_COLORS.length],
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="rounded-2xl border border-silver bg-white p-5 xl:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-base text-ink">Outlets to check</h2>
              <p className="mt-1 text-xs text-slate">Sorted by the most 1–3 star reviews.</p>
            </div>
            <Link href={props.reviewsHref} className="text-sm text-[#163a7a]">
              View all
            </Link>
          </div>
          {outlets.length === 0 ? (
            <p className="mt-3 text-sm text-slate">No outlet in this scope has a review in the window.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-slate">
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 text-right font-medium">Rating</th>
                  <th className="pb-2 text-right font-medium">Reviews</th>
                  <th className="pb-2 pl-3 font-medium">1–3★</th>
                </tr>
              </thead>
              <tbody>
                {outlets.slice(0, 6).map((outlet) => (
                  <tr key={outlet.id} className="border-t border-[#eef2f7]">
                    <td className="max-w-[14rem] truncate py-2.5 text-graphite" title={outlet.name}>
                      {outlet.name}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{outlet.rating.toFixed(2)}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate">{outlet.reviews.toLocaleString("en-US")}</td>
                    <td className="py-2.5 pl-3">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e8eef8]">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.round((outlet.low / outlet.reviews) * 100)}%`,
                              background: outlet.low / outlet.reviews >= 0.25 ? CHART.rose : outlet.low / outlet.reviews >= 0.1 ? CHART.amber : CHART.green,
                            }}
                          />
                        </span>
                        <span className="w-8 text-right text-xs font-medium tabular-nums text-ink">{outlet.low.toLocaleString("en-US")}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-2xl border border-silver bg-white p-5 xl:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-base text-ink">Latest low-star reviews</h2>
              <p className="mt-1 text-xs text-slate">1–3 star reviews with a comment, newest first.</p>
            </div>
            <Link href={props.reviewsHref} className="text-sm text-[#163a7a]">
              View all
            </Link>
          </div>
          {props.samples.length === 0 ? (
            <p className="mt-3 text-sm text-slate">No commented low-star reviews in this window.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {props.samples.slice(0, 4).map((sample) => (
                <li key={sample.id} className="rounded-xl border border-[#eef2f7] p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate">
                    <RatingPill value={sample.stars} />
                    <span>{sample.when ? formatFriendlyDate(sample.when) : "No date"}</span>
                    <span className="truncate">{sample.locationName}</span>
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm text-ink">{sample.comment}</p>
                  <Link href={sample.href} className="mt-2 inline-block text-xs font-medium text-[#163a7a]">
                    Open in inbox
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {staff.length > 0 ? (
        <section>
          <h2 className="font-heading text-lg text-ink">People named in reviews</h2>
          <p className="mt-1 text-xs text-slate">What customers say this person did, and which outlet those reviews belong to.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {staff.slice(0, 8).map((finding) => {
              const unhappy = isUnhappyStaff(finding);
              const places = staffPlaceNames(finding, props.places);
              const active = shown?.key === finding.key;
              return (
                <Link
                  key={finding.key}
                  href={findingHref(props.query, finding.key)}
                  className={`rounded-2xl border bg-white p-4 ${active ? "border-[#163a7a]" : "border-silver hover:border-[#163a7a]/40"} ${unhappy ? "ring-1 ring-[#f43f5e]/20" : ""}`}
                >
                  <span className="block font-heading text-base text-ink">{staffDisplayName(finding)}</span>
                  <span className="mt-1 block text-xs text-graphite">{places.length > 0 ? places.slice(0, 2).join(", ") : "Outlet on the reviews"}</span>
                  <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-graphite">{finding.explanation}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {props.board.report && !props.board.report.insufficient ? (
        <section className="rounded-2xl border border-silver bg-white p-5">
          <h2 className="font-heading text-base text-ink">Every finding</h2>
          <p className="mt-1 text-xs text-slate">
            {findings.length.toLocaleString("en-US")} findings. Open a group, then a row, to read the cited reviews.
          </p>
          <div className="mt-3 space-y-2">
            {SECTIONS.map((section) => {
              const rows = findings
                .filter((finding) => section.categories.includes(finding.category))
                .sort(compareFindings);
              if (rows.length === 0) return null;
              return (
                <details key={section.title} className="rounded-xl border border-[#eef2f7] px-3 py-2" open={rows.some((finding) => finding.key === shown?.key)}>
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    {section.title}
                    <span className="ml-2 text-xs font-normal text-slate">{rows.length}</span>
                  </summary>
                  <p className="mt-1 text-xs text-slate">{section.hint}</p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {rows.map((finding) => {
                      const outletLine = staffOutletLine(finding, props.places);
                      const active = shown?.key === finding.key;
                      return (
                        <li key={finding.key}>
                          <Link
                            className={`block rounded-xl border px-3 py-2 ${active ? "border-[#163a7a] bg-[#f8fafc]" : "border-transparent hover:border-[#e6ebf2]"}`}
                            href={findingHref(props.query, finding.key)}
                          >
                            <span className="block text-sm text-ink">{finding.category === "staff_mention" ? staffDisplayName(finding) : topicLabel(finding.title)}</span>
                            {outletLine ? <span className="mt-0.5 block text-xs text-graphite">{outletLine}</span> : null}
                            <span className="mt-0.5 block text-xs text-slate">
                              {finding.evidenceCount.toLocaleString("en-US")} reviews
                              {active ? " · open above" : ""}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      <p className="text-xs text-slate">
        <Link className="text-[#163a7a]" href="/insights/clusters">
          Topic clusters
        </Link>
        {props.clustersUnavailable
          ? ` — ${props.clustersUnavailable}`
          : props.clusters.length === 0
            ? " — none in this scope have a review to show."
            : ` — ${props.clusters.length.toLocaleString("en-US")} in this scope.`}
      </p>
    </div>
  );
}

function FindingDetail(props: {
  finding: InsightFindingView;
  places: ReadonlyArray<{ id: string; name: string }>;
  query: string;
  board: InsightBoard;
  evidence: { rows: FindingEvidenceRow[]; total: number; page: number; pageSize: number; unavailable: string | null } | null;
  canPrepare: boolean;
  hidden: Record<string, string>;
}) {
  const dive = props.board.report?.deepDives[props.finding.key];
  const outletSentence = staffOutletSentence(props.finding, props.places, props.evidence);
  const placeName = (locationId: string, fallback: string) =>
    props.places.find((place) => place.id === locationId)?.name ?? fallback;
  return (
    <section className="rounded-2xl border border-[#163a7a]/20 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2563eb]">
            {complaintKind(props.finding)}
          </p>
          <h2 className="mt-1 font-heading text-lg text-ink">{props.finding.title}</h2>
        </div>
        <Link className="rounded-full border border-silver px-3 py-1 text-sm text-ink" href={props.query ? `/insights?${props.query}` : "/insights"}>
          Close
        </Link>
      </div>
      <p className="mt-2 text-sm text-graphite">{props.finding.explanation}</p>
      {outletSentence ? <p className="mt-2 text-sm text-ink">{outletSentence}</p> : null}
      {props.finding.action ? <p className="mt-2 text-sm text-ink"><span className="font-medium">Next step:</span> {props.finding.action}</p> : null}
      <p className="mt-2 text-sm text-slate">
        {props.finding.evidenceCount.toLocaleString("en-US")} supporting reviews out of {props.finding.sampleSize.toLocaleString("en-US")} in the window.
        {props.finding.evidenceCount === 1 ? " One review states this. It is a visit to investigate, not a pattern across the window." : ""}
      </p>
      {dive ? (
        <div className="mt-4 rounded-xl border border-[#7a4a00]/25 bg-[#fdf8ef] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Deep dive — the cited reviews, read closely</p>
          <p className="mt-2 text-sm text-ink">{dive.summary}</p>
          {dive.observations.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-graphite">
              {dive.observations.map((line, index) => (
                <li key={`${index}-${line.slice(0, 40)}`}>{line}</li>
              ))}
            </ul>
          ) : null}
          {dive.action ? <p className="mt-2 text-sm text-ink"><span className="font-medium">Next step:</span> {dive.action}</p> : null}
          {props.canPrepare ? (
            <p className="mt-3">
              <DeepDiveAction hidden={props.hidden} findingKey={props.finding.key} hasDive />
            </p>
          ) : null}
        </div>
      ) : props.canPrepare ? (
        <p className="mt-4">
          <DeepDiveAction hidden={props.hidden} findingKey={props.finding.key} hasDive={false} />
        </p>
      ) : null}
      {props.evidence?.unavailable ? <p className="mt-3 text-sm text-slate">{props.evidence.unavailable}</p> : null}
      {props.evidence && props.evidence.rows.length === 0 && !props.evidence.unavailable ? (
        <p className="mt-3 text-sm text-slate">No supporting review in this scope is available to open.</p>
      ) : null}
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {props.evidence?.rows.map((row) => (
          <li key={row.reviewId} className="rounded-xl border border-silver px-3 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-slate">
              <RatingPill value={row.stars} />
              <span>{row.createdAt ? formatFriendlyDate(row.createdAt) : "No date"}</span>
              <span>{placeName(row.locationId, row.locationTitle)}</span>
              {row.topics.length > 0 ? <span>{row.topics.join(", ")}</span> : null}
            </p>
            {row.excerpt ? <p className="mt-1 text-graphite">{row.excerpt}</p> : null}
            <Link className="mt-2 inline-block text-ink underline" href={row.href}>
              Open review
            </Link>
          </li>
        ))}
      </ul>
      {props.evidence && props.evidence.total > props.evidence.pageSize ? (
        <div className="mt-3 flex gap-4 text-sm">
          {props.evidence.page > 0 ? (
            <Link className="text-ink underline" href={findingHref(props.query, props.finding.key, props.evidence.page - 1)}>
              Previous
            </Link>
          ) : null}
          {(props.evidence.page + 1) * props.evidence.pageSize < props.evidence.total ? (
            <Link className="text-ink underline" href={findingHref(props.query, props.finding.key, props.evidence.page + 1)}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RatingRing(props: { rating: number | null; reviews: number }) {
  const value = props.rating ?? 0;
  const portion = Math.max(0, Math.min(1, value / 5));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * portion;
  const filled = Math.round(value);
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="70" cy="70" r={radius} fill="none" stroke={CHART.track} strokeWidth="10" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={value >= 4 ? CHART.green : CHART.amber}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-4xl tabular-nums text-ink">{props.rating === null ? "—" : props.rating.toFixed(1)}</span>
        <span className="text-sm tracking-widest" aria-hidden>
          <span className="text-amber-400">{"★".repeat(filled)}</span>
          <span className="text-slate/40">{"★".repeat(5 - filled)}</span>
        </span>
        <span className="mt-0.5 text-[11px] text-slate">{props.reviews.toLocaleString("en-US")} reviews</span>
      </div>
    </div>
  );
}

function SentimentBar(props: { positive: number; neutral: number; negative: number; total: number; lowStars: number }) {
  const width = (count: number) => `${props.total > 0 ? (count / props.total) * 100 : 0}%`;
  return (
    <div className="mt-5 max-w-xl">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[#e8eef8]">
        <span className="h-full" style={{ width: width(props.negative), background: CHART.rose }} />
        <span className="h-full" style={{ width: width(props.neutral), background: CHART.amber }} />
        <span className="h-full" style={{ width: width(props.positive), background: CHART.green }} />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
        <span><span className="font-medium text-negative">{shareLabel(props.negative, props.total)}</span> are 1–2★</span>
        <span><span className="font-medium text-ink">{shareLabel(props.neutral, props.total)}</span> are 3★</span>
        <span><span className="font-medium text-ink">{shareLabel(props.positive, props.total)}</span> are 4–5★</span>
        <span>{props.lowStars.toLocaleString("en-US")} reviews are 1–3★</span>
      </p>
    </div>
  );
}

function RatingPill(props: { value: number | null }) {
  if (props.value === null || !Number.isFinite(props.value)) {
    return <span className="inline-flex rounded-md bg-[#f1f5f9] px-1.5 py-0.5 text-xs font-semibold text-slate">—</span>;
  }
  const stars = Math.max(1, Math.min(5, Math.round(props.value)));
  const tone = stars <= 2 ? "bg-[#fff1f2] text-[#be123c]" : stars === 3 ? "bg-[#fffbeb] text-[#b45309]" : "bg-[#ecfdf5] text-[#047857]";
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{stars}★</span>;
}

function Kpi(props: { label: string; value: string; series: number[]; href: string }) {
  return (
    <Link href={props.href} className="rounded-2xl border border-silver bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,39,79,0.04)]">
      <p className="text-xs text-slate">{props.label}</p>
      <p className="mt-1 font-heading text-2xl tabular-nums text-ink">{props.value}</p>
      {props.series.length > 1 ? <Spark series={props.series} /> : <span className="mt-2 block h-8" />}
    </Link>
  );
}

function Spark(props: { series: number[] }) {
  const min = Math.min(...props.series);
  const max = Math.max(...props.series);
  const span = max - min || 1;
  const points = props.series
    .map((value, index) => {
      const x = props.series.length === 1 ? 0 : (index / (props.series.length - 1)) * 100;
      const y = 28 - ((value - min) / span) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className="mt-2 h-8 w-full" aria-hidden>
      <polyline fill="none" stroke={CHART.blue} strokeWidth="1.6" vectorEffect="non-scaling-stroke" points={points} />
    </svg>
  );
}

export function InsightToolbar(props: { hidden: Record<string, string>; board: InsightBoard; canPrepare: boolean }) {
  if (!props.canPrepare) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <BackfillAction hidden={props.hidden} />
      <ReportAction hidden={props.hidden} board={props.board} />
    </div>
  );
}

function ReportAction(props: { hidden: Record<string, string>; board: InsightBoard }) {
  const label = props.board.freshness?.label;
  if (label === "processing") {
    return <p className="text-sm text-slate">A newer analysis is already queued.</p>;
  }
  const failed = label === "failed";
  return (
    <form action="/api/insights/reports" method="post">
      {Object.entries(props.hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <input type="hidden" name="force" value={props.board.report || failed ? "1" : "0"} />
      <button className="rounded-full bg-[#163a7a] px-4 py-2 text-sm font-medium text-white" type="submit">
        {failed ? "Retry analysis" : props.board.report ? "Regenerate insights" : "Prepare analysis"}
      </button>
    </form>
  );
}

function factualHeadline(scope: string, reviews: number, rating: number | null, outlets: number): string {
  if (reviews === 0) return `${scope} has no reviews in this window.`;
  const averageText = rating === null ? "no average" : `a ${rating.toFixed(2)} average`;
  const reviewText = reviews === 1 ? "1 review" : `${reviews.toLocaleString("en-US")} reviews`;
  const outletText = outlets === 1 ? "1 outlet" : `${outlets} outlets`;
  return `${scope} has ${reviewText} across ${outletText}, with ${averageText}.`;
}

function responseLabel(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours >= 24) return `${(hours / 24).toFixed(1)} days`;
  return `${hours.toFixed(1)} hours`;
}

function shareLabel(count: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (count / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function metricValue(finding: InsightFindingView, key: string): number {
  const value = finding.metrics.find((item) => item.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isUnhappyStaff(finding: InsightFindingView): boolean {
  if (finding.category !== "staff_mention") return false;
  const complaints = metricValue(finding, "staff_complaint_reviews");
  return complaints > 0 && complaints >= metricValue(finding, "staff_praise_reviews");
}

function isNegativeFinding(finding: InsightFindingView): boolean {
  return NEGATIVE_CATEGORIES.has(finding.category) || isUnhappyStaff(finding);
}

function compareFindings(a: InsightFindingView, b: InsightFindingView): number {
  if (a.category === "staff_mention" && b.category === "staff_mention") {
    return metricValue(b, "staff_complaint_reviews") - metricValue(a, "staff_complaint_reviews")
      || b.evidenceCount - a.evidenceCount;
  }
  return Number(isNegativeFinding(b)) - Number(isNegativeFinding(a)) || b.evidenceCount - a.evidenceCount;
}

function staffPlaceNames(
  finding: InsightFindingView,
  places: ReadonlyArray<{ id: string; name: string }>
): string[] {
  if (finding.category !== "staff_mention") return [];
  return finding.locationIds
    .map((id) => places.find((place) => place.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

function staffOutletLine(
  finding: InsightFindingView,
  places: ReadonlyArray<{ id: string; name: string }>
): string | null {
  const names = staffPlaceNames(finding, places);
  if (names.length === 0) return null;
  if (names.length === 1) return `Named in reviews at ${names[0]}`;
  if (names.length <= 3) return `Named in reviews at ${names.join(", ")}`;
  return `Named in reviews at ${names.length} outlets`;
}

function staffOutletSentence(
  finding: InsightFindingView,
  places: ReadonlyArray<{ id: string; name: string }>,
  evidence: { rows: FindingEvidenceRow[]; total: number; page: number } | null
): string | null {
  if (finding.category !== "staff_mention") return null;
  const byId = new Map(places.map((place) => [place.id, place.name]));
  const rows = evidence?.rows ?? [];
  const complete = evidence != null && evidence.page === 0 && evidence.total > 0 && rows.length >= evidence.total;
  if (complete) {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.locationId, (counts.get(row.locationId) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (byId.get(a[0]) ?? "").localeCompare(byId.get(b[0]) ?? ""));
    const topName = byId.get(ranked[0][0]) ?? "one outlet";
    if (ranked.length === 1) return `Manage this at ${topName}. Every review that names this person was written there.`;
    const rest = ranked.slice(1);
    if (rest.every(([, count]) => count === 1)) {
      const others = rest.map(([id, count]) => `${byId.get(id) ?? "another outlet"} (${count})`).join(", ");
      return `Manage this at ${topName}. ${ranked[0][1]} reviews were written there. ${others} only adds the name; check that review before treating it as a second workplace.`;
    }
    const parts = ranked.map(([id, count]) => `${byId.get(id) ?? "an outlet"} (${count})`);
    return `Start at the outlet with the most of these reviews: ${parts.join(", ")}.`;
  }
  const names = finding.locationIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
  if (names.length === 1) return `Manage this at ${names[0]}. The reviews that name this person were written there.`;
  if (names.length > 1) return `These reviews were written at ${names.join(", ")}. Manage the outlet the sentences keep naming.`;
  return null;
}

function isBucketFinding(finding: InsightFindingView): boolean {
  return /^other\b/i.test(finding.title);
}

function nameTheOutlet(
  finding: InsightFindingView,
  places: ReadonlyArray<{ id: string; name: string }>
): InsightFindingView {
  if (finding.locationIds.length !== 1) return finding;
  const name = places.find((place) => place.id === finding.locationIds[0])?.name;
  if (!name) return finding;
  const title = finding.title.replaceAll("one outlet", name);
  const explanation = finding.explanation.replaceAll("one outlet", name).replaceAll("this outlet", name);
  if (title === finding.title && explanation === finding.explanation) return finding;
  return { ...finding, title, explanation };
}

function topicLabel(title: string): string {
  const cut = title.split(/ shows up | mentions | is weaker | appears | is rare|:| complaints| rose /i)[0]?.trim();
  return cut && cut.length > 0 && cut.toLowerCase() !== "other" ? cut : title;
}

const ATTENTION_RANK: Partial<Record<InsightFindingView["category"], number>> = {
  rating_drag: 0,
  rare_severe: 1,
  location_drag: 2,
  fan_friction: 3,
  anomaly: 4,
  emerging_topic: 5,
  recurring_issue: 6,
};

function pickAttention(findings: readonly InsightFindingView[]): InsightFindingView[] {
  const byTopic = new Map<string, InsightFindingView>();
  for (const finding of findings) {
    if (ATTENTION_RANK[finding.category] === undefined) continue;
    const key = topicLabel(finding.title).toLowerCase();
    const existing = byTopic.get(key);
    if (!existing) {
      byTopic.set(key, finding);
      continue;
    }
    const quoted = (item: InsightFindingView) => /“/.test(item.explanation);
    if (quoted(finding) && !quoted(existing)) {
      byTopic.set(key, finding);
      continue;
    }
    if (quoted(existing) && !quoted(finding)) continue;
    const existingRank = ATTENTION_RANK[existing.category] ?? 9;
    const nextRank = ATTENTION_RANK[finding.category] ?? 9;
    if (nextRank < existingRank) byTopic.set(key, finding);
  }
  const ranked = [...byTopic.values()]
    .filter((finding) => !/no stated complaint/i.test(finding.title))
    .sort((a, b) => {
      const quote = (finding: InsightFindingView) => /“/.test(finding.explanation) ? 0 : 1;
      return quote(a) - quote(b) || b.evidenceCount - a.evidenceCount || (ATTENTION_RANK[a.category] ?? 9) - (ATTENTION_RANK[b.category] ?? 9);
    });
  const top = ranked.slice(0, 4);
  const severeSingle = ranked.find((finding) => finding.evidenceCount === 1 && metricValue(finding, "low_star_reviews") >= 1);
  if (severeSingle && !top.some((finding) => finding.key === severeSingle.key) && top.length === 4) top[3] = severeSingle;
  return top;
}

function complaintKind(finding: InsightFindingView): string {
  if (/no stated complaint/i.test(finding.title)) return "Unexplained";
  if (finding.evidenceCount === 1 && finding.category === "recurring_issue") return "One visit";
  return KIND_LABEL[finding.category] ?? "Complaint";
}

function singleOutlet(finding: InsightFindingView, places: ReadonlyArray<{ id: string; name: string }>): string | null {
  if (finding.locationIds.length !== 1) return null;
  return places.find((place) => place.id === finding.locationIds[0])?.name ?? null;
}

function staffDisplayName(finding: InsightFindingView): string {
  const match = finding.title.match(/"([^"]+)"/);
  return match?.[1] ?? finding.title;
}

function standoutFromFindings(findings: readonly InsightFindingView[]): { highlights: string[]; risks: string[] } {
  const praise = findings
    .filter((finding) => finding.category === "positive_driver" && finding.evidenceCount >= 20)
    .slice(0, 4);
  const risks = findings
    .filter((finding) => finding.category === "rating_drag" || finding.category === "rare_severe" || finding.category === "recurring_issue" || isUnhappyStaff(finding))
    .filter((finding) => topicLabel(finding.title).toLowerCase() !== "other")
    .sort((a, b) => b.evidenceCount - a.evidenceCount)
    .slice(0, 4);
  return {
    highlights: praise.map(
      (finding) => `${topicLabel(finding.title)} — praised in ${finding.evidenceCount.toLocaleString("en-US")} reviews`
    ),
    risks: risks.map((finding) => finding.title),
  };
}

function monthLabel(month: string): string {
  const [year, raw] = month.slice(0, 7).split("-");
  const index = Number(raw) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!year || index < 0 || index > 11) return month.slice(0, 7);
  return `${names[index]} ${year.slice(2)}`;
}

function leadInsights(
  synthesis: ReadonlyArray<{ title: string; summary: string; keys: readonly string[] }>,
  findings: readonly InsightFindingView[]
): Array<{ title: string; summary: string; kind: string; findingKey: string | null; evidenceCount: number | null }> {
  const used = new Set<string>();
  const fromSynthesis = synthesis.map((item) => {
    const cited = item.keys
      .map((key) => findings.find((finding) => finding.key === key))
      .filter((finding): finding is InsightFindingView => Boolean(finding));
    const primary = cited.find(isNegativeFinding) ?? cited[0] ?? null;
    if (primary) used.add(primary.key);
    return {
      title: item.title,
      summary: item.summary,
      kind: primary ? KIND_LABEL[primary.category] ?? "Insight" : "Insight",
      findingKey: primary?.key ?? null,
      evidenceCount: primary?.evidenceCount ?? null,
      negative: cited.some(isNegativeFinding),
    };
  });
  const extras = findings
    .filter(isNegativeFinding)
    .filter((finding) => !used.has(finding.key))
    .sort(compareFindings)
    .slice(0, 4)
    .map((finding) => ({
      title: finding.title,
      summary: finding.explanation,
      kind: KIND_LABEL[finding.category] ?? "Insight",
      findingKey: finding.key,
      evidenceCount: finding.evidenceCount,
      negative: true,
    }));
  return [...fromSynthesis.filter((item) => item.negative), ...extras, ...fromSynthesis.filter((item) => !item.negative)].slice(0, 4);
}

function themeBars(
  risks: readonly string[],
  findings: readonly InsightFindingView[]
): Array<{ label: string; count: number }> {
  const parsed = risks.flatMap((line) => {
    const match = line.match(/^(.+?)\s*[—:]\s*(?:praised in |complaints in )?([\d,]+)\s+reviews/i);
    if (!match) return [];
    const count = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(count) || count <= 0) return [];
    const label = match[1].replace(/ — (?:praised|complaints) in$/i, "").trim();
    if (label.toLowerCase() === "other") return [];
    return [{ label, count }];
  });
  const rows = parsed.length > 0
    ? parsed
    : findings
        .filter((finding) => NEGATIVE_CATEGORIES.has(finding.category) && finding.evidenceCount > 0)
        .map((finding) => ({ label: topicLabel(finding.title), count: finding.evidenceCount }));
  // One topic can be a rating drag and an outlet gap. Keep the larger count.
  const byLabel = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const key = row.label.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing || row.count > existing.count) byLabel.set(key, row);
  }
  return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 6);
}

function findingHref(query: string, key: string, page = 0): string {
  const params = new URLSearchParams(query);
  params.set("finding", key);
  if (page > 0) params.set("evidencePage", String(page));
  else params.delete("evidencePage");
  const text = params.toString();
  return text ? `/insights?${text}` : "/insights";
}
