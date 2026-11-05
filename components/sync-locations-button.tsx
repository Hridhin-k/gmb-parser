"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ActivityStatus } from "@/components/activity-status";
import { RefreshCw } from "lucide-react";
import { syncGoogleConnections, type ProfileSyncResult } from "@/lib/google-profile-sync-client";
import { cn } from "@/lib/utils";

interface SyncLocationsButtonProps {
  connectionId?: string;
  connectionIds?: string[];
  accountNames?: Record<string, string>;
  label?: string;
  /** Find profiles without importing them; the user picks which to import. */
  stage?: boolean;
  /** Page-header pill without the Force refresh button. */
  pill?: boolean;
}

export function SyncLocationsButton({
  connectionId,
  connectionIds,
  accountNames = {},
  label = "Sync profiles",
  stage = false,
  pill = false,
}: SyncLocationsButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const [results, setResults] = useState<ProfileSyncResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const ids = connectionIds ?? (connectionId ? [connectionId] : []);
  const busyLabel = progress.total > 1 ? `Syncing account ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Reading Google…";

  async function handleSync(force = false) {
    setError(null);
    setSummary(null);
    setResults([]);
    setSyncing(true);
    try {
      const completed = await syncGoogleConnections(ids, { force, stage }, (done, total) => setProgress({ done, total }));
      setResults(completed);
      const succeeded = completed.filter((item) => !item.error);
      const failed = completed.length - succeeded.length;
      const found = succeeded.reduce((total, item) => total + (item.locationsUpserted ?? 0), 0);
      const cached = succeeded.filter((item) => item.skippedGoogleFetch).length;
      setSummary(`${succeeded.length} of ${completed.length} Google ${completed.length === 1 ? "account" : "accounts"} synced. ${found} ${found === 1 ? "profile" : "profiles"} read.${cached ? ` ${cached} ${cached === 1 ? "account" : "accounts"} already synced recently.` : ""}${stage && found ? " Pick the profiles to import below." : ""}`);
      if (failed) setError(`${failed} ${failed === 1 ? "account needs" : "accounts need"} attention.${succeeded.length ? " Other accounts have finished syncing." : " Retry these accounts after fixing the errors below."}`);
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  const failures = results.filter((item) => item.error);
  const failureDetails = failures.length > 0 ? (
    <ul className="max-w-md space-y-1 text-xs text-bad" aria-label="Account sync errors">
      {failures.map((item) => <li key={item.connectionId}>
        {accountNames[item.connectionId] ?? `Account ${ids.indexOf(item.connectionId) + 1}`}: {item.error}
      </li>)}
    </ul>
  ) : null;

  if (pill) {
    return (
      <div className="flex flex-col gap-2 sm:items-end">
        <button
          type="button"
          onClick={() => handleSync(false)}
          disabled={syncing || ids.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-medium text-ink outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("size-[15px]", syncing && "animate-spin")} aria-hidden />
          {syncing ? busyLabel : label}
        </button>
        {summary ? (
          <p className="max-w-xs text-xs text-ink sm:text-right" role="status">
            {summary}
          </p>
        ) : null}
        {failureDetails}
        {error ? (
          <p className="max-w-xs text-xs text-bad sm:text-right" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSync(false)}
          disabled={syncing || ids.length === 0}
          className="gap-1.5"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", syncing && "animate-spin")}
            aria-hidden
          />
          {syncing ? busyLabel : label}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSync(true)}
          disabled={syncing || ids.length === 0}
          className="text-xs text-ink-3"
        >
          Force refresh
        </Button>
      </div>
      {syncing ? (
        <ActivityStatus
          tone="google"
          title="Reading Business Profiles from Google"
          detail="Each connected Google account is checked separately. A failed account does not stop the others."
        />
      ) : null}
      {summary && (
        <p className="text-xs text-ink" role="status">
          {summary}
        </p>
      )}
      {failureDetails}
      {error && (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
