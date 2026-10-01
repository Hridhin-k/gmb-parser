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
        className="h-10 rounded-full border border-[#e4e2de] bg-white px-4 text-sm text-[#18161a] focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
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
          className="h-10 rounded-full border border-[#e4e2de] bg-white px-4 text-sm text-[#18161a] focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
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
        <label className="text-xs font-medium text-[#898b91]" htmlFor="audit-from">
          From
        </label>
        <input
          id="audit-from"
          type="date"
          value={currentFrom}
          onChange={(e) => updateParam("from", e.target.value)}
          className="h-10 rounded-full border border-[#e4e2de] bg-white px-3 text-sm text-[#18161a] focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
          aria-label="Filter from date"
        />
      </div>
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-[#898b91]" htmlFor="audit-to">
          To
        </label>
        <input
          id="audit-to"
          type="date"
          value={currentTo}
          onChange={(e) => updateParam("to", e.target.value)}
          className="h-10 rounded-full border border-[#e4e2de] bg-white px-3 text-sm text-[#18161a] focus:border-[#18161a] focus:outline-none focus:ring-2 focus:ring-[#f3f1ee]"
          aria-label="Filter to date"
        />
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="h-10 rounded-full px-3 text-sm font-medium text-[#18161a] hover:text-[#18161a]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
