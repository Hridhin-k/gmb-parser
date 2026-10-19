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
  locations: Array<{ id: string; clientId: string; groupId?: string | null; parentGroupId?: string | null; name: string }>;
  groupId?: string;
  groups?: Array<{ id: string; name: string }>;
  hideLocation?: boolean;
  /** Header scope selector owns organisation, group, and outlet. */
  hidePlace?: boolean;
  /** Header already owns the client selector. */
  hideClient?: boolean;
  /** Header already owns the date range. */
  hideRange?: boolean;
}

export function AnalyticsFilters({
  range,
  defaultRange,
  clientId,
  clients,
  locationId,
  locations,
  groupId = "",
  groups = [],
  hideLocation = false,
  hidePlace = false,
  hideClient = false,
  hideRange = false,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pending, start: startTransition } = useScopedTransition();

  const visibleLocations = locations.filter(
    (location) =>
      (!clientId || location.clientId === clientId) &&
      (!groupId || location.groupId === groupId || location.parentGroupId === groupId)
  );

  const hasActive =
    (!hideClient && !!clientId) ||
    !!locationId ||
    !!groupId ||
    (!hideRange && (range.key !== defaultRange || searchParams.has("months")));

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
      {hideRange ? null : (
        <DateRangeFilter value={range} defaultKey={defaultRange} onChange={navigate} />
      )}

      {hideClient ? null : (
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
      )}

      {hidePlace || groups.length === 0 ? null : (
        <SelectField
          label="Filter by group"
          value={groups.some((group) => group.id === groupId) ? groupId : ""}
          placeholder="All groups"
          className="sm:w-56"
          onValueChange={(next) => navigate({ group: next || null, location: null })}
          options={[
            { value: "", label: "All groups" },
            ...groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
        />
      )}

      {hidePlace || hideLocation ? null : (
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
      )}

      {hasActive ? (
        <ClearFiltersButton
          onClear={() => {
            const params = new URLSearchParams();
            if (hideClient || hidePlace) {
              for (const key of ["client", "group", "location"]) {
                const value = searchParams.get(key);
                if (value) params.set(key, value);
              }
            }
            if (hideRange) {
              for (const key of ["range", "from", "to"]) {
                const value = searchParams.get(key);
                if (value) params.set(key, value);
              }
            }
            const qs = params.toString();
            startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
          }}
          disabled={pending}
        />
      ) : null}
    </div>
  );
}
