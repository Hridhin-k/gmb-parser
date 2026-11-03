import Link from "next/link";
import { Check, CircleAlert, Sparkles } from "lucide-react";
import { InsightAssign, type AssignableMember } from "@/components/insight-assign";
import type { DivergingRow, HeatStep, TopicTrend } from "@/lib/insight-mood";
import type { InsightSevereIncident } from "@/lib/insight-dashboard";
import type { NextAction, ShortVersion, TakeawayKind } from "@/lib/insight-report";
import { severityLabel } from "@/lib/review-intelligence";

/**
 * Server-rendered pieces of the Insights page. Every number comes from the
 * counts the page already loaded; AI wording is marked as AI.
 */

export function SentimentDonut({
  positive,
  negative,
  centerLabel = "positive",
}: {
  positive: number;
  negative: number;
  /** Word under the percent. Overview uses "praise" so it is not read as the 4–5★ share. */
  centerLabel?: string;
}) {
  const total = positive + negative;
  const pct = total > 0 ? Math.round((positive / total) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (pct / 100) * c;
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={`${pct}% of praise and complaint mentions are ${centerLabel}`}>
      <svg viewBox="0 0 128 128" className="h-36 w-36 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#EEF0F3" strokeWidth="13" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="#15803D"
          strokeWidth="13"
          strokeLinecap="butt"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{pct}%</span>
        <span className="text-[11px] font-medium text-ink-3">{centerLabel}</span>
      </div>
    </div>
  );
}

const CARD = "rounded-2xl border border-line bg-white p-4 sm:p-6";
const WORSE_TEXT = "text-[#c2410c]";

const TAKEAWAY: Record<TakeawayKind, { label: string; tone: string; Icon: typeof Check }> = {
  good: { label: "Going well", tone: "text-ok", Icon: Check },
  fix_first: { label: "Fix first", tone: WORSE_TEXT, Icon: CircleAlert },
  fix_next: { label: "Fix next", tone: WORSE_TEXT, Icon: CircleAlert },
};

