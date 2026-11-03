"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ActivityStatus } from "@/components/activity-status";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncLocationsButtonProps {
  connectionId: string;
  label?: string;
  /** Find profiles without importing them; the user picks which to import. */
  stage?: boolean;
  /** Page-header pill without the Force refresh button. */
  pill?: boolean;
}

export function SyncLocationsButton({
  connectionId,
  label = "Sync profiles",
  stage = false,
  pill = false,
}: SyncLocationsButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleSync(force = false) {
    setError(null);
    setSummary(null);
    setSyncing(true);

    try {
      const response = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, force, stage }),
      });

      const data = (await response.json()) as {
        error?: string;
        accountsUpserted?: number;
        locationsUpserted?: number;
        clientsCreated?: number;
        clientsReused?: number;
        locationsLinked?: number;
        skippedGoogleFetch?: boolean;
      };

      if (!response.ok) {
        setError(data.error ?? "Failed to sync profiles from Google.");
        return;
      }

      if (data.skippedGoogleFetch) {
        setSummary(
          data.clientsCreated
            ? `Used cached profiles. Created ${data.clientsCreated} client${data.clientsCreated === 1 ? "" : "s"} (no Google quota used).`
            : "Profiles already synced recently. No Google API call made (quota saved)."
        );
      } else {
        const parts: string[] = [];
        parts.push(
          stage
            ? `Found ${data.locationsUpserted ?? 0} profile${(data.locationsUpserted ?? 0) === 1 ? "" : "s"}. Pick the ones to import below`
            : `Synced ${data.locationsUpserted ?? 0} profile${(data.locationsUpserted ?? 0) === 1 ? "" : "s"}`
        );
        if ((data.clientsCreated ?? 0) > 0) {
          parts.push(
            `created ${data.clientsCreated} new client${data.clientsCreated === 1 ? "" : "s"}`
          );
        }
        if ((data.clientsReused ?? 0) > 0) {
          parts.push(`reused ${data.clientsReused} existing`);
        }
        setSummary(parts.join(", ") + ".");
      }
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  if (pill) {
    return (
      <div className="flex flex-col gap-2 sm:items-end">
        <button
          type="button"
          onClick={() => handleSync(false)}
          disabled={syncing}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-medium text-ink outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("size-[15px]", syncing && "animate-spin")} aria-hidden />
          {syncing ? "Reading Google…" : label}
        </button>
        {summary ? (
          <p className="max-w-xs text-xs text-ink sm:text-right" role="status">
            {summary}
          </p>
        ) : null}
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
          disabled={syncing}
          className="gap-1.5"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", syncing && "animate-spin")}
            aria-hidden
          />
          {syncing ? "Reading Google…" : label}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSync(true)}
          disabled={syncing}
          className="text-xs text-ink-3"
        >
          Force refresh
        </Button>
      </div>
      {syncing ? (
        <ActivityStatus
          tone="google"
          title="Reading Business Profiles from Google"
          detail="GRM is listing the locations this Google account manages and grouping them into clients. This can take a little while."
        />
      ) : null}
      {summary && (
        <p className="text-xs text-ink" role="status">
          {summary}
        </p>
      )}
      {error && (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
