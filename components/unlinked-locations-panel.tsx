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
    <section className="overflow-hidden rounded-lg border border-info-line bg-info-tint">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">
            {locations.length} unassigned location
            {locations.length !== 1 ? "s" : ""} you can add here
          </p>
          <p className="text-xs text-ink-2">
            Assign these Google profiles to this business. A business can have many locations.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="size-4 shrink-0 text-info" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-info" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-info-line px-4 pt-2 pb-4">
          {error && (
            <p className="text-[13px] text-bad" role="alert">
              {error}
            </p>
          )}
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  {loc.location_title}
                </p>
                <p className="truncate text-xs text-ink-3">
                  {loc.address_formatted ??
                    loc.grm_google_accounts?.account_display_name ??
                    loc.google_location_name}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => handleConnect(loc.id)}
                loading={loadingId === loc.id}
                disabled={loadingId === loc.id}
              >
                <Link2 className="size-3.5" aria-hidden />
                {loadingId === loc.id ? "Assigning…" : "Assign"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
