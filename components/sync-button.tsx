"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncButtonProps {
  locationId?: string;
  connectionId?: string;
  syncAll?: boolean;
  label?: string;
  size?: "default" | "sm" | "xs";
}

export function SyncButton({
  locationId,
  connectionId,
  syncAll,
  label = "Sync reviews",
  size = "default",
}: SyncButtonProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setError(null);
    setSyncing(true);

    try {
      const body = syncAll
        ? { all: true }
        : { locationId, connectionId };

      const response = await fetch("/api/reviews/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        error?: string;
        totalReviewsSynced?: number;
        reviewsSynced?: number;
        locationsFailed?: number;
      };
      if (!response.ok) {
        setError(data.error ?? "Sync failed. Please try again.");
        return;
      }

      const synced = data.totalReviewsSynced ?? data.reviewsSynced ?? 0;
      const failed = data.locationsFailed ?? 0;
      if (failed > 0) {
        toast.warning(`Synced ${synced} new review${synced === 1 ? "" : "s"}`, {
          description: `${failed} location${failed === 1 ? "" : "s"} could not be synced. Check the audit log.`,
        });
      } else {
        toast.success(
          synced > 0
            ? `${synced} new review${synced === 1 ? "" : "s"} synced`
            : "Everything is up to date"
        );
      }
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please check your connection.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size={size}
        onClick={handleSync}
        disabled={syncing}
        className="gap-1.5"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden />
        {syncing ? "Syncing..." : label}
      </Button>
      {error && (
        <p className="max-w-xs text-[11px] text-red-600" role="alert">{error}</p>
      )}
    </div>
  );
}
