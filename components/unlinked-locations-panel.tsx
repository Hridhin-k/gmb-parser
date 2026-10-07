"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Link2, ChevronDown, ChevronUp } from "lucide-react";

interface UnlinkedLocation {
  id: string;
  location_title: string;
  address_formatted: string | null;
  google_location_name: string;
  grm_google_accounts: {
    account_display_name: string;
  } | null;
}

interface UnlinkedLocationsPanelProps {
  clientId: string;
  locations: UnlinkedLocation[];
}

export function UnlinkedLocationsPanel({
  clientId,
  locations,
}: UnlinkedLocationsPanelProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(locationId: string) {
    setError(null);
    setLoadingId(locationId);
    try {
      const response = await fetch(
        `/api/clients/${clientId}/locations/${locationId}`,
        { method: "PUT" }
      );
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "Failed to connect location.");
        return;
      }
      router.refresh();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoadingId(null);
    }
  }

  if (locations.length === 0) return null;

  return (
    <div className="rounded-3xl border border-[#dadce0] bg-[#e8f0fe]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="min-w-0 pr-3">
          <p className="text-sm font-medium text-blue-900">
            {locations.length} unassigned location
            {locations.length !== 1 ? "s" : ""} you can add here
          </p>
          <p className="text-xs text-blue-700">
            Assign these Google profiles to this client. A client can have
            multiple locations.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-blue-700" />
        ) : (
          <ChevronDown className="h-4 w-4 text-blue-700" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-blue-200 px-4 pb-4 pt-2 space-y-2">
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between rounded-md bg-white px-3 py-2.5 shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#202124]">
                  {loc.location_title}
                </p>
                <p className="truncate text-xs text-[#5f6368]">
                  {loc.address_formatted ??
                    loc.grm_google_accounts?.account_display_name ??
                    loc.google_location_name}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="ml-3 shrink-0"
                onClick={() => handleConnect(loc.id)}
                disabled={loadingId === loc.id}
              >
                <Link2 className="h-3.5 w-3.5" />
                {loadingId === loc.id ? "Assigning…" : "Assign"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
