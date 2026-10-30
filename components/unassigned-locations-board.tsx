"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { EmptyState } from "@/components/empty-state";
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
      setError("Choose a business before assigning.");
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
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Unassigned Google profiles{locations.length > 0 ? ` · ${locations.length}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Profiles that are not on a business yet. Pick the business each one belongs to.
          </p>
        </div>
        {connectionId ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirmReset(true)}
            loading={resetting}
          >
            <RotateCcw aria-hidden />
            {resetting ? "Resetting…" : "Reset all to unassigned"}
          </Button>
        ) : null}
      </div>

      {resetting || loadingId || error ? (
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
          {resetting ? (
            <ActivityStatus
              title="Moving every location back to Unassigned"
              detail="Businesses stay. Each Google profile will need to be assigned again."
            />
          ) : null}
          {loadingId ? (
            <ActivityStatus
              title="Assigning this location"
              detail="Saving which business owns this Google profile."
            />
          ) : null}
          {error ? (
            <p className="text-xs text-bad" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {locations.length === 0 ? (
        <EmptyState
          bare
          icon={MapPin}
          title="No unassigned locations"
          description={
            connectionId
              ? "Open a business and sync locations from Google, or reset assignments if everything was put on one business."
              : "Connect Google in Settings first, then sync locations."
          }
        />
      ) : (
        <ul className="divide-y divide-line-2">
          {locations.map((loc) => (
            <li
              key={loc.id}
              className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">{loc.location_title}</p>
                {loc.address_formatted ? (
                  <p className="truncate text-xs text-ink-3">{loc.address_formatted}</p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <SelectField
                  label={`Assign ${loc.location_title} to a business`}
                  value={assignments[loc.id] ?? ""}
                  disabled={clients.length === 0}
                  placeholder={clients.length === 0 ? "Sync profiles first" : "Choose business"}
                  size="sm"
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
                      label: clients.length === 0 ? "Sync profiles first" : "Choose business",
                    },
                    ...clients.map((client) => ({ value: client.id, label: client.name })),
                  ]}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAssign(loc.id)}
                  loading={loadingId === loc.id}
                  disabled={loadingId === loc.id || clients.length === 0 || !assignments[loc.id]}
                  title={!assignments[loc.id] ? "Choose a business first" : undefined}
                >
                  <Link2 aria-hidden />
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
        description="Every location moves back to Unassigned so you can map it to the right business again. Reviews and replies stay as they are."
        confirmLabel="Reset all"
        pendingLabel="Resetting…"
        tone="danger"
        onConfirm={handleResetAll}
      />
    </section>
  );
}
