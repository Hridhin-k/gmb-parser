"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter, type DateRangeChange } from "@/components/date-range-filter";
import { FailureBanner } from "@/components/status-banner";
import { parseDateRange } from "@/lib/date-range";
import type { PipelineJobView } from "@/lib/services/location-pipeline";

interface SyncButtonProps {
  locationId?: string;
  connectionId?: string;
  syncAll?: boolean;
  /** With syncAll: only these locations (the current scope). */
  locationIds?: string[];
  label?: string;
  size?: "default" | "sm" | "xs";
}

const STOPPED = ["completed", "partial", "failed", "paused"];
const RESUMABLE = ["partial", "failed", "paused"];

export function SyncButton({ locationId, connectionId, syncAll, locationIds, label = "Sync reviews", size = "default" }: SyncButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(() => parseDateRange({}, "30d"));
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<PipelineJobView[]>([]);
  const storageKey = `grm-sync:${pathname}:${locationId ?? [...(locationIds ?? ["scope"])].sort().join(",")}`;
  const paused = jobs.filter((job) => RESUMABLE.includes(job.status));
  const canResume = paused.length > 0 && paused.every((job) => job.errorCode !== "PERIOD_REQUIRED" && Boolean(job.end));
  const needsReconnect = /reconnect|authentication|Google authorization/i.test(error ?? "");

  function remember(ids: string[]) {
    try {
      if (ids.length) localStorage.setItem(storageKey, JSON.stringify(ids));
      else localStorage.removeItem(storageKey);
    } catch { /* Progress also remains in the database when storage is unavailable. */ }
  }

  useEffect(() => {
    // Read browser storage after hydration; the server has no bookmark state.
    const timer = setTimeout(() => { try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= 1000 && saved.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) {
        setJobIds(saved);
        setSyncing(true);
      }
    } catch { /* A new sync can recover a saved job for the same period. */ } }, 0);
    return () => clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (jobIds.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next: PipelineJobView[] = [];
        for (let offset = 0; offset < jobIds.length; offset += 80) {
          const query = new URLSearchParams();
          for (const id of jobIds.slice(offset, offset + 80)) query.append("jobId", id);
          const response = await fetch(`/api/reviews/sync/status?${query}`, { cache: "no-store" });
          if (response.status === 404) {
            if (!cancelled) { setJobIds([]); setSyncing(false); remember([]); }
            return;
          }
          if (!response.ok) throw new Error("Could not read progress.");
          const data = await response.json() as { jobs: PipelineJobView[] };
          next.push(...data.jobs);
        }
        if (cancelled) return;
        setJobs(next);
        if (next.length > 0 && next.every((job) => STOPPED.includes(job.status))) {
          setSyncing(false);
          const problem = next.find((job) => job.status !== "completed");
          if (problem) {
            setError(problem.error ?? "Processing paused. Your progress is saved; resume to continue.");
          } else {
            setJobIds([]);
            remember([]);
            setError(null);
            toast.success("Sync complete", { description: "Reviews and daily insights for the selected period are ready." });
          }
          router.refresh();
          return;
        }
      } catch { /* The scheduled worker continues independently of this browser. */ }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
    // Job IDs and the location scope are the identity of this saved operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds, router, storageKey]);

  function choosePeriod() {
    setError(null);
    setPeriod(parseDateRange({ range: params.get("range") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, "30d"));
    setOpen(true);
  }

  function changePeriod(change: DateRangeChange) {
    setPeriod(parseDateRange({ range: change.range ?? undefined, from: change.from ?? undefined, to: change.to ?? undefined }, "30d"));
  }

  async function start(resume = false) {
    setSyncing(true);
    setError(null);
    try {
      const selection = syncAll ? { all: true, ...(locationIds ? { locationIds } : {}) } : { locationId, connectionId };
      const response = await fetch(resume ? "/api/reviews/sync/resume" : "/api/reviews/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resume ? { jobIds: paused.map((job) => job.id) } : {
          ...selection, period: { range: period.key, ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) },
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; jobIds?: string[] };
      if (!response.ok || !data.jobIds?.length) throw new Error(data.error ?? "Could not start the sync. Any saved progress is kept.");
      remember(data.jobIds);
      setJobs([]);
      setJobIds(data.jobIds);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not connect. Your saved progress is kept.");
      setSyncing(false);
    }
  }

  const active = jobs.filter((job) => !STOPPED.includes(job.status));
  const progressLabel = active.some((job) => job.phase === "fetching") || jobs.length === 0 ? "Fetching reviews…"
    : active.some((job) => job.phase === "analysing") ? `Analysing reviews: ${jobs.reduce((n, job) => n + job.analysed, 0)} / ${jobs.reduce((n, job) => n + job.eligible, 0)}`
      : "Updating daily insights…";
  const savedPeriod = jobs.find((job) => job.periodLabel);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size={size} onClick={() => canResume ? void start(true) : choosePeriod()} loading={syncing} className="gap-1.5">
        {!syncing ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : null}
        {syncing ? "Syncing…" : canResume ? "Resume sync" : label}
      </Button>
      {savedPeriod ? <p className="max-w-sm text-xs text-ink-3">{savedPeriod.periodLabel}{savedPeriod.start && savedPeriod.end ? ` · ${new Date(savedPeriod.start).toLocaleDateString("en-GB")} – ${new Date(savedPeriod.end).toLocaleDateString("en-GB")}` : ""}</p> : null}
      {syncing ? (
        <div role="status" aria-live="polite" className="mt-1 max-w-sm text-xs text-ink-2">
          <p className="font-medium">{progressLabel}</p>
          <p className="mt-1 text-ink-3">Progress is saved. You can leave this page and return later.</p>
          {active.some((job) => job.status === "queued" && job.error) ? <p className="mt-1 text-warn">Waiting to retry automatically.</p> : null}
        </div>
      ) : null}
      {error && !open ? <FailureBanner className="mt-1 max-w-sm" title={paused.length ? "Processing paused" : "Sync not started"} detail={error}
        onRetry={needsReconnect || paused.length > 0 ? undefined : choosePeriod} /> : null}
      {paused.length > 0 && !syncing ? <p className="max-w-sm text-xs text-ink-3">Saved review data and completed analysis are kept. Resume continues from the unfinished stage.</p> : null}
      {canResume && !syncing ? <button type="button" onClick={choosePeriod} className="text-xs text-brand underline">Sync another period</button> : null}
      {needsReconnect ? <a href="/settings" className="text-xs text-bad underline">Reconnect Google account</a> : null}
      <Dialog.Root open={open} onOpenChange={(next) => { if (!syncing) setOpen(next); }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/45" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-overlay outline-none">
            <Dialog.Title className="text-base font-semibold text-ink">Choose a sync period</Dialog.Title>
            <Dialog.Description className="mt-2 text-[13px] leading-relaxed text-ink-3">Only reviews posted during this period will be imported and analysed for the selected {locationId || locationIds?.length === 1 ? "location" : "locations"}.</Dialog.Description>
            <div className="mt-4"><DateRangeFilter value={period} defaultKey="30d" onChange={changePeriod} disabled={syncing} /></div>
            <p className="mt-3 text-xs text-ink-3">{period.key === "all" ? "All time imports the full review history. This may take longer and use more AI credits." : "Earlier saved reviews stay available. Their analysis is reused when you view a longer period."}</p>
            {error ? <p role="alert" className="mt-3 text-sm text-bad">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" disabled={syncing} onClick={() => setOpen(false)}>Cancel</Button>
              <Button loading={syncing} onClick={() => void start()}>Sync {period.label.toLowerCase()}</Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
