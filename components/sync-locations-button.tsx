"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncLocationsButtonProps {
  connectionId: string;
  label?: string;
}

export function SyncLocationsButton({
  connectionId,
  label = "Sync profiles",
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
        body: JSON.stringify({ connectionId, force }),
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
          `Synced ${data.locationsUpserted ?? 0} profile${(data.locationsUpserted ?? 0) === 1 ? "" : "s"}`
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
          {syncing ? "Syncing…" : label}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSync(true)}
          disabled={syncing}
          className="text-xs text-[#5f6368]"
        >
          Force refresh
        </Button>
      </div>
      {summary && (
        <p className="text-xs text-[#3c4043]" role="status">
          {summary}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
