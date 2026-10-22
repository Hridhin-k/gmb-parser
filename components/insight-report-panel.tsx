"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface ReportStatusView {
  reportId: string;
  status: string;
  phase: string | null;
  discovered?: number;
  eligible?: number;
  analysed?: number;
  failed?: number;
  pending?: number;
  insightCount?: number;
  error?: string | null;
  updatedAt?: string;
}

/** A job that has not reported progress in five minutes has lost its worker. */
export function isStaleJob(updatedAt: string | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  return now - new Date(updatedAt).getTime() > 5 * 60 * 1000;
}

const PHASE_LABELS: Record<string, string> = {
  queued: "Queued",
  "checking data": "Checking for a saved report and new reviews",
  "analysing reviews": "Analysing new reviews — existing analysis is reused, not repeated",
  "synthesising insights": "Writing insights from the saved evidence",
  done: "Done",
  reused: "Saved report reused — nothing had changed",
  failed: "Failed",
};

export function phaseLabel(phase: string | null): string {
  if (!phase) return "";
  return PHASE_LABELS[phase] ?? phase;
}

interface InsightReportPanelProps {
  scopeParams: {
    client?: string;
    group?: string;
    location?: string;
    range?: string;
    from?: string;
    to?: string;
  };
  initialReport: ReportStatusView | null;
  hasSavedReport: boolean;
}

const TERMINAL = ["completed", "partial", "failed"];

export function InsightReportPanel({
  scopeParams,
  initialReport,
  hasSavedReport,
}: InsightReportPanelProps) {
  const router = useRouter();
  const [report, setReport] = useState<ReportStatusView | null>(initialReport);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stale = report !== null && !TERMINAL.includes(report.status) && isStaleJob(report.updatedAt);
  const running = report !== null && !TERMINAL.includes(report.status) && !stale;

  useEffect(() => {
    if (!report || TERMINAL.includes(report.status)) return;
    timer.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/insights/report/status?reportId=${report.reportId}`);
        if (!response.ok) return;
        const next = (await response.json()) as ReportStatusView & { reportId: string };
        setReport(next);
        if (TERMINAL.includes(next.status)) {
          if (timer.current) clearInterval(timer.current);
          router.refresh();
        }
      } catch {
        // Transient poll failure; the next tick retries.
      }
    }, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.reportId, running]);

  async function start() {
    setStarting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/insights/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeParams),
      });
      const data = (await response.json()) as {
        reportId?: string;
        status?: string;
        error?: string;
      };
      if (!response.ok || !data.reportId) {
        setMessage(data.error ?? "Failed to start the report. Please try again.");
        return;
      }
      setReport({ reportId: data.reportId, status: data.status ?? "pending", phase: "queued" });
    } catch {
      setMessage("Failed to start the report. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="rounded-xl border border-silver bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-graphite">Insight report</h2>
          <p className="mt-1 text-sm text-slate">
            {hasSavedReport
              ? "A saved report exists for these filters. Regenerating reuses it when the underlying reviews have not changed."
              : "Generate an evidence-backed report for this scope and range. Missing review analysis runs first, automatically."}
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={starting || running}
          className="rounded-lg bg-graphite px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? "Generating…"
            : starting
              ? "Starting…"
              : stale
                ? "Restart generation"
                : report?.status === "failed"
                  ? "Retry report"
                  : hasSavedReport
                    ? "Regenerate report"
                    : "Generate report"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-red-600">{message}</p> : null}
      {report && running ? (
        <div className="mt-3 space-y-1 text-sm text-slate">
          <p>
            <span className="font-medium text-graphite">Generating report</span>
            {report.phase ? ` — ${phaseLabel(report.phase)}` : ""}
          </p>
          {typeof report.eligible === "number" && report.eligible > 0 ? (
            <p>
              Written reviews in scope {report.eligible.toLocaleString()} · analysed{" "}
              {(report.analysed ?? 0).toLocaleString()} · pending{" "}
              {(report.pending ?? 0).toLocaleString()} · failed{" "}
              {(report.failed ?? 0).toLocaleString()}
            </p>
          ) : null}
          <p>
            Progress comes from the server job, not an estimate. You can leave this page and come
            back — the job keeps running and this panel picks it up again.
          </p>
        </div>
      ) : null}
      {stale ? (
        <p className="mt-3 text-sm text-amber-800">
          The previous generation appears to have stopped — its worker is no longer reporting
          progress (this happens if the server restarted). Restart it: completed review analysis
          is reused, so only the missing work runs again.
        </p>
      ) : null}
      {report && report.status === "partial" ? (
        <p className="mt-3 text-sm text-amber-800">
          The last generation finished with failures: some reviews could not be analysed and are
          excluded. The saved report below is labelled partial — retry to complete coverage.
        </p>
      ) : null}
      {report && report.status === "failed" ? (
        <p className="mt-3 text-sm text-red-600">
          The last report generation failed
          {report.error ? `: ${report.error}` : ""}. Use “Retry report” — completed review
          analysis is reused, so a retry only does the missing work.
        </p>
      ) : null}
    </div>
  );
}
