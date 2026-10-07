"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useScopedTransition } from "@/components/transition-scope";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SelectField } from "@/components/ui/select-field";
import type { DateRangeKey } from "@/lib/date-range";
import { cn } from "@/lib/utils";

interface AnalyticsFiltersProps {
  range: { key: DateRangeKey; from: string; to: string };
  defaultRange: DateRangeKey;
  clientId: string;
  clients: Array<{ id: string; name: string }>;
  locationId: string;
  locations: Array<{ id: string; clientId: string; name: string }>;
}

export function AnalyticsFilters({
  range,
  defaultRange,
  clientId,
  clients,
  locationId,
  locations,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, start: startTransition } = useScopedTransition();

  const visibleLocations = clientId
    ? locations.filter((l) => l.clientId === clientId)
    : locations;

  const hasActive =
    !!clientId || !!locationId || range.key !== defaultRange || searchParams.has("months");

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("months");
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center",
        pending && "opacity-70"
      )}
    >
      <DateRangeFilter value={range} defaultKey={defaultRange} onChange={navigate} />

      <SelectField
        label="Filter by client"
        value={clientId}
        placeholder="All clients"
        className="sm:w-64"
        onValueChange={(next) => navigate({ client: next || null, location: null })}
        options={[
          { value: "", label: "All clients" },
          ...clients.map((client) => ({ value: client.id, label: client.name })),
        ]}
      />

      <SelectField
        label="Filter by location"
        value={visibleLocations.some((location) => location.id === locationId) ? locationId : ""}
        placeholder="All locations"
        disabled={visibleLocations.length === 0}
        className="sm:w-72"
        onValueChange={(next) => {
          const owner = locations.find((location) => location.id === next)?.clientId ?? null;
          navigate(next && !clientId && owner ? { location: next, client: owner } : { location: next || null });
        }}
        options={[
          { value: "", label: "All locations" },
          ...visibleLocations.map((location) => ({ value: location.id, label: location.name })),
        ]}
      />

      {hasActive ? (
        <ClearFiltersButton
          onClear={() => startTransition(() => router.push(pathname))}
          disabled={pending}
        />
      ) : null}
    </div>
  );
}
