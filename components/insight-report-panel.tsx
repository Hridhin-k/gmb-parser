"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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

  const label = running
    ? "Generating…"
    : starting
      ? "Starting…"
      : stale
        ? "Restart generation"
        : report?.status === "failed"
          ? "Retry report"
          : hasSavedReport
            ? "Regenerate report"
            : "Generate report";
  const statusBadge = !report ? (
    hasSavedReport ? <Badge variant="ok">Saved</Badge> : <Badge>Not generated</Badge>
  ) : stale ? (
    <Badge variant="warn">Stopped</Badge>
  ) : running ? (
    <Badge variant="info">
      <Spinner size="xs" />
      Running
    </Badge>
  ) : report.status === "completed" ? (
    <Badge variant="ok">Completed</Badge>
  ) : report.status === "partial" ? (
    <Badge variant="warn">Partial</Badge>
  ) : report.status === "failed" ? (
    <Badge variant="bad">Failed</Badge>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Insight report</h2>
            {statusBadge}
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {hasSavedReport
              ? "A saved report exists for these filters. Regenerating reuses it when the underlying reviews have not changed."
              : "Generate an evidence-backed report for this scope and range. Missing review analysis runs first, automatically."}
          </p>
        </div>
        <Button
          type="button"
          variant="ai"
          onClick={start}
          loading={starting || running}
          title={
            hasSavedReport
              ? "Uses AI only for reviews that are new or changed since the saved report; otherwise the saved report is reused at no cost."
              : "Uses AI to analyse any pending reviews, then writes the report from the saved evidence."
          }
        >
          {running || starting ? null : <Sparkles aria-hidden />}
          {label}
        </Button>
      </div>
      {message ? (
        <Banner tone="bad" role="alert">
          {message}
        </Banner>
      ) : null}
      {report && running ? (
        <div className="rounded-md border border-ai-line bg-ai-tint px-3 py-2 text-xs text-ink-3">
          <p className="text-[13px]">
            <span className="font-medium text-[#5b21b6]">Generating report</span>
            {report.phase ? ` — ${phaseLabel(report.phase)}` : ""}
          </p>
          {typeof report.eligible === "number" && report.eligible > 0 ? (
            <p className="mt-1 tabular-nums">
              Written reviews in scope {report.eligible.toLocaleString()} · analysed{" "}
              {(report.analysed ?? 0).toLocaleString()} · pending{" "}
              {(report.pending ?? 0).toLocaleString()} · failed{" "}
              {(report.failed ?? 0).toLocaleString()}
            </p>
          ) : null}
          <p className="mt-1">
            Progress comes from the server job, not an estimate. You can leave this page and come
            back — the job keeps running and this panel picks it up again. The saved report below stays readable until the new one lands.
          </p>
        </div>
      ) : null}
      {stale ? (
        <Banner tone="warn" title="The previous generation appears to have stopped.">
          Its worker is no longer reporting progress (this happens if the server restarted). Restart it: completed review analysis
          is reused, so only the missing work runs again.
        </Banner>
      ) : null}
      {report && report.status === "partial" ? (
        <Banner tone="warn" title="The last generation finished with failures.">
          Some reviews could not be analysed and are excluded. The saved report below is labelled partial — retry to complete coverage.
        </Banner>
      ) : null}
      {report && report.status === "failed" ? (
        <Banner tone="bad" title="The last report generation failed.">
          {report.error ? `${report.error}. ` : ""}Use “Retry report” — completed review analysis is reused, so a retry only does the
          missing work.
        </Banner>
      ) : null}
    </div>
  );
}