/** "The short version": one sentence and up to three takeaway cards. */
export function ShortVersionCard({
  short,
  takeawayHref,
  footer,
}: {
  short: ShortVersion;
  takeawayHref: (index: number) => string | null;
  footer?: React.ReactNode;
}) {
  return (
    <section aria-label="The short version" className={`flex flex-col gap-5 ${CARD}`}>
      <div className="flex flex-col gap-2.5">
        <span
          className={`inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-[3px] text-xs font-semibold ${
            short.source === "ai" ? "bg-ai-tint text-ai" : "bg-line-2 text-ink-2"
          }`}
        >
          <Sparkles aria-hidden className="size-3" />
          The short version
          {short.source === "ai" ? <span className="sr-only"> (written by AI)</span> : null}
        </span>
        <p className="max-w-[860px] text-lg font-medium leading-normal tracking-[-0.01em] text-ink sm:text-xl">
          {short.sentence.map((part, index) =>
            part.problem ? (
              <span key={index} className={`font-semibold ${WORSE_TEXT}`}>
                {part.text}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </p>
      </div>
      {short.takeaways.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {short.takeaways.map((takeaway, index) => {
            const kind = TAKEAWAY[takeaway.kind];
            const href = takeawayHref(index);
            return (
              <div key={`${takeaway.kind}-${index}`} className="flex flex-col gap-2 rounded-xl border border-line-2 bg-[#f8f9fb] p-4">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${kind.tone}`}>
                  <kind.Icon aria-hidden className="size-[13px]" strokeWidth={2.25} />
                  {kind.label}
                </span>
                <span className="text-[15px] font-semibold leading-snug text-ink">{takeaway.title}</span>
                <span className="text-[13px] leading-normal text-ink-2">{takeaway.body}</span>
                {href && takeaway.reviews > 0 ? (
                  <Link href={href} className="mt-auto text-[13px] font-medium text-brand hover:text-brand-hover">
                    {takeaway.topic
                      ? `See ${takeaway.reviews.toLocaleString()} ${takeaway.reviews === 1 ? "review" : "reviews"}`
                      : "See an example review"}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {footer ? <div className="border-t border-line-2 pt-4">{footer}</div> : null}
    </section>
  );
}

/** "What to do next": suggested actions from the AI report, each assignable. */
export function NextActionsCard({
  actions,
  assignments,
  members,
  canAssign,
  empty,
}: {
  actions: NextAction[];
  assignments: Record<string, string>;
  members: AssignableMember[];
  canAssign: boolean;
  empty: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-[999_1_460px] flex-col gap-3.5 rounded-[14px] border border-line bg-white p-5">
      <h2 className="text-[15px] font-semibold text-ink">What to do next</h2>
      {actions.length === 0 ? (
        <div className="text-[13px] text-ink-3">{empty}</div>
      ) : (
        <ol className="flex flex-col">
          {actions.map((action, index) => (
            <li key={action.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 border-t border-line-2 py-3.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-bold text-brand">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                <span className="text-sm font-semibold text-ink">{action.title}</span>
                <span className="text-[13px] leading-normal text-ink-2">{action.why}</span>
              </span>
              <InsightAssign
                actionId={action.id}
                title={action.title}
                members={members}
                assigneeId={assignments[action.id] ?? null}
                canAssign={canAssign}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** "Worth checking": serious claims to verify, and staff customers name. */
export function WorthChecking({
  incidents,
  staff,
  hrefFor,
  locationLabel,
}: {
  incidents: InsightSevereIncident[];
  staff: Array<{ name: string; count: number }>;
  hrefFor: (excerpt: string) => string;
  locationLabel: string;
}) {
  return (
    <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[14px] border border-line bg-white p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold text-ink">Worth checking</h2>
        <span className="text-xs leading-[1.45] text-ink-3">
          Serious claims from customers. Verify before acting — they are not proven facts.
        </span>
      </div>
      {incidents.length === 0 ? (
        <p className="text-[13px] text-ink-3">No serious claims in this period.</p>
      ) : (
        incidents.slice(0, 3).map((incident, index) => (
          <Link
            key={`${incident.reviewId}-${index}`}
            href={hrefFor(incident.evidenceExcerpt)}
            className="flex flex-col gap-1 rounded-[10px] border border-warn-line bg-[#fffaf3] p-3 text-ink hover:border-warn"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-warn">
              <CircleAlert aria-hidden className="size-3" strokeWidth={2.5} />
              {(() => {
                const label = severityLabel(incident.severity);
                return label.charAt(0).toUpperCase() + label.slice(1);
              })()}
              {incident.severity ? ` · ${incident.severity}/5` : ""}
            </span>
            <span className="line-clamp-3 text-sm font-medium">“{incident.evidenceExcerpt}”</span>
            <span className="text-xs text-ink-3">
              {locationLabel} · {incident.starRating}★
              {incident.reviewCreateTime
                ? ` · ${new Date(incident.reviewCreateTime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                : ""}
            </span>
          </Link>
        ))
      )}
      <div className="mt-1 flex flex-col gap-2 border-t border-line-2 pt-3">
        <span className="text-[13px] font-semibold text-ink">Staff customers name</span>
        {staff.length === 0 ? (
          <span className="text-[13px] text-ink-3">No staff named in this period.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {staff.map((person) => (
              <span key={person.name} className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand">
                {person.name} · {person.count}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- Topics tab ---------------- */

export interface TopicQuote {
  excerpt: string;
  href: string;
  sentiment: "positive" | "negative";
  stars: number;
  createdAt: string;
  place: string;
}

export interface TopicDetail {
  topic: string;
  label: string;
  praise: number;
  complaints: number;
  reviews: number;
  trend: TopicTrend | null;
  where: Array<{ name: string; count: number }>;
  quotes: TopicQuote[];
  /** Every mention, when "Open N reviews" was used. */
  allQuotes: TopicQuote[] | null;
  toggleAllHref: string;
}

/** Diverging bars, complaints left and praise right, plus the picked topic. */
export function TopicsTab({
  rows,
  selected,
  hrefFor,
  detail,
}: {
  rows: DivergingRow[];
  selected: string | null;
  hrefFor: (topic: string) => string;
  detail: TopicDetail | null;
}) {
  if (rows.length === 0) {
    return <p className="rounded-[14px] border border-line bg-white p-8 text-center text-[13px] text-ink-3">No topics in this period yet.</p>;
  }
  const good = detail ? detail.praise >= detail.complaints : true;
  const trendText = detail?.trend
    ? detail.trend.status === "worse"
      ? "getting worse"
      : detail.trend.status === "better"
        ? "getting better"
        : "steady"
    : null;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 rounded-[14px] border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold text-ink">Topics customers mention</h2>
            <span className="text-[13px] text-ink-3">Complaints to the left, praise to the right. Pick a topic.</span>
          </div>
          <div className="flex gap-3.5 text-xs text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-[#c2410c]" />
              Complaints
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-brand" />
              Praise
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const on = row.topic === selected;
            return (
              <Link
                key={row.topic}
                href={hrefFor(row.topic)}
                aria-current={on ? "true" : undefined}
                aria-label={`${row.label}: ${row.complaints} complaints, ${row.praise} praise`}
                className={`grid min-h-11 grid-cols-[76px_minmax(0,1fr)_2px_minmax(0,1fr)] items-center gap-1.5 rounded-[10px] px-2 py-1.5 sm:grid-cols-[minmax(110px,150px)_minmax(0,1fr)_2px_minmax(0,1fr)] sm:gap-2.5 sm:px-2.5 ${
                  on ? "bg-[#f1f4fd]" : "hover:bg-paper"
                }`}
              >
                <span className={`line-clamp-2 text-[13px] leading-tight text-ink sm:line-clamp-1 sm:text-sm ${on ? "font-semibold" : "font-medium"}`}>{row.label}</span>
                <span className="flex items-center justify-end gap-1.5 text-xs tabular-nums text-ink-2" aria-hidden>
                  {row.complaints}
                  <span className="h-3.5 rounded-l bg-[#c2410c]" style={{ width: `${row.complaintWidth}%` }} />
                </span>
                <span className="h-6 bg-[#c3c9d3]" aria-hidden />
                <span className="flex items-center gap-1.5 text-xs tabular-nums text-ink-2" aria-hidden>
                  <span className="h-3.5 rounded-r bg-brand" style={{ width: `${row.praiseWidth}%` }} />
                  {row.praise}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {detail ? (
        <aside
          id="topic-detail"
          aria-label={`${detail.label} in detail`}
          className="flex min-w-0 flex-[1_1_340px] scroll-mt-24 flex-col gap-4 rounded-[14px] border border-line bg-white p-5"
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">Topic</span>
            <h2 className="text-xl font-bold text-ink">{detail.label}</h2>
            <span className="text-[13px] text-ink-2">
              {(detail.praise + detail.complaints).toLocaleString()} mentions
              {trendText ? (
                <>
                  {" · "}
                  <span
                    className={`font-medium ${
                      detail.trend?.status === "worse" ? WORSE_TEXT : detail.trend?.status === "better" ? "text-ok" : "text-ink-3"
                    }`}
                  >
                    {trendText}
                  </span>
                </>
              ) : null}
            </span>
          </div>
          <p className="text-sm leading-[1.55] text-ink">
            {detail.complaints.toLocaleString()} {detail.complaints === 1 ? "complaint" : "complaints"} and {detail.praise.toLocaleString()}{" "}
            praise in {detail.reviews.toLocaleString()} {detail.reviews === 1 ? "review" : "reviews"}
            {detail.trend?.now !== null && detail.trend?.now !== undefined ? `, ${detail.trend.now}% happy in the latest month` : ""}.
            {detail.where[0] ? ` It comes up most at ${detail.where[0].name}.` : ""}
          </p>
          {detail.where.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-ink">Where it comes up most</span>
              {detail.where.map((place) => (
                <div key={place.name} className="flex items-center gap-2.5 text-[13px]">
                  <span className="min-w-0 flex-auto truncate text-ink">{place.name}</span>
                  <span className="h-2 w-[90px] shrink-0 overflow-hidden rounded-full bg-line-2">
                    <span
                      className={`block h-2 rounded-full ${good ? "bg-brand" : "bg-[#c2410c]"}`}
                      style={{ width: `${Math.round((place.count / Math.max(1, detail.where[0].count)) * 100)}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right tabular-nums text-ink">{place.count}</span>
                </div>
              ))}
            </div>
          ) : null}
          {detail.quotes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-ink">In their words</span>
              {detail.quotes.map((quote, index) => (
                <Link
                  key={index}
                  href={quote.href}
                  className="rounded-lg bg-paper px-3 py-2.5 text-[13px] leading-normal text-ink-2 hover:bg-line-2"
                >
                  <span className="sr-only">{quote.sentiment === "positive" ? "Praise: " : "Complaint: "}</span>“{quote.excerpt}”
                </Link>
              ))}
            </div>
          ) : null}
          <Link
            href={detail.toggleAllHref}
            className="inline-flex h-10 items-center self-start rounded-full bg-ink px-[18px] text-sm font-semibold text-white hover:bg-graphite"
          >
            {detail.allQuotes
              ? "Hide the reviews"
              : `Open ${detail.reviews.toLocaleString()} ${detail.reviews === 1 ? "review" : "reviews"}`}
          </Link>
          {detail.allQuotes ? (
            <ul className="flex flex-col gap-2 border-t border-line-2 pt-3">
              {detail.allQuotes.map((quote, index) => (
                <li key={index}>
                  <Link href={quote.href} className="flex flex-col gap-1 rounded-lg border border-line-2 p-3 hover:border-brand-line">
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
                      <span className={`font-semibold ${quote.sentiment === "positive" ? "text-brand" : WORSE_TEXT}`}>
                        {quote.sentiment === "positive" ? "Praise" : "Complaint"}
                      </span>
                      · {quote.stars}★ · {new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} ·{" "}
                      {quote.place}
                    </span>
                    <span className="text-[13px] leading-normal text-ink-2">“{quote.excerpt}”</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

/* ---------------- Locations tab ---------------- */

const HEAT: Record<HeatStep, { bg: string; ink: string; label: string }> = {
  [-2]: { bg: "#c2410c", ink: "#ffffff", label: "Very negative" },
  [-1]: { bg: "#f6b48d", ink: "#14181f", label: "Negative" },
  [0]: { bg: "#eef0f3", ink: "#14181f", label: "Mixed" },
  [1]: { bg: "#a9bdf3", ink: "#14181f", label: "Positive" },
  [2]: { bg: "#1f4ed8", ink: "#ffffff", label: "Very positive" },
};

export interface HeatmapRowView {
  locationId: string;
  name: string;
  rating: number | null;
  cells: Array<{ topic: string; score: number | null; step: HeatStep | null; mentions: number }>;
}

/** Locations × topics on a five-step diverging scale. */
export function LocationHeatmap({
  topics,
  rows,
  note,
}: {
  topics: Array<{ topic: string; label: string }>;
  rows: HeatmapRowView[];
  note: string | null;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold text-ink">Each location, topic by topic</h2>
          <span className="text-[13px] text-ink-3">
            How positive reviews are about each topic, from −100 to +100. Blank means too few mentions.
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-2" role="img" aria-label="Scale from negative to positive in five steps">
          <span>Negative</span>
          {([-2, -1, 0, 1, 2] as HeatStep[]).map((step) => (
            <span key={step} className="h-3 w-[18px] rounded-[3px]" style={{ background: HEAT[step].bg }} title={HEAT[step].label} />
          ))}
          <span>Positive</span>
        </div>
      </div>
      {rows.length === 0 || topics.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-3">Not enough topic mentions per location in this period yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-[13px]" style={{ minWidth: `${132 + topics.length * 88 + 60}px` }}>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-xs font-medium text-ink-3">
                  Location
                </th>
                {topics.map((topic) => (
                  <th key={topic.topic} scope="col" className="px-1 py-1.5 text-center text-xs font-medium text-ink-3">
                    {topic.label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 text-right text-xs font-medium text-ink-3">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.locationId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-[132px] min-w-[132px] bg-white p-2 text-left font-medium leading-snug text-ink sm:w-auto sm:min-w-[180px]"
                  >
                    {row.name}
                  </th>
                  {row.cells.map((cell) => {
                    const look = cell.step === null ? null : HEAT[cell.step];
                    return (
                      <td
                        key={cell.topic}
                        title={
                          cell.score === null
                            ? `Too few mentions (${cell.mentions})`
                            : `${look?.label}: ${cell.score > 0 ? "+" : ""}${cell.score} from ${cell.mentions} mentions`
                        }
                        className="h-11 min-w-[84px] rounded-md text-center font-semibold tabular-nums"
                        style={look ? { background: look.bg, color: look.ink } : { background: "#ffffff", color: "#687283" }}
                      >
                        {cell.score === null ? (
                          <span className="sr-only">Too few mentions</span>
                        ) : (
                          `${cell.score > 0 ? "+" : cell.score < 0 ? "−" : ""}${Math.abs(cell.score)}`
                        )}
                      </td>
                    );
                  })}
                  <td className="p-2 text-right font-semibold tabular-nums text-ink">{row.rating === null ? "—" : row.rating.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note ? <p className="rounded-[10px] bg-[#f8f9fb] px-3.5 py-3 text-[13px] leading-[1.55] text-ink-2">{note}</p> : null}
    </section>
  );
}
