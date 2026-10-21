"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OverviewInsightCard } from "@/lib/overview-board";
import { ActivityStatus } from "@/components/activity-status";
import { useServerRefresh, useSettleWhenUpdated } from "@/hooks/use-server-refresh";
import { pollAiGeneration } from "@/lib/ai-generation-client";
import { ACTION_STATUS } from "@/lib/ui-status";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "worse", label: "Getting worse" },
  { id: "improving", label: "Improving" },
] as const;

function Bars({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-8 items-end gap-0.5" aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          className="w-1.5 rounded-sm bg-[#163a7a]"
          style={{ height: `${Math.max(12, (value / max) * 100)}%`, opacity: index === values.length - 1 ? 1 : 0.35 }}
        />
      ))}
    </span>
  );
}

export function OverviewInsightFeed({
  cards,
  savedSummary,
  generate,
}: {
  cards: OverviewInsightCard[];
  savedSummary: string | null;
  generate: { scopeKind: "client" | "group"; scopeId: string } | null;
}) {
  const { pending: refreshing, refresh: refreshPage, settle } = useServerRefresh();
  useSettleWhenUpdated(refreshing, settle, savedSummary);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const summary = localSummary ?? savedSummary;

  useEffect(() => {
    setLocalSummary(null);
  }, [generate?.scopeId, generate?.scopeKind]);

  useEffect(() => {
    if (localSummary && savedSummary === localSummary) setLocalSummary(null);
  }, [savedSummary, localSummary]);
  const visible = filter === "all" ? cards : cards.filter((card) => card.tone === filter);
  const count = (id: (typeof FILTERS)[number]["id"]) =>
    id === "all" ? cards.length : cards.filter((card) => card.tone === id).length;

  async function generateInsight() {
    if (!generate) return;
    setPending(true);
    setError(null);
    const post = async (preview: boolean) => {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeKind: generate.scopeKind,
          scopeId: generate.scopeId,
          force: true,
          preview,
        }),
      });
      const payload = (await response.json()) as { error?: string; insight?: { summary?: string } };
      if (!response.ok) throw new Error(payload.error ?? "Could not generate an insight.");
      return payload.insight;
    };
    try {
      try {
        const preview = await post(true);
        if (preview?.summary) setLocalSummary(preview.summary);
      } catch {
        // Preview is optional; the full brief below is the saved result.
      }
      const insight = await post(false);
      if (insight?.summary) setLocalSummary(insight.summary);
      const jobId = (insight as { jobId?: string } | undefined)?.jobId;
      if (jobId) {
        void pollAiGeneration(jobId).then((result) => {
          if (result.status === "saved") refreshPage();
          else setError("The summary above is on screen. Its background save has not finished yet.");
        });
      } else {
        refreshPage();
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not generate an insight.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs ${filter === item.id ? "border-[#163a7a] bg-[#163a7a] text-white" : "border-[#e6ebf2] bg-white text-graphite"}`}
          >
            {item.label} ({count(item.id)})
          </button>
        ))}
      </div>
      {summary ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">Saved insight</p>
          <p className="mt-1 text-sm leading-6 text-graphite">{summary}</p>
          <p className="mt-1 text-xs text-slate">Generated for this organisation or group. It is not limited to the date range.</p>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-slate">
          {cards.length === 0 ? "Nothing in this period stands out from the review totals." : "Nothing in this group."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[#eef2f7]">
          {visible.map((card) => (
            <li key={card.id} className="flex items-start gap-3 py-3">
              <Bars values={card.bars} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">{card.kicker}</p>
                <p className="mt-1 text-sm font-medium text-graphite">{card.title}</p>
                <p className="mt-1 text-sm leading-5 text-slate">{card.body}</p>
              </div>
              <Link href={card.href} className="shrink-0 text-xs font-medium text-[#2563eb] hover:underline">
                See reviews
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate">
        A rating change is listed when an outlet has at least 5 reviews in this period and in the previous one, and the average moves by 0.15 or more.
      </p>
      {generate ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => void generateInsight()}
            disabled={pending}
            aria-busy={pending || undefined}
            className="text-xs font-medium text-[#163a7a] underline disabled:opacity-60"
          >
            {pending ? "Analysing customer feedback…" : "Generate insight"}
          </button>
          {pending ? (
            <ActivityStatus tone="gemini" title={ACTION_STATUS.aiInsight.title} detail={ACTION_STATUS.aiInsight.detail} />
          ) : refreshing ? (
            <ActivityStatus title={ACTION_STATUS.applying.title} detail="The new summary is already on screen. Counted cards stay as they are." />
          ) : null}
          {error ? (
            <p className="text-xs text-rose-600" role="alert">
              {error} Counted sections stay available — you can retry.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
