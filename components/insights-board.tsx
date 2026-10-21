"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { pollAiGeneration } from "@/lib/ai-generation-client";
import { FailureBanner, OperationStatus } from "@/components/status-banner";
import { ChartCard, CHART, HBarChart, SentimentDonut } from "@/components/charts";
import type { StarCounts } from "@/lib/metrics";
import { AnalysisGrid } from "@/components/profile-insight-panel";
import { ACTION_STATUS } from "@/lib/ui-status";
import type { ComplaintSample } from "@/lib/services/insight-evidence";
import type { ProfileAnalysis } from "@/lib/services/location-insights";

export interface SavedInsightView {
  summary: string;
  sentimentLabel: string;
  highlights: string[];
  risks: string[];
  suggestions: Array<{ title: string; why: string; basedOn: string }>;
  analysis: ProfileAnalysis | null;
  reviewCount: number;
  generatedAt: string;
  stale: boolean;
  evidenceLinks: Array<{ id: string; href: string; label: string }>;
  feedback?: { insightKind: "location" | "scope"; scopeId: string } | null;
}

export interface InsightContextFacts {
  avgRating: number | null;
  reviews: number;
  negativeShare: number | null;
  replyRate: number | null;
  positive: number;
  neutral: number;
  negative: number;
  themes: Array<{ label: string; count: number; stars?: StarCounts }>;
  stars?: StarCounts;
}

interface InsightsBoardProps {
  period: string;
  scopeTitle: string;
  reviewsHref: string;
  analyticsHref: string;
  settingsHref: string;
  facts: InsightContextFacts;
  samples: Array<ComplaintSample & { href: string }>;
  saved: SavedInsightView | null;
  modelUnavailable: string | null;
  generate: { locationId: string } | { scopeKind: "client" | "group"; scopeId: string } | null;
  hideContext?: boolean;
  /** The unified insight report renders the brief; hide the legacy brief section. */
  hideBrief?: boolean;
}

