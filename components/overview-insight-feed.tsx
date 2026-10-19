"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OverviewInsightCard } from "@/lib/overview-board";

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
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = filter === "all" ? cards : cards.filter((card) => card.tone === filter);
  const count = (id: (typeof FILTERS)[number]["id"]) =>
    id === "all" ? cards.length : cards.filter((card) => card.tone === id).length;

  async function refresh() {
    if (!generate) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeKind: generate.scopeKind, scopeId: generate.scopeId, force: true }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not generate an insight.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not generate an insight.");
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
      {savedSummary ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate">Saved insight</p>
          <p className="mt-1 text-sm leading-6 text-graphite">{savedSummary}</p>
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
            onClick={() => void refresh()}
            disabled={pending}
            aria-busy={pending || undefined}
            className="text-xs font-medium text-[#163a7a] underline disabled:opacity-60"
          >
            {pending ? "Analysing customer feedback…" : "Generate insight"}
          </button>
          {pending ? (
            <p className="text-xs text-slate" role="status" aria-live="polite">
              Preparing a model interpretation for this organisation or group. Counted cards above stay available.
            </p>
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
