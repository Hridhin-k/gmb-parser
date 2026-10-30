"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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

  const tokens = run ? run.inputTokens + run.outputTokens : 0;
  const progress =
    run && run.batchesTotal > 0 ? Math.min(100, Math.round((run.batchesCompleted / run.batchesTotal) * 100)) : null;
  const statusBadge = !run ? null : stale ? (
    <Badge variant="warn">Stopped</Badge>
  ) : run.status === "running" ? (
    <Badge variant="info">
      <Spinner size="xs" />
      Running
    </Badge>
  ) : run.status === "completed" ? (
    <Badge variant="ok">Completed</Badge>
  ) : run.status === "partial" ? (
    <Badge variant="warn">Partial</Badge>
  ) : (
    <Badge variant="bad">Failed</Badge>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Review analysis</h2>
            {statusBadge}
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {pendingCount > 0
              ? `${pendingCount} written review${pendingCount === 1 ? "" : "s"} still need analysis in this scope and range.`
              : "Every written review in this scope and range has a current analysis."}
          </p>
        </div>
        <Button
          type="button"
          variant="ai"
          onClick={start}
          loading={starting || running}
          disabled={pendingCount === 0 && !stale}
          title={
            pendingCount === 0 && !stale
              ? "Nothing to analyse: every written review already has a current analysis."
              : `Analyses only the ${pendingCount.toLocaleString()} pending review${pendingCount === 1 ? "" : "s"}; earlier analysis is reused at no extra AI cost.${
                  tokens > 0 ? ` The last run used ${run!.inputTokens.toLocaleString()} input and ${run!.outputTokens.toLocaleString()} output tokens.` : ""
                }`
          }
        >
          {running || starting ? null : <Sparkles aria-hidden />}
          {running ? "Analysing…" : starting ? "Starting…" : stale ? "Restart analysis" : pendingCount > 0 ? `Analyse ${pendingCount.toLocaleString()} review${pendingCount === 1 ? "" : "s"}` : "Analyse reviews"}
        </Button>
      </div>

      {message ? (
        <Banner tone="bad" role="alert">
          {message}
        </Banner>
      ) : null}
      {stale ? (
        <Banner tone="warn" title="The previous analysis appears to have stopped.">
          Its worker is no longer reporting progress. Restart it: reviews already analysed are reused, only the remainder runs.
        </Banner>
      ) : null}

      {run ? (
        <div className="flex flex-col gap-2 text-xs text-ink-3">
          {run.status === "running" ? (
            <div className="rounded-md border border-ai-line bg-ai-tint px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-medium text-[#5b21b6]">Analysing new reviews</span>
                {run.batchesTotal > 0 ? (
                  <span className="tabular-nums">
                    Batch {run.batchesCompleted}/{run.batchesTotal} (from the server)
                  </span>
                ) : null}
              </div>
              {progress !== null ? (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-white"
                  role="progressbar"
                  aria-label="Analysis progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div className="h-full rounded-[3px] bg-ai" style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <RunStat label="Reused" value={run.alreadyAnalysed} />
            <RunStat label="Newly analysed" value={run.newlyAnalysed} />
            <RunStat label="Pending" value={run.pending} />
            <RunStat label="Failed" value={run.failed} tone={run.failed > 0 ? "bad" : undefined} />
          </dl>
          <p>
            {run.status === "completed"
              ? "Last run completed."
              : run.status === "partial"
                ? "Completed with failures — some reviews failed and can be retried."
                : run.status === "running"
                  ? "Existing results below stay readable while this runs."
                  : "Last run failed."}
            {run.retries > 0 ? ` Retries ${run.retries}.` : ""}
            {tokens > 0
              ? ` Tokens ${run.inputTokens.toLocaleString()} in / ${run.outputTokens.toLocaleString()} out.`
              : ""}
          </p>
          {run.status === "partial" ? (
            <p>
              The failed reviews are recorded. Run the analysis again to retry only those — completed reviews are not repeated.
            </p>
          ) : null}
          {run.error ? <p className="text-bad">{run.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function RunStat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt>{label}</dt>
      <dd className={`text-[13px] font-semibold tabular-nums ${tone === "bad" ? "text-bad" : "text-ink"}`}>{value.toLocaleString()}</dd>
    </div>
  );
}
