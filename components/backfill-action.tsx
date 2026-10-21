"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Progress {
  phase: string;
  pendingBefore: number;
  processed: number;
  rulesStored: number;
  batchStored: number;
  remaining: number;
  notice: string | null;
}

const PHASE_LABEL: Record<string, string> = {
  extracting: "Extracting topics from new reviews…",
  embedding: "Embedding review text and building topic clusters…",
  merging: "Merging into the organisation summary…",
  regenerating: "Regenerating the report…",
  done: "Summary updated.",
  failed: "Update failed.",
};

/**
 * Runs one organisation-wide summary update and shows live progress.
 * The work happens in one POST; this polls the status endpoint while it
 * runs, then refreshes the server-rendered page when it completes.
 */
export function BackfillAction(props: { hidden: Record<string, string> }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = progress !== null && progress.phase !== "done" && progress.phase !== "failed";
  const clientId = props.hidden.client ?? "";

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const poll = async () => {
    try {
      const response = await fetch(`/api/insights/backfill/status?client=${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { running?: boolean } & Partial<Progress>;
      if (data.phase) {
        setProgress({
          phase: data.phase,
          pendingBefore: data.pendingBefore ?? 0,
          processed: data.processed ?? 0,
          rulesStored: data.rulesStored ?? 0,
          batchStored: data.batchStored ?? 0,
          remaining: data.remaining ?? 0,
          notice: data.notice ?? null,
        });
        if (!data.running) stopPolling();
      }
    } catch {
      // Polling is best-effort; the POST result is authoritative.
    }
  };

  // If a run is already in flight (for example after navigating back),
  // resume showing its progress.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/insights/backfill/status?client=${encodeURIComponent(clientId)}`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { running?: boolean } & Partial<Progress>;
        if (data.running && data.phase) {
          setProgress({
            phase: data.phase,
            pendingBefore: data.pendingBefore ?? 0,
            processed: data.processed ?? 0,
            rulesStored: data.rulesStored ?? 0,
            batchStored: data.batchStored ?? 0,
            remaining: data.remaining ?? 0,
            notice: data.notice ?? null,
          });
          pollRef.current = setInterval(() => void poll(), 2500);
        }
      } catch {
        // No run to resume.
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const start = () => {
    if (running) return;
    setError(null);
    setNotice(null);
    setProgress({ phase: "extracting", pendingBefore: 0, processed: 0, rulesStored: 0, batchStored: 0, remaining: 0, notice: null });
    pollRef.current = setInterval(() => void poll(), 2500);
    void (async () => {
      try {
        const form = new FormData();
        for (const [key, value] of Object.entries(props.hidden)) form.set(key, value);
        const response = await fetch("/api/insights/backfill", {
          method: "POST",
          headers: { "x-backfill-json": "1" },
          body: form,
        });
        const data = (await response.json().catch(() => ({}))) as { notice?: string; alreadyRunning?: boolean };
        if (data.alreadyRunning) {
          // Another tab owns this update. Watch its progress instead of
          // reporting a failure or starting a competing run.
          setNotice(data.notice ?? "An update is already running for this workspace.");
          return;
        }
        stopPolling();
        if (!response.ok) throw new Error(data.notice ?? "Review data could not be updated.");
        setProgress((current) => (current ? { ...current, phase: "done" } : current));
        setNotice(data.notice ?? "Summary updated.");
        router.refresh();
      } catch (caught) {
        // A dropped connection ("Failed to fetch") does not mean the
        // server stopped: the run continues without this tab. Check the
        // status endpoint and resume watching when a run is still active.
        try {
          const status = await fetch(`/api/insights/backfill/status?client=${encodeURIComponent(clientId)}`, {
            cache: "no-store",
          });
          const data = (await status.json().catch(() => ({}))) as { running?: boolean };
          if (status.ok && data.running) {
            setError(null);
            setNotice("Connection interrupted — the update is still running on the server.");
            if (!pollRef.current) pollRef.current = setInterval(() => void poll(), 2500);
            return;
          }
        } catch {
          // Status unreachable too; fall through to the failure state.
        }
        stopPolling();
        setProgress((current) => (current ? { ...current, phase: "failed" } : current));
        setError(caught instanceof Error ? caught.message : "Review data could not be updated.");
      }
    })();
  };

  const percent =
    progress && progress.pendingBefore > 0
      ? Math.min(100, Math.round((progress.processed / progress.pendingBefore) * 100))
      : null;

  return (
    <div className="space-y-2">
      <button
        className="rounded-full border border-[#163a7a] px-4 py-2 text-sm font-medium text-[#163a7a] disabled:opacity-60"
        type="button"
        onClick={start}
        disabled={running}
        title="Extract topics for any new reviews across the whole organisation, merge them into the organisation summary (the source of truth), and regenerate this view from it"
      >
        {running ? "Updating summary…" : "Update summary"}
      </button>
      {progress ? (
        <div className="w-full max-w-sm space-y-1" role="status" aria-live="polite">
          <p className="text-xs text-slate">{PHASE_LABEL[progress.phase] ?? "Updating summary…"}</p>
          <div className="h-2 overflow-hidden rounded-full bg-[#e6ebf2]">
            {percent === null || progress.phase === "merging" || progress.phase === "regenerating" ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#163a7a]" />
            ) : (
              <div className="h-full rounded-full bg-[#163a7a] transition-all" style={{ width: `${percent}%` }} />
            )}
          </div>
          {progress.pendingBefore > 0 ? (
            <p className="text-xs text-[#5c6b82]">
              {progress.processed.toLocaleString("en-US")} of {progress.pendingBefore.toLocaleString("en-US")} reviews
              processed ({progress.rulesStored.toLocaleString("en-US")} by rules,{" "}
              {progress.batchStored.toLocaleString("en-US")} by AI batch)
              {progress.remaining > 0 ? ` · ${progress.remaining.toLocaleString("en-US")} remaining` : ""}. Keep this
              tab open.
            </p>
          ) : (
            <p className="text-xs text-[#5c6b82]">Scanning reviews… keep this tab open.</p>
          )}
        </div>
      ) : null}
      {notice && !running ? <p className="max-w-sm text-xs text-graphite">{notice}</p> : null}
      {error ? <p className="max-w-sm text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
