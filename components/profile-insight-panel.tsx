"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Star,
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfileRow } from "@/lib/services/dashboard";
import type { LocationInsight } from "@/lib/services/location-insights";

const SENTIMENT_STYLES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-100",
  mixed: "bg-amber-50 text-amber-800 border-amber-100",
  negative: "bg-red-50 text-red-700 border-red-100",
  neutral: "bg-gray-50 text-gray-600 border-gray-100",
};

interface ProfileInsightPanelProps {
  profile: ProfileRow;
  insight: LocationInsight | null;
  heuristicSummary: string | null;
}

export function ProfileInsightPanel({
  profile,
  insight,
  heuristicSummary,
}: ProfileInsightPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocationInsight | null>(null);

  const active = local ?? insight;
  const summary = active?.summary ?? heuristicSummary ?? `${profile.title}: no summary yet.`;
  const sentiment = active?.sentimentLabel ?? "neutral";
  const stale = active?.stale ?? !active;

  function clearSelection() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("location");
    router.push(`${pathname}?${params.toString()}`);
  }

  function showUnanswered() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("location", profile.id);
    params.set("filter", "unanswered");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}#inbox`);
  }

  async function generate(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: profile.id, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate insight");
        return;
      }
      setLocal(data.insight);
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4"
      aria-labelledby="selected-profile-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400 truncate">
            {profile.clientName ?? "Profile"}
          </p>
          <h2
            id="selected-profile-heading"
            className="truncate text-[15px] font-semibold text-gray-900"
          >
            {profile.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
              SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral
            )}
          >
            {sentiment}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Clear profile selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-gray-600">
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
          {profile.avgRating != null ? profile.avgRating.toFixed(1) : "—"}
        </span>
        <span>{profile.reviewCount} reviews</span>
        {profile.unanswered > 0 && (
          <button
            type="button"
            onClick={showUnanswered}
            className="inline-flex items-center gap-1 font-medium text-orange-600 hover:underline"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            {profile.unanswered} need reply
          </button>
        )}
        {profile.critical > 0 && (
          <span className="text-red-600">{profile.critical} critical</span>
        )}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-gray-700">{summary}</p>

      {(active?.themes?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {active!.themes.map((t) => (
            <span
              key={t}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {(active?.risks?.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-1">
          {active!.risks.slice(0, 3).map((r) => (
            <li key={r} className="flex gap-1.5 text-[12px] text-red-700/90">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
              {r}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          disabled={loading || profile.reviewCount === 0}
          onClick={() => generate(Boolean(active) && stale)}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : active && !stale ? (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {active && !stale
            ? "Refresh AI summary"
            : stale && active
              ? "Update AI summary"
              : "Generate AI summary"}
        </Button>
        {stale && active && (
          <span className="text-[11px] text-amber-600">Out of date</span>
        )}
        <span className="text-[11px] text-gray-400">
          Insights generate only for the open profile (quota-safe).
        </span>
      </div>
    </section>
  );
}