function stars(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function percent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function when(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function InsightsBoard(props: InsightsBoardProps) {
  const [localSaved, setLocalSaved] = useState<SavedInsightView | null>(null);
  const saved = localSaved ?? props.saved;
  const themeMax = Math.max(1, ...props.facts.themes.map((theme) => theme.count), 0);
  const threeStar = Math.max(0, props.facts.neutral);

  useEffect(() => {
    if (!localSaved || !props.saved) return;
    if (
      props.saved.summary === localSaved.summary &&
      props.saved.generatedAt === localSaved.generatedAt
    ) {
      setLocalSaved(null);
    }
  }, [props.saved, localSaved]);

  return (
    <div className="space-y-8">
      {props.hideContext ? null : (
      <section className="rounded-2xl border border-[#e6ebf2] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Context · {props.period}</p>
            <p className="mt-1 text-sm text-slate">
              {props.scopeTitle}. Counted from synced reviews for this scope. Full charts live in Analytics.
            </p>
          </div>
          <Link href={props.analyticsHref} className="text-sm font-medium text-[#163a7a] underline">
            See Analytics
          </Link>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Average rating" value={stars(props.facts.avgRating)} href={props.reviewsHref} />
          <Fact label="Reviews" value={props.facts.reviews.toLocaleString("en-US")} href={props.reviewsHref} />
          <Fact label="1–3★ share" value={percent(props.facts.negativeShare)} href={props.reviewsHref} />
          <Fact label="Reply rate" value={percent(props.facts.replyRate)} href={props.reviewsHref} />
        </dl>
      </section>
      )}

      {props.hideBrief ? null : (
      <section className="rounded-2xl border border-[#163a7a]/20 bg-[#f4f7fb] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg text-ink">AI brief</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate">
              Shaped by your saved insight lens and organisation instructions — not model training. Claims must come
              from synced reviews. Configure the lens in{" "}
              <Link href={props.settingsHref} className="underline">
                Settings → AI
              </Link>
              .
            </p>
          </div>
          {props.generate ? (
            <GenerateButton
              target={props.generate}
              savedAt={props.saved?.generatedAt ?? ""}
              onGenerated={setLocalSaved}
            />
          ) : null}
        </div>
        {props.modelUnavailable && !localSaved ? (
          <p className="mt-4 rounded-lg border border-[#e6ebf2] bg-white px-3 py-3 text-sm text-ink" role="status">
            {props.modelUnavailable}
          </p>
        ) : !saved ? (
          <p className="mt-4 text-sm text-ink">
            {props.generate
              ? "No model brief is saved for this scope yet. Generate one to interpret the counted evidence below."
              : "Choose an organisation, group, or outlet to generate a model brief."}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-xs text-[#5c6b82]">
              Saved {when(saved.generatedAt)} from {saved.reviewCount.toLocaleString("en-US")} reviews
              {saved.stale
                ? ". Reviews or the insight lens have changed since then, so regenerate for a current brief."
                : ". It still matches the reviews and lens used when it was saved."}
            </p>
            <p className="text-base text-ink">{saved.summary}</p>
            {saved.highlights.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">What stands out</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                  {saved.highlights.slice(0, 5).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {saved.risks.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Risks to watch</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                  {saved.risks.slice(0, 5).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {saved.suggestions.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Suggested next moves</p>
                <ul className="mt-1 space-y-2">
                  {saved.suggestions.slice(0, 4).map((item) => (
                    <li key={item.title} className="text-sm text-ink">
                      <span className="font-medium">{item.title}.</span> {item.why}
                      {item.basedOn ? ` Based on: ${item.basedOn}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {saved.analysis ? <AnalysisGrid analysis={saved.analysis} /> : null}
            {saved.evidenceLinks.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5c6b82]">Reviews the model cited</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {saved.evidenceLinks.slice(0, 8).map((link) => (
                    <li key={link.id}>
                      <Link href={link.href} className="text-sm text-[#163a7a] underline">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {saved.feedback ? <InsightFeedback target={saved.feedback} /> : null}
          </div>
        )}
      </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Sentiment in this period"
          hint="Counted from star ratings in the selected window — not written by the model."
        >
          {props.facts.reviews === 0 ? (
            <p className="text-sm text-slate">No reviews in this period.</p>
          ) : (
            <SentimentDonut
              positive={props.facts.positive}
              neutral={threeStar}
              negative={props.facts.negative}
              stars={props.facts.stars}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Complaint theme volume"
          hint="Keyword matches on 1–3 star reviews in this period. Open Analytics for the full matrix."
          action={
            <Link href={props.analyticsHref} className="text-sm text-[#163a7a] underline">
              Themes in Analytics
            </Link>
          }
        >
          {props.facts.themes.length === 0 ? (
            <p className="text-sm text-slate">No complaint keywords in this period.</p>
          ) : (
            <HBarChart
              max={themeMax}
              rows={props.facts.themes.slice(0, 8).map((theme) => ({
                label: theme.label,
                value: theme.count,
                color: CHART.rose,
                stars: theme.stars,
                lines: ["1–3 star reviews with this theme"],
              }))}
            />
          )}
        </ChartCard>
      </section>

      <section>
        <h2 className="font-heading text-lg text-ink">Supporting reviews</h2>
        <p className="mt-1 text-sm text-slate">
          Latest 1–3 star reviews with a comment in this scope and period. Evidence only — not model output.
        </p>
        {props.samples.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No commented low-star reviews in this window.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {props.samples.map((sample) => (
              <li key={sample.id} className="rounded-xl border border-[#e6ebf2] bg-white p-4">
                <p className="text-xs text-[#5c6b82]">
                  {sample.stars} star · {sample.locationName} · {when(sample.when)}
                  {sample.reviewer ? ` · ${sample.reviewer}` : ""}
                </p>
                <p className="mt-2 text-sm text-ink">{sample.comment}</p>
                <Link href={sample.href} className="mt-2 inline-block text-sm text-[#163a7a] underline">
                  Reviews for this outlet
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="rounded-xl border border-[#e6ebf2] px-3 py-3">
      <dt className="text-xs text-[#5c6b82]">{label}</dt>
      <dd className="mt-1 font-heading text-2xl text-ink">
        <Link href={href} className="hover:underline">
          {value}
        </Link>
      </dd>
    </div>
  );
}

function insightView(
  insight: {
    summary: string;
    sentimentLabel: string;
    highlights?: string[];
    risks?: string[];
    analysis: ProfileAnalysis;
    reviewCount: number;
    generatedAt: string;
    stale: boolean;
  },
  feedback: SavedInsightView["feedback"]
): SavedInsightView {
  return {
    summary: insight.summary,
    sentimentLabel: insight.sentimentLabel,
    highlights: insight.highlights ?? [],
    risks: insight.risks ?? [],
    suggestions: (insight.analysis?.suggestedFeatures ?? []).map((item) => ({
      title: item.title,
      why: item.why,
      basedOn: item.basedOn,
    })),
    analysis: insight.analysis,
    reviewCount: insight.reviewCount,
    generatedAt: insight.generatedAt,
    stale: insight.stale,
    evidenceLinks: (insight.analysis?.evidenceReviewIds ?? []).map((id, index) => ({
      id,
      href: `/reviews?review=${id}`,
      label: `Evidence ${index + 1}`,
    })),
    feedback,
  };
}

function GenerateButton({
  target,
  savedAt,
  onGenerated,
}: {
  target: { locationId: string } | { scopeKind: "client" | "group"; scopeId: string };
  savedAt: string;
  onGenerated: (view: SavedInsightView) => void;
}) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, savedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedback: SavedInsightView["feedback"] =
    "locationId" in target
      ? { insightKind: "location", scopeId: target.locationId }
      : { insightKind: "scope", scopeId: target.scopeId };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        loading={pending}
        onClick={() => {
          if (pending) return;
          setPending(true);
          setError(null);
          void (async () => {
            const post = async (preview: boolean) => {
              const response = await fetch("/api/insights/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...target, force: true, preview }),
              });
              const data = (await response.json().catch(() => ({}))) as {
                error?: string;
                insight?: Parameters<typeof insightView>[0];
              };
              if (!response.ok) throw new Error(data.error ?? "Could not generate the brief.");
              return data.insight;
            };
            try {
              try {
                const preview = await post(true);
                if (preview) onGenerated(insightView(preview, feedback));
              } catch {
                // Preview is optional; the full brief below is the saved result.
              }
              const insight = await post(false);
              if (insight) onGenerated(insightView(insight, feedback));
              if ((insight as { jobId?: string } | undefined)?.jobId) {
                const jobId = (insight as { jobId?: string }).jobId!;
                void pollAiGeneration(jobId).then((result) => {
                  if (result.status === "saved") refresh();
                  else setError("The brief above is on screen. Saving it in the background needs another try from the cron or a refresh.");
                });
              } else {
                refresh();
              }
            } catch (caught: unknown) {
              setError(caught instanceof Error ? caught.message : "Could not generate the brief.");
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        {pending ? ACTION_STATUS.aiInsight.short : "Generate AI brief"}
      </Button>
      {pending ? <OperationStatus copy={ACTION_STATUS.aiInsight} /> : null}
      {!pending && refreshing ? <OperationStatus copy={ACTION_STATUS.applying} /> : null}
      {error ? <FailureBanner title="Brief unavailable" detail={error} /> : null}
    </div>
  );
}

function InsightFeedback({ target }: { target: { insightKind: "location" | "scope"; scopeId: string } }) {
  const [sent, setSent] = useState<"useful" | "not_useful" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return <p className="text-xs text-slate">Thanks — recorded as {sent === "useful" ? "useful" : "not useful"}.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#5c6b82]">Was this brief useful?</p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["useful", "Useful"],
            ["not_useful", "Not useful"],
          ] as const
        ).map(([rating, label]) => (
          <Button
            key={rating}
            type="button"
            variant="outline"
            onClick={() => {
              setError(null);
              void fetch("/api/insights/feedback", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...target, rating }),
              })
                .then(async (response) => {
                  const data = (await response.json().catch(() => ({}))) as { error?: string };
                  if (!response.ok) throw new Error(data.error ?? "Could not save feedback.");
                  setSent(rating);
                })
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "Could not save feedback.")
                );
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {error ? <FailureBanner title="Feedback not saved" detail={error} /> : null}
    </div>
  );
}
