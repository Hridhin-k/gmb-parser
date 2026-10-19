"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Star, Sparkles, RefreshCw } from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AnalysisGrid } from "@/components/profile-insight-panel";
import type { ScopeInsight, ScopeInsightKind } from "@/lib/services/scope-insights";

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
  const router = useRouter();
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
    try {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKind, scopeId, force }),
      });
      const data = (await res.json()) as { error?: string; insight?: ScopeInsight };
      if (!res.ok) {
        setError(data.error ?? "Failed to generate insight");
        return;
      }
      if (data.insight) setLocal(data.insight);
      toast.success(`${kindLabel} insights ready`);
      router.refresh();
    } catch {
      setError("Unable to reach the server");
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
            title={`Gemini is reading ${title}`}
            detail={`It samples recent reviews from ${locationCount} location${locationCount === 1 ? "" : "s"} to summarise branding, staff, and customer themes for the whole ${scopeKind === "client" ? "organisation" : "group"}.`}
          />
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

      {error && (
        <p className="mt-3 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={loading || reviewCount === 0}
          onClick={() => generate(Boolean(active))}
        >
          {loading ? (
            <Spinner size="sm" />
          ) : stale || !rich ? (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {loading
            ? "Gemini is reading reviews…"
            : !rich
              ? `Generate ${kindLabel.toLowerCase()} insights`
              : stale
                ? "Update insights"
                : "Refresh insights"}
        </Button>
        {stale && rich && (
          <span className="text-[11px] text-amber-600">Reviews changed — regenerate</span>
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
