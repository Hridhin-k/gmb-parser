"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Star, Sparkles, RefreshCw } from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { AnalysisGrid } from "@/components/profile-insight-panel";
import type { ScopeInsight, ScopeInsightKind } from "@/lib/services/scope-insights";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { pollAiGeneration } from "@/lib/ai-generation-client";
import { ACTION_STATUS } from "@/lib/ui-status";

const SENTIMENT_STYLES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-100",
  mixed: "bg-amber-50 text-amber-800 border-amber-100",
  negative: "bg-red-50 text-red-700 border-red-100",
  neutral: "bg-paper text-ink border-silver",
};

const JAKARTA = { fontFamily: "var(--font-heading), sans-serif" };

interface ScopeInsightPanelProps {
  scopeKind: ScopeInsightKind;
  scopeId: string;
  title: string;
  locationCount: number;
  reviewCount: number;
  avgRating: number | null;
  insight: ScopeInsight | null;
  heuristicSummary: string;
}

export function ScopeInsightPanel({
  scopeKind,
  scopeId,
  title,
  locationCount,
  reviewCount,
  avgRating,
  insight,
  heuristicSummary,
}: ScopeInsightPanelProps) {
  const { pending: refreshing, refresh, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, insight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<ScopeInsight | null>(null);

  const active = local ?? insight;
  const summary = active?.summary ?? heuristicSummary;
  const sentiment = active?.sentimentLabel ?? "neutral";
  const stale = active?.stale ?? !active;
  const rich = Boolean(
    active &&
      (active.analysis.suggestedFeatures.length > 0 ||
        active.analysis.branding.strengths.length > 0 ||
        active.analysis.customerFeedback.loves.length > 0)
  );

  const kindLabel = scopeKind === "client" ? "Organisation" : "Group";

  async function generate(force = false) {
    setLoading(true);
    setError(null);
    const post = async (preview: boolean) => {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKind, scopeId, force, preview }),
      });
      const data = (await res.json()) as { error?: string; insight?: ScopeInsight };
      if (!res.ok) throw new Error(data.error ?? "Failed to generate insight");
      return data.insight;
    };
    try {
      try {
        const preview = await post(true);
        if (preview) setLocal(preview);
      } catch {
        // Preview is optional; the full brief below is the saved result.
      }
      const insight = await post(false);
      if (insight) setLocal(insight);
      toast.success(`${kindLabel} insights ready`);
      if (insight?.jobId) {
        const jobId = insight.jobId;
        void pollAiGeneration(jobId).then((result) => {
          if (result.status === "saved") refresh();
          else setError("The brief above is on screen. Its background save has not finished yet.");
        });
      } else {
        refresh();
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl bg-white shadow-card p-5 sm:p-6" aria-labelledby="scope-insight-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">
            {kindLabel} AI insight
          </p>
          <h2
            id="scope-insight-heading"
            className="mt-1 text-[22px] leading-[1.3] text-graphite sm:text-[26px]"
            style={JAKARTA}
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate">
            {locationCount} location{locationCount === 1 ? "" : "s"} · reads recent reviews across all of them
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize",
            SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral
          )}
        >
          {sentiment}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-graphite">
        <span className="inline-flex items-center gap-1">
          <Star
            className={cn(
              "h-3.5 w-3.5",
              avgRating == null
                ? "fill-silver text-silver"
                : avgRating >= 4
                  ? "fill-green-500 text-green-500"
                  : avgRating >= 3
                    ? "fill-yellow-400 text-yellow-500"
                    : "fill-red-500 text-red-500"
            )}
            aria-hidden
          />
          {avgRating != null ? avgRating.toFixed(1) : "—"}
        </span>
        <span>{reviewCount} reviews in sample</span>
      </div>

      <p className={cn("mt-4 text-[15px] font-light leading-relaxed text-graphite", loading && "opacity-40")}>
        {summary}
      </p>

      {loading ? (
        <div className="mt-3">
          <ActivityStatus
            tone="gemini"
            title="Analysing customer feedback…"
            detail={`Preparing a model interpretation for ${title} (${locationCount} location${locationCount === 1 ? "" : "s"}). The summary above stays until the new one is ready.`}
          />
        </div>
      ) : refreshing ? (
        <div className="mt-3">
          <ActivityStatus title={ACTION_STATUS.applying.title} detail={ACTION_STATUS.applying.detail} />
        </div>
      ) : null}

      {(active?.themes?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {active!.themes.map((theme) => (
            <span
              key={theme}
              className="rounded-full bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink"
            >
              {theme}
            </span>
          ))}
        </div>
      )}

      {rich && active ? <AnalysisGrid analysis={active.analysis} /> : null}

      {error ? (
        <p className="mt-3 text-[12px] text-red-600" role="alert">
          Insights couldn&apos;t be updated. {error} Counted data on this page stays available.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          loading={loading}
          disabled={reviewCount === 0}
          onClick={() => generate(Boolean(active))}
        >
          {!loading && (stale || !rich) ? (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          ) : null}
          {!loading && rich && !stale ? (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          ) : null}
          {loading
            ? "Analysing feedback…"
            : !rich
              ? `Generate ${kindLabel.toLowerCase()} insights`
              : stale
                ? "Update insights"
                : "Refresh insights"}
        </Button>
        {stale && rich && (
          <span className="text-[11px] text-amber-600">Reviews changed — this text is not current</span>
        )}
        <span className="text-[11px] text-slate">
          {reviewCount === 0
            ? "Sync reviews for these locations first."
            : "Gemini reads across every shop in this scope — not one location only."}
        </span>
      </div>
    </section>
  );
}
