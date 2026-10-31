"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OperationStatus, FailureBanner } from "@/components/status-banner";
import { ACTION_STATUS } from "@/lib/ui-status";
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
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // Seconds until retrying makes sense (Google throttling): stops hammering a spent quota.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleSync() {
    if (cooldown > 0) return;
    setError(null);
    setNeedsReconnect(false);
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

      // A proxy/timeout can answer with HTML or nothing; that is not "offline".
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        totalReviewsSynced?: number;
        reviewsSynced?: number;
        locationsFailed?: number;
        partial?: boolean;
        warning?: string;
        retryable?: boolean;
        retryAfterSeconds?: number;
        action?: "reconnect" | "check_access";
      };
      if (!response.ok) {
        setError(
          data.error ??
            (response.status === 504 || response.status === 502
              ? "The server took too long to answer. Any reviews already fetched are saved — try again."
              : "Sync failed. Please try again.")
        );
        setNeedsReconnect(data.action === "reconnect");
        const retryAfter =
          data.retryAfterSeconds ?? Number(response.headers.get("Retry-After") ?? 0);
        if (data.retryable !== false && retryAfter > 0) setCooldown(Math.min(retryAfter, 300));
        return;
      }

      const synced = data.totalReviewsSynced ?? data.reviewsSynced ?? 0;
      const failed = data.locationsFailed ?? 0;
      if (failed > 0 || data.partial) {
        toast.warning(`Synced ${synced} new review${synced === 1 ? "" : "s"}`, {
          description: [
            failed > 0 ? `${failed} location${failed === 1 ? "" : "s"} could not be synced.` : null,
            data.warning,
            data.retryable ? "The daily sync will also retry automatically." : null,
          ]
            .filter(Boolean)
            .join(" "),
        });
        if (data.retryable && data.retryAfterSeconds) setCooldown(Math.min(data.retryAfterSeconds, 300));
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
        loading={syncing}
        disabled={cooldown > 0}
        className="gap-1.5"
      >
        {!syncing ? (
          <RefreshCw className={cn("h-3.5 w-3.5")} aria-hidden />
        ) : null}
        {syncing
          ? syncAll ? ACTION_STATUS.syncAll.short : ACTION_STATUS.sync.short
          : cooldown > 0 ? `Try again in ${cooldown}s` : label}
      </Button>
      {syncing ? (
        <OperationStatus className="mt-1 max-w-sm" copy={syncAll ? ACTION_STATUS.syncAll : ACTION_STATUS.sync} />
      ) : null}
      {error ? (
        <FailureBanner
          className="mt-1 max-w-sm"
          title="We couldn't refresh the reviews"
          detail={error}
          onRetry={cooldown > 0 || needsReconnect ? undefined : () => void handleSync()}
        />
      ) : null}
      {needsReconnect ? (
        <a href="/settings" className="text-xs text-bad underline">
          Reconnect Google account
        </a>
      ) : null}
    </div>
  );
}
