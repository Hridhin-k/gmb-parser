"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign(locationId: string) {
    const clientId = assignments[locationId];
    if (!clientId) {
      setError("Choose a client before assigning.");
      return;
    }

    setError(null);
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
      const clientName = clients.find((c) => c.id === clientId)?.name;
      toast.success(clientName ? `Assigned to ${clientName}` : "Location assigned");
      router.refresh();
    } catch {
      setError("Unable to assign location.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleResetAll() {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch("/api/google/locations/reset", {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; reset?: number };
      if (!response.ok) {
        setError(data.error ?? "Failed to reset assignments.");
        return;
      }
      toast.success(`Moved ${data.reset ?? 0} location(s) to Unassigned`);
      router.refresh();
    } catch {
      setError("Unable to reset assignments.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-[#dadce0] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#202124]"
            style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
          >
            Unassigned Google locations
          </p>
          <p className="mt-1 text-sm font-light text-[#5f6368]">
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
              onClick={() => setConfirmReset(true)}
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

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-[#dadce0] py-10 text-center">
          <MapPin className="h-7 w-7 text-[#c9c7c3]" />
          <p className="mt-2 text-sm font-medium text-[#202124]">
            No unassigned locations
          </p>
          <p className="mt-1 max-w-sm text-xs text-[#5f6368]">
            {connectionId
              ? "Open a client and sync locations from Google, or reset assignments if everything was dumped onto one client."
              : "Connect Google in Settings first, then sync locations."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#f8f9fa] rounded-md border border-[#f8f9fa]">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#202124]">
                  {loc.location_title}
                </p>
                {loc.address_formatted && (
                  <p className="truncate text-xs text-[#5f6368]">
                    {loc.address_formatted}
                  </p>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <select
                  value={assignments[loc.id] ?? ""}
                  onChange={(e) =>
                    setAssignments((prev) => ({
                      ...prev,
                      [loc.id]: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-full border border-[#dadce0] bg-white px-3 text-sm text-[#202124] sm:w-auto"
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
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset all assignments?"
        description="Every location moves back to Unassigned so you can map it to the right client again. Reviews and replies stay as they are."
        confirmLabel="Reset all"
        pendingLabel="Resetting…"
        tone="danger"
        onConfirm={handleResetAll}
      />
    </div>
  );
}
