"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface AuditLogFiltersProps {
  currentAction: string;
  currentUser: string;
  currentEntity: string;
  currentFrom: string;
  currentTo: string;
  actionOptions: string[];
  entityOptions: string[];
  actionLabels: Record<string, string>;
}

export function AuditLogFilters({
  currentAction,
  currentUser,
  currentEntity,
  currentFrom,
  currentTo,
  actionOptions,
  entityOptions,
  actionLabels,
}: AuditLogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const hasFilters =
    currentAction || currentUser || currentEntity || currentFrom || currentTo;

  function clearAll() {
    router.push(pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Action filter */}
      <select
        value={currentAction}
        onChange={(e) => updateParam("action", e.target.value)}
        className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        aria-label="Filter by action"
      >
        <option value="">All actions</option>
        {actionOptions.map((a) => (
          <option key={a} value={a}>
            {actionLabels[a] ?? a}
          </option>
        ))}
      </select>

      {/* Entity type filter */}
      {entityOptions.length > 0 && (
        <select
          value={currentEntity}
          onChange={(e) => updateParam("entity", e.target.value)}
          className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by entity type"
        >
          <option value="">All entities</option>
          {entityOptions.map((e) => (
            <option key={e} value={e}>
              {e.replace("grm_", "").replaceAll("_", " ")}
            </option>
          ))}
        </select>
      )}

      {/* Date range */}
      <div className="flex items-center gap-1">
        <label className="text-xs text-gray-500" htmlFor="audit-from">
          From
        </label>
        <input
          id="audit-from"
          type="date"
          value={currentFrom}
          onChange={(e) => updateParam("from", e.target.value)}
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter from date"
        />
      </div>
      <div className="flex items-center gap-1">
        <label className="text-xs text-gray-500" htmlFor="audit-to">
          To
        </label>
        <input
          id="audit-to"
          type="date"
          value={currentTo}
          onChange={(e) => updateParam("to", e.target.value)}
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter to date"
        />
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="h-8 rounded-md px-2.5 text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
