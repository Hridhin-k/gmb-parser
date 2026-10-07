"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Star,
  Sparkles,
  AlertCircle,
  RefreshCw,
  X,
  Palette,
  Users,
  MessageCircleHeart,
  Wrench,
  Lightbulb,
  PenLine,
} from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import type { ProfileRow } from "@/lib/services/dashboard";
import { locationPlaceLabel } from "@/lib/ui/location-place";
import type {
  LocationInsight,
  ProfileAnalysis,
  SuggestedFeature,
} from "@/lib/services/location-insights";
import { Spinner } from "@/components/ui/spinner";

const SENTIMENT_STYLES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-100",
  mixed: "bg-amber-50 text-amber-800 border-amber-100",
  negative: "bg-red-50 text-red-700 border-red-100",
  neutral: "bg-paper text-ink border-silver",
};

const EFFORT: Record<SuggestedFeature["effort"], string> = {
  quick: "bg-green-50 text-green-700",
  medium: "bg-yellow-50 text-yellow-800",
  project: "bg-paper text-ink",
};

const JAKARTA = { fontFamily: "var(--font-heading), sans-serif" };

interface ProfileInsightPanelProps {
  profile: ProfileRow;
  insight: LocationInsight | null;
  heuristicSummary: string | null;
}

function BulletList({ items, tone = "default" }: { items: string[]; tone?: "default" | "good" | "bad" }) {
  if (items.length === 0) return null;
  const dot =
    tone === "good" ? "bg-green-500" : tone === "bad" ? "bg-red-400" : "bg-silver";
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[13px] leading-snug text-graphite">
          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function InsightCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Palette;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-silver bg-paper p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-ink" aria-hidden />
        <h3 className="text-sm font-semibold text-graphite">{title}</h3>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function AnalysisGrid({ analysis }: { analysis: ProfileAnalysis }) {
  const { branding, staff, customerFeedback, operations, suggestedFeatures, replyPlaybook } =
    analysis;

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <InsightCard icon={Palette} title="Branding">
          {branding.voice ? (
            <p className="text-[13px] font-light leading-relaxed text-graphite">{branding.voice}</p>
          ) : null}
          {branding.strengths.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Strengths
              </p>
              <BulletList items={branding.strengths} tone="good" />
            </>
          ) : null}
          {branding.gaps.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Gaps
              </p>
              <BulletList items={branding.gaps} tone="bad" />
            </>
          ) : null}
        </InsightCard>

        <InsightCard icon={Users} title="Staff">
          {staff.summary ? (
            <p className="text-[13px] font-light leading-relaxed text-graphite">{staff.summary}</p>
          ) : (
            <p className="text-[13px] text-slate">Reviews don’t mention staff in enough detail yet.</p>
          )}
          <BulletList items={staff.praise} tone="good" />
          <BulletList items={staff.issues} tone="bad" />
        </InsightCard>

        <InsightCard icon={MessageCircleHeart} title="Customer feedback">
          {customerFeedback.loves.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Customers love
              </p>
              <BulletList items={customerFeedback.loves} tone="good" />
            </>
          ) : null}
          {customerFeedback.friction.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Friction
              </p>
              <BulletList items={customerFeedback.friction} tone="bad" />
            </>
          ) : null}
          {customerFeedback.requests.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Asked for
              </p>
              <BulletList items={customerFeedback.requests} />
            </>
          ) : null}
        </InsightCard>

        <InsightCard icon={Wrench} title="Operations">
          {operations.summary ? (
            <p className="text-[13px] font-light leading-relaxed text-graphite">{operations.summary}</p>
          ) : null}
          <BulletList items={operations.notes} />
        </InsightCard>
      </div>

      {suggestedFeatures.length > 0 ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-ink" aria-hidden />
            <h3 className="text-sm font-semibold text-graphite" style={JAKARTA}>
              Features to add for this profile
            </h3>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {suggestedFeatures.map((feature) => (
              <li
                key={feature.title}
                className="rounded-xl bg-white shadow-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-graphite">{feature.title}</p>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      EFFORT[feature.effort]
                    )}
                  >
                    {feature.effort}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-graphite">{feature.why}</p>
                {feature.basedOn ? (
                  <p className="mt-2 text-[12px] text-slate">From reviews: {feature.basedOn}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {replyPlaybook.tone || replyPlaybook.do.length > 0 ? (
        <InsightCard icon={PenLine} title="How to reply here">
          {replyPlaybook.tone ? (
            <p className="text-[13px] font-light leading-relaxed text-graphite">{replyPlaybook.tone}</p>
          ) : null}
          {replyPlaybook.do.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Do
              </p>
              <BulletList items={replyPlaybook.do} tone="good" />
            </>
          ) : null}
          {replyPlaybook.avoid.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">
                Avoid
              </p>
              <BulletList items={replyPlaybook.avoid} tone="bad" />
            </>
          ) : null}
        </InsightCard>
      ) : null}
    </div>
  );
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
  const rich = Boolean(
    active &&
      (active.analysis.suggestedFeatures.length > 0 ||
        active.analysis.branding.strengths.length > 0 ||
        active.analysis.customerFeedback.loves.length > 0)
  );

  function clearSelection() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("location");
    router.push(`${pathname}?${params.toString()}`);
  }

  function showUnanswered() {
    router.push(`/reviews?location=${profile.id}&filter=unanswered`);
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
      const data = (await res.json()) as { error?: string; insight?: LocationInsight };
      if (!res.ok) {
        setError(data.error ?? "Failed to generate insight");
        return;
      }
      if (data.insight) setLocal(data.insight);
      toast.success("Profile insights ready");
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="rounded-xl bg-white shadow-card p-5 sm:p-6"
      aria-labelledby="selected-profile-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">
            {profile.clientName ?? "Profile"}
          </p>
          <h2
            id="selected-profile-heading"
            className="mt-1 text-[22px] leading-[1.3] text-graphite sm:text-[26px]"
            style={JAKARTA}
          >
            {locationPlaceLabel({
              storeCode: profile.storeCode,
              address: profile.address,
            }) ?? profile.title}
          </h2>
          {profile.address ? (
            <p className="mt-1 text-sm leading-relaxed text-slate">
              {profile.address}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize",
              SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.neutral
            )}
          >
            {sentiment}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clearSelection}
            className="text-slate"
            aria-label="Clear profile selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-graphite">
        <span className="inline-flex items-center gap-1">
          <Star
            className={cn(
              "h-3.5 w-3.5",
              profile.avgRating == null
                ? "fill-silver text-silver"
                : profile.avgRating >= 4
                  ? "fill-green-500 text-green-500"
                  : profile.avgRating >= 3
                    ? "fill-yellow-400 text-yellow-500"
                    : "fill-red-500 text-red-500"
            )}
            aria-hidden
          />
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

      <p
        className={cn(
          "mt-4 text-[15px] font-light leading-relaxed text-graphite",
          loading && "opacity-40"
        )}
      >
        {summary}
      </p>

      {loading ? (
        <div className="mt-3">
          <ActivityStatus
            tone="gemini"
            title={`Gemini is reading ${profile.title}`}
            detail="It uses only this location’s reviews to summarise branding, staff, and what customers mention. The summary above stays until the new one is ready."
          />
        </div>
      ) : null}

      {(active?.themes?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {active!.themes.map((t) => (
            <span
              key={t}
              className="rounded-full bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
            >
              {t}
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
          disabled={loading || profile.reviewCount === 0}
          onClick={() => generate(Boolean(active))}
        >
          {loading ? (
            <Spinner size="sm" />
          ) : stale || !rich ? (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {loading ? "Gemini is reading reviews…" : !rich ? "Generate profile insights" : stale ? "Update insights" : "Refresh insights"}
        </Button>
        {stale && rich && (
          <span className="text-[11px] text-amber-600">Reviews changed — regenerate</span>
        )}
        <span className="text-[11px] text-slate">
          {loading
            ? "This usually takes a few seconds. You can leave the rest of the page as it is."
            : "Gemini reads this profile’s reviews only: branding, staff, feedback, and feature ideas."}
        </span>
      </div>
    </section>
  );
}
