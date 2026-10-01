"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Link2, MapPin } from "lucide-react";

interface UnassignedLocation {
  id: string;
  location_title: string;
  address_formatted: string | null;
}

interface ClientOption {
  id: string;
  name: string;
}

interface UnassignedLocationsBoardProps {
  locations: UnassignedLocation[];
  clients: ClientOption[];
  connectionId: string | null;
}

export function UnassignedLocationsBoard({
  locations,
  clients,
  connectionId,
}: UnassignedLocationsBoardProps) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleAssign(locationId: string) {
    const clientId = assignments[locationId];
    if (!clientId) {
      setError("Choose a client before assigning.");
      return;
    }

    setError(null);
    setMessage(null);
    setLoadingId(locationId);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/locations/${locationId}`,
        { method: "PUT" }
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "Failed to assign location.");
        return;
      }
      setMessage("Location assigned.");
      router.refresh();
    } catch {
      setError("Unable to assign location.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleResetAll() {
    if (
      !confirm(
        "Move every location back to Unassigned so you can re-map them to the correct clients?"
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/google/locations/reset", {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; reset?: number };
      if (!response.ok) {
        setError(data.error ?? "Failed to reset assignments.");
        return;
      }
      setMessage(`Moved ${data.reset ?? 0} location(s) to Unassigned.`);
      router.refresh();
    } catch {
      setError("Unable to reset assignments.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">
            Unassigned Google locations
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Sync pulls every profile you manage into this pool. Create a client
            for each business, then assign its location(s) here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {connectionId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetAll}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Reset all to Unassigned"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      )}

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-gray-200 py-8 text-center">
          <MapPin className="h-7 w-7 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">
            No unassigned locations
          </p>
          <p className="mt-1 max-w-sm text-xs text-gray-500">
            {connectionId
              ? "Open a client and sync locations from Google, or reset assignments if everything was dumped onto one client."
              : "Connect Google in Settings first, then sync locations."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {loc.location_title}
                </p>
                {loc.address_formatted && (
                  <p className="truncate text-xs text-gray-500">
                    {loc.address_formatted}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={assignments[loc.id] ?? ""}
                  onChange={(e) =>
                    setAssignments((prev) => ({
                      ...prev,
                      [loc.id]: e.target.value,
                    }))
                  }
                  className="h-8 rounded-md border border-gray-200 bg-white px-2 text-[13px] text-gray-700"
                  aria-label={`Assign ${loc.location_title} to client`}
                  disabled={clients.length === 0}
                >
                  <option value="">
                    {clients.length === 0 ? "Create a client first" : "Select client"}
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={() => handleAssign(loc.id)}
                  disabled={loadingId === loc.id || clients.length === 0}
                  className="gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {loadingId === loc.id ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
