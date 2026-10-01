"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Unlink, MapPin } from "lucide-react";
import { SyncButton } from "@/components/sync-button";

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
  if (!iso) return "Never";
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
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
        <div className="flex flex-col items-center justify-center rounded-[20px] border border-[#e4e2de] bg-white py-12 text-center">
          <MapPin className="h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">
            No locations on this client
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Assign Google profiles from the Unassigned pool on the Clients page.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-[#e4e2de] bg-white">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#f3f1ee] bg-[#fafaf8]">
                <TableHead className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                  Business Name
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                  Address
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                  Google Location ID
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                  Status
                </TableHead>
                <TableHead className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#8a877f]">
                  Last Synced
                </TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => (
                <TableRow key={loc.id} className="border-b border-gray-100">
                  <TableCell className="py-3">
                    <p className="text-sm font-medium text-gray-900">
                      {loc.location_title}
                    </p>
                    {loc.store_code && (
                      <p className="text-xs text-gray-500">#{loc.store_code}</p>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <p className="max-w-xs text-sm text-gray-600">
                      {loc.address_formatted ?? "—"}
                    </p>
                  </TableCell>
                  <TableCell className="py-3">
                    <code className="text-xs text-gray-500">
                      {loc.google_location_name.split("/").pop()}
                    </code>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant={loc.is_active ? "default" : "secondary"}
                      className={
                        loc.is_active
                          ? "bg-green-100 text-green-700 hover:bg-green-100"
                          : "bg-gray-100 text-gray-600"
                      }
                    >
                      {loc.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <span className="text-sm text-gray-500">
                        {formatSyncDate(loc.last_synced_at)}
                      </span>
                      {connectionId && (
                        <div>
                          <SyncButton
                            locationId={loc.id}
                            connectionId={connectionId}
                            label="Sync"
                            size="xs"
                          />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
