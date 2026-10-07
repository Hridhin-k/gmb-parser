"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Unlink, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { SyncButton } from "@/components/sync-button";
import { locationPlaceLabel } from "@/lib/ui/location-place";

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
  client_id: string | null;
}

interface LocationTableProps {
  clientId: string;
  connectionId: string;
  locations: Location[];
}

function formatSyncDate(iso: string | null): string {
  if (!iso) return "Never synced";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LocationTable({
  clientId,
  connectionId,
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#5f6368]">
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </p>
        {connectionId && (
          <SyncButton
            locationId={undefined}
            connectionId={undefined}
            syncAll
            label="Sync all reviews"
            size="sm"
          />
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-[#dadce0] bg-white py-12 text-center">
          <MapPin className="h-8 w-8 text-[#c9c7c3]" />
          <p className="mt-2 text-sm font-medium text-[#202124]">
            No locations on this client
          </p>
          <p className="mt-1 text-xs text-[#5f6368]">
            Assign Google profiles from the Unassigned pool on the Clients page.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {locations.map((loc) => {
            const place = locationPlaceLabel({
              storeCode: loc.store_code,
              address: loc.address_formatted,
            });
            return (
              <li
                key={loc.id}
                className="rounded-3xl border border-[#dadce0] bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[#202124]">
                        {place ?? loc.location_title}
                      </p>
                      {loc.store_code && place !== loc.store_code ? (
                        <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[11px] font-medium text-[#1a73e8]">
                          {loc.store_code}
                        </span>
                      ) : null}
                      <Badge
                        variant={loc.is_active ? "default" : "secondary"}
                        className={
                          loc.is_active
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-[#f8f9fa] text-[#3c4043]"
                        }
                      >
                        {loc.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {loc.address_formatted ? (
                      <p className="text-sm leading-relaxed text-[#3c4043]">
                        {loc.address_formatted}
                      </p>
                    ) : (
                      <p className="text-sm text-[#5f6368]">No address on this Google profile</p>
                    )}
                    {loc.primary_phone ? (
                      <p className="text-xs text-[#5f6368]">{loc.primary_phone}</p>
                    ) : null}
                    <p className="text-xs text-[#5f6368]">
                      {formatSyncDate(loc.last_synced_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                    {connectionId ? (
                      <SyncButton
                        locationId={loc.id}
                        connectionId={connectionId}
                        label="Sync"
                        size="xs"
                      />
                    ) : null}
                    <Link
                      href={`/dashboard?location=${loc.id}`}
                      className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      Insights
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(loc.id)}
                      disabled={loadingId === loc.id}
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label="Unassign location from client"
                    >
                      <Unlink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
