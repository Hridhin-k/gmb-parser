"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Generates a deep dive for one finding: the model reads only that
 * finding's cited reviews (at most 25) and the result is stored on the
 * report, so this costs once per finding per report version.
 */
export function DeepDiveAction(props: { hidden: Record<string, string>; findingKey: string; hasDive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (force: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/insights/deep-dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...props.hidden, findingKey: props.findingKey, force }),
      });
      const data = (await response.json().catch(() => ({}))) as { notice?: string };
      if (!response.ok) throw new Error(data.notice ?? "The deep dive could not be generated.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The deep dive could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void run(props.hasDive)}
        disabled={busy}
        className="rounded-full border border-[#163a7a] px-3 py-1.5 text-xs font-medium text-[#163a7a] disabled:opacity-60"
        title="The model reads only this finding's cited reviews and writes a short analysis, stored on the report"
      >
        {busy ? "Reading the cited reviews…" : props.hasDive ? "Regenerate deep dive" : "Deep dive: read the cited reviews"}
      </button>
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </span>
  );
}
