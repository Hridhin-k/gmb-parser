"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useScopedTransition } from "@/components/transition-scope";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { DateRangeFilter } from "@/components/date-range-filter";
import { SelectField } from "@/components/ui/select-field";
import type { DateRangeKey } from "@/lib/date-range";

interface Option {
  value: string;
  label: string;
}

interface AuditLogFiltersProps {
  currentAction: string;
  currentUser: string;
  currentEntity: string;
  currentRange: { key: DateRangeKey; from: string; to: string };
  actionOptions: Option[];
  entityOptions: Option[];
  memberOptions: Option[];
}

export function AuditLogFilters({
  currentAction,
  currentUser,
  currentEntity,
  currentRange,
  actionOptions,
  entityOptions,
  memberOptions,
}: AuditLogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { start: startTransition } = useScopedTransition();

  const updateParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [router, pathname, searchParams, startTransition]
  );
  const updateParam = (key: string, value: string) => updateParams({ [key]: value });

  const hasFilters =
    currentAction || currentUser || currentEntity || currentRange.key !== "all";

  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Filter the audit log">
      <SelectField
        label="Filter by action"
        value={currentAction}
        placeholder="All actions"
        size="sm"
        className="sm:w-auto"
        onValueChange={(next) => updateParam("action", next)}
        options={[{ value: "", label: "All actions" }, ...actionOptions]}
      />

      <SelectField
        label="Filter by object type"
        value={currentEntity}
        placeholder="All objects"
        size="sm"
        className="sm:w-auto"
        onValueChange={(next) => updateParam("entity", next)}
        options={[{ value: "", label: "All objects" }, ...entityOptions]}
      />

      {memberOptions.length > 1 && (
        <SelectField
          label="Filter by actor"
          value={currentUser}
          placeholder="Everyone"
          size="sm"
        className="sm:w-auto"
          onValueChange={(next) => updateParam("user", next)}
          options={[{ value: "", label: "Everyone" }, ...memberOptions]}
        />
      )}

      <DateRangeFilter value={currentRange} defaultKey="all" onChange={updateParams} />

      {hasFilters && <ClearFiltersButton onClear={() => startTransition(() => router.push(pathname))} />}
    </div>
  );
}
