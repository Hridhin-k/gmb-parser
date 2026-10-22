import { ActivityStatus } from "@/components/activity-status";
import type { DateRange } from "@/lib/date-range";
import { loadPeriodGeminiInsight } from "@/lib/services/period-gemini-insight";

const TONE_LABEL = {
  praise: "Praise",
  problem: "Problem",
  watch: "Watch",
} as const;

const TONE_CLASS = {
  praise: "text-[#047857]",
  problem: "text-negative",
  watch: "text-[#b45309]",
} as const;

export function PeriodGeminiInsightFallback() {
  return (
    <ActivityStatus
      tone="gemini"
      title="Reading reviews in this period…"
      detail="Gemini is reading the latest reviews for the selected organisation, group, or outlet."
    />
  );
}

export async function PeriodGeminiInsight(props: {
  workspaceId: string;
  locationIds: string[];
  places: Array<{ id: string; name: string }>;
  range: DateRange;
  scopeTitle: string;
}) {
  const view = await loadPeriodGeminiInsight(props);
  if (view.status === "empty") {
    return (
      <section className="mb-4 rounded-2xl border border-silver bg-white px-5 py-4 text-sm text-slate">
        {view.scopeTitle} has no reviews in {view.periodLabel}.
      </section>
    );
  }
  if (view.status !== "ready") {
    return (
      <section className="mb-4 rounded-2xl border border-silver bg-white px-5 py-4 text-sm text-graphite">{view.notice}</section>
    );
  }
  const sample = view.capped
    ? `Latest ${view.sampleSize} reviews in ${view.periodLabel}. Gemini reads 100 at most.`
    : `All ${view.sampleSize} review${view.sampleSize === 1 ? "" : "s"} in ${view.periodLabel}.`;

  return (
    <section className="mb-4 rounded-2xl border border-[#dbe4f0] bg-white p-5 shadow-[0_1px_2px_rgba(15,39,79,0.04)] sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#2563eb]">Gemini · {view.periodLabel}</p>
      <h2 className="mt-2 max-w-3xl font-heading text-2xl leading-snug text-ink">{view.headline}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-graphite">{view.summary}</p>
      <p className="mt-2 text-xs text-slate">{sample} Temporary reading. Reviewer names are not sent.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {view.insights.map((insight, index) => (
          <article key={`${index}-${insight.title}`} className="rounded-xl border border-silver px-4 py-3">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${TONE_CLASS[insight.tone]}`}>{TONE_LABEL[insight.tone]}</p>
            <h3 className="mt-1 font-heading text-base text-ink">{insight.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-graphite">{insight.detail}</p>
          </article>
        ))}
      </div>
      {view.actions.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate">What to do next</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {view.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
