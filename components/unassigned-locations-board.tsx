"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Link2, MapPin, RotateCcw } from "lucide-react";

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
    <div className="space-y-4 rounded-xl bg-white shadow-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            className="text-[22px] leading-[1.3] text-graphite"
            style={{ fontFamily: "var(--font-heading), sans-serif" }}
          >
            Unassigned Google locations
          </p>
          <p className="mt-1 text-sm font-light text-slate">
            Profiles that are not on a client yet. Pick the client each one
            belongs to.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {connectionId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(true)}
              loading={resetting}
            >
              <RotateCcw aria-hidden />
              {resetting ? "Resetting…" : "Reset all to Unassigned"}
            </Button>
          )}
        </div>
      </div>

      {resetting ? (
        <ActivityStatus
          title="Moving every location back to Unassigned"
          detail="Clients stay. Each Google profile will need to be assigned again."
        />
      ) : null}
      {loadingId ? (
        <ActivityStatus
          title="Assigning this location"
          detail="Saving which client owns this Google profile."
        />
      ) : null}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {locations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-silver py-10 text-center">
          <MapPin className="h-7 w-7 text-[#c9c7c3]" />
          <p className="mt-2 text-sm font-medium text-graphite">
            No unassigned locations
          </p>
          <p className="mt-1 max-w-sm text-xs text-slate">
            {connectionId
              ? "Open a client and sync locations from Google, or reset assignments if everything was dumped onto one client."
              : "Connect Google in Settings first, then sync locations."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-silver rounded-md border border-silver">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-graphite">
                  {loc.location_title}
                </p>
                {loc.address_formatted && (
                  <p className="truncate text-xs text-slate">
                    {loc.address_formatted}
                  </p>
                )}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <SelectField
                  label={`Assign ${loc.location_title} to client`}
                  value={assignments[loc.id] ?? ""}
                  disabled={clients.length === 0}
                  placeholder={clients.length === 0 ? "Sync profiles first" : "Select client"}
                  className="sm:w-56"
                  onValueChange={(next) =>
                    setAssignments((prev) => ({
                      ...prev,
                      [loc.id]: next,
                    }))
                  }
                  options={[
                    {
                      value: "",
                      label: clients.length === 0 ? "Sync profiles first" : "Select client",
                    },
                    ...clients.map((client) => ({ value: client.id, label: client.name })),
                  ]}
                />
                <Button
                  size="sm"
                  onClick={() => handleAssign(loc.id)}
                  loading={loadingId === loc.id}
                  disabled={loadingId === loc.id || clients.length === 0}
                  className="gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
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
