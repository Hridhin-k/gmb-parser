"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface AnalysisRunStatus {
  runId: string;
  status: string;
  discovered: number;
  eligible: number;
  alreadyAnalysed: number;
  newlyAnalysed: number;
  pending: number;
  failed: number;
  batchesTotal: number;
  batchesCompleted: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  updatedAt?: string;
}

interface InsightAnalyzerProps {
  scopeParams: {
    client?: string;
    group?: string;
    location?: string;
    range?: string;
    from?: string;
    to?: string;
  };
  initialRun: AnalysisRunStatus | null;
  pendingCount: number;
}

export function InsightAnalyzer({ scopeParams, initialRun, pendingCount }: InsightAnalyzerProps) {
  const router = useRouter();
  const [run, setRun] = useState<AnalysisRunStatus | null>(initialRun);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stale =
    run?.status === "running" &&
    run.updatedAt !== undefined &&
    Date.now() - new Date(run.updatedAt).getTime() > 5 * 60 * 1000;
  const running = run?.status === "running" && !stale;

  useEffect(() => {
    if (!run || run.status !== "running") return;
    timer.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/insights/analyze/status?runId=${run.runId}`);
        if (!response.ok) return;
        const next = (await response.json()) as AnalysisRunStatus;
        setRun(next);
        if (next.status !== "running") {
          if (timer.current) clearInterval(timer.current);
          router.refresh();
        }
      } catch {
        // Transient poll failure; the next tick retries.
      }
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId, run?.status === "running"]);

  async function start() {
    setStarting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/insights/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeParams),
      });
      const data = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !data.runId) {
        setMessage(data.error ?? "Failed to start analysis. Please try again.");
        return;
      }
      setRun({
        runId: data.runId,
        status: "running",
        discovered: 0,
        eligible: 0,
        alreadyAnalysed: 0,
        newlyAnalysed: 0,
        pending: pendingCount,
        failed: 0,
        batchesTotal: 0,
        batchesCompleted: 0,
        retries: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: null,
      });
    } catch {
      // A network failure here does not mean the run failed to start — the
      // server may have created it. Say so instead of blaming the start.
      setMessage(
        "Could not reach the server. Check your connection — if a run appears below, it is still processing."
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="rounded-xl border border-silver bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-graphite">Review analysis</h2>
          <p className="mt-1 text-sm text-slate">
            {pendingCount > 0
              ? `${pendingCount} written review${pendingCount === 1 ? "" : "s"} still need analysis in this scope and range.`
              : "Every written review in this scope and range has a current analysis."}
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={starting || running || (pendingCount === 0 && !stale)}
          className="rounded-lg bg-graphite px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Analysing…" : starting ? "Starting…" : stale ? "Restart analysis" : "Analyse reviews"}
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
      {stale ? (
        <p className="mt-3 text-sm text-amber-800">
          The previous analysis appears to have stopped — its worker is no longer reporting
          progress. Restart it: reviews already analysed are reused, only the remainder runs.
        </p>
      ) : null}

      {run ? (
        <div className="mt-4 space-y-2 text-sm text-slate">
          <p>
            Status:{" "}
            <span className="font-medium text-graphite">
              {run.status === "running"
                ? "Analysing new reviews"
                : run.status === "completed"
                  ? "Completed"
                  : run.status === "partial"
                    ? "Completed with failures — some reviews failed and can be retried"
                    : "Failed"}
            </span>
            {run.batchesTotal > 0
              ? ` · Batches ${run.batchesCompleted}/${run.batchesTotal} (from the server)`
              : ""}
            {run.retries > 0 ? ` · Retries ${run.retries}` : ""}
          </p>
          <p>
            Reused from earlier analysis {run.alreadyAnalysed} · Newly analysed {run.newlyAnalysed}{" "}
            · Pending {run.pending} · Failed {run.failed}
            {run.inputTokens + run.outputTokens > 0
              ? ` · Tokens ${run.inputTokens.toLocaleString()} in / ${run.outputTokens.toLocaleString()} out`
              : ""}
          </p>
          {run.status === "partial" ? (
            <p>
              The failed reviews are recorded. Press “Analyse reviews” again to retry only those —
              completed reviews are not repeated.
            </p>
          ) : null}
          {run.error ? <p className="text-red-600">{run.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
