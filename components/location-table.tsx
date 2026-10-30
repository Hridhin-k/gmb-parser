"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Unlink, MapPin } from "lucide-react";
import Link from "next/link";
import { SyncButton } from "@/components/sync-button";
import { ActivityStatus } from "@/components/activity-status";
import { locationDisplayName, readableStoreCode } from "@/lib/ui/location-place";
import { formatFriendlyDate } from "@/lib/format-date";

interface Location {
  id: string;
  google_location_name: string;
  location_title: string;
  address_formatted: string | null;
  primary_phone: string | null;
  store_code: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  sync_status?: string | null;
  total_review_count?: number | null;
  client_id: string | null;
}

interface LocationTableProps {
  clientId: string;
  connectionId: string;
  canSync: boolean;
  locations: Location[];
}

function formatSyncDate(iso: string | null): string {
  if (!iso) return "Never synced";
  return formatFriendlyDate(iso);
}

export function LocationTable({
  clientId,
  connectionId,
  canSync,
  locations,
}: LocationTableProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect(locationId: string) {
    setError(null);
    setLoadingId(locationId);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/locations/${locationId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "Failed to disconnect location.");
        return;
      }
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          Locations <span className="font-normal text-ink-3">· {locations.length.toLocaleString("en-US")}</span>
        </h2>
        {canSync && connectionId ? (
          <SyncButton
            locationId={undefined}
            connectionId={undefined}
            syncAll
            label="Sync all reviews"
            size="sm"
          />
        ) : null}
      </div>

      {loadingId || error ? (
        <div className="space-y-2 border-b border-line-2 px-4 py-3">
          {loadingId ? (
            <ActivityStatus
              title="Removing this location from the business"
              detail="The Google profile stays in the workspace. You can assign it to another business afterwards."
            />
          ) : null}
          {error ? (
            <p className="rounded-md border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center" role="status">
          <MapPin className="size-8 text-[#aeb6c2]" strokeWidth={1.25} aria-hidden />
          <p className="mt-2 text-[15px] font-semibold text-ink">No locations on this business</p>
          <p className="mt-1 text-[13px] text-ink-3">
            Assign Google profiles from the Unassigned pool on the{" "}
            <Link href="/locations" className="font-medium text-brand hover:underline">
              Locations
            </Link>{" "}
            page.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-2">
          {locations.map((loc) => {
            const name = locationDisplayName({
              title: loc.location_title,
              storeCode: loc.store_code,
              address: loc.address_formatted,
            });
            const storeCode = readableStoreCode(loc.store_code);
            const syncProblem = loc.sync_status === "partial" || loc.sync_status === "failed";
            return (
              <li key={loc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-ink">{name}</p>
                    {storeCode ? <Badge variant="outline">{storeCode}</Badge> : null}
                    <Badge variant={loc.is_active ? "ok" : "default"}>{loc.is_active ? "Active" : "Inactive"}</Badge>
                    {syncProblem ? (
                      <Badge variant={loc.sync_status === "failed" ? "bad" : "warn"}>
                        {loc.sync_status === "failed" ? "Sync failed" : "Partial"}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-2">
                    {loc.address_formatted ?? <span className="text-ink-3">No address on this Google profile</span>}
                    {loc.primary_phone ? <span className="text-ink-3"> · {loc.primary_phone}</span> : null}
                  </p>
                  <p className="text-xs text-ink-3">
                    {formatSyncDate(loc.last_synced_at)}
                    {typeof loc.total_review_count === "number"
                      ? ` · ${loc.total_review_count.toLocaleString("en-US")} reviews on Google`
                      : ""}
                  </p>
                  {syncProblem ? (
                    <p className="text-xs font-medium text-bad">
                      {loc.sync_status === "failed"
                        ? "Last review sync failed — reviews may be missing. Sync again."
                        : "Last review sync was incomplete — some reviews may be missing. Sync again."}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                  {canSync && connectionId ? (
                    <SyncButton locationId={loc.id} connectionId={connectionId} label="Sync" size="xs" />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDisconnect(loc.id)}
                    disabled={loadingId === loc.id}
                    className="text-bad hover:bg-bad-tint hover:text-bad"
                    aria-label={`Unassign ${name} from this business`}
                    title="Unassign from this business"
                  >
                    <Unlink className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
