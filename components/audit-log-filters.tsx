"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface Option {
  value: string;
  label: string;
}

interface AuditLogFiltersProps {
  currentAction: string;
  currentUser: string;
  currentEntity: string;
  currentFrom: string;
  currentTo: string;
  actionOptions: Option[];
  entityOptions: Option[];
  memberOptions: Option[];
}

const FIELD =
  "h-10 w-full rounded-full border border-[#dadce0] bg-white px-4 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#e8f0fe] sm:w-auto";

export function AuditLogFilters({
  currentAction,
  currentUser,
  currentEntity,
  currentFrom,
  currentTo,
  actionOptions,
  entityOptions,
  memberOptions,
}: AuditLogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const hasFilters =
    currentAction || currentUser || currentEntity || currentFrom || currentTo;

  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <select
        value={currentAction}
        onChange={(e) => updateParam("action", e.target.value)}
        className={FIELD}
        aria-label="Filter by action"
      >
        <option value="">All actions</option>
        {actionOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={currentEntity}
        onChange={(e) => updateParam("entity", e.target.value)}
        className={FIELD}
        aria-label="Filter by item type"
      >
        <option value="">All items</option>
        {entityOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {memberOptions.length > 1 && (
        <select
          value={currentUser}
          onChange={(e) => updateParam("user", e.target.value)}
          className={FIELD}
          aria-label="Filter by team member"
        >
          <option value="">Everyone</option>
          {memberOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[#5f6368]" htmlFor="audit-from">
          From
        </label>
        <input
          id="audit-from"
          type="date"
          value={currentFrom}
          onChange={(e) => updateParam("from", e.target.value)}
          className={FIELD}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-[#5f6368]" htmlFor="audit-to">
          To
        </label>
        <input
          id="audit-to"
          type="date"
          value={currentTo}
          onChange={(e) => updateParam("to", e.target.value)}
          className={FIELD}
        />
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="h-10 rounded-full px-3 text-sm font-medium text-[#1a73e8] hover:text-[#1967d2]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
