import { DATE_RANGE_OPTIONS, type DateRangeKey } from "@/lib/date-range";

export interface FilterApplyCopy {
  title: string;
  detail: string;
}

export interface TimeFilterChange {
  range: string | null;
  from: string | null;
  to: string | null;
}

/** Copy shown while a time-range change is still loading. */
export function timeFilterApply(change: TimeFilterChange, defaultKey: DateRangeKey): FilterApplyCopy {
  const key = (change.range ?? defaultKey) as DateRangeKey;
  if (key === "custom") {
    const when =
      change.from && change.to
        ? `${change.from} to ${change.to}`
        : change.from
          ? `from ${change.from}`
          : change.to
            ? `until ${change.to}`
            : "the dates you chose";
    return {
      title: "Applying custom dates",
      detail: `Loading custom dates (${when}). The numbers on this page stay on the previous period until this filter finishes.`,
    };
  }
  const label = DATE_RANGE_OPTIONS.find((option) => option.key === key)?.label ?? "This period";
  return {
    title: `Applying ${label}`,
    detail: `Loading ${label}. The numbers on this page stay on the previous period until this filter finishes.`,
  };
}

/** Copy shown while an organisation, group, or outlet change is still loading. */
export function scopeFilterApply(choice: { kind: string; label: string }): FilterApplyCopy {
  return {
    title: `Applying ${choice.label}`,
    detail: `The ${choice.kind.toLowerCase()} filter is loading. The numbers on this page stay on the previous selection until this filter finishes.`,
  };
}
