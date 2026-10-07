"use client";

import {
  DATE_RANGE_OPTIONS,
  defaultCustomDays,
  type DateRangeKey,
} from "@/lib/date-range";
import { DatePicker } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";

export type DateRangeChange = { range: string | null; from: string | null; to: string | null };

interface DateRangeFilterProps {
  value: { key: DateRangeKey; from: string; to: string };
  /** The page's default range; selecting it removes the params from the URL. */
  defaultKey: DateRangeKey;
  onChange: (change: DateRangeChange) => void;
  disabled?: boolean;
  selectClassName?: string;
  dateClassName?: string;
}

export function DateRangeFilter({
  value,
  defaultKey,
  onChange,
  disabled,
  selectClassName,
  dateClassName,
}: DateRangeFilterProps) {
  function selectKey(key: DateRangeKey) {
    if (key === "custom") {
      const days = defaultCustomDays();
      onChange({ range: "custom", from: value.from || days.from, to: value.to || days.to });
    } else {
      onChange({ range: key === defaultKey ? null : key, from: null, to: null });
    }
  }

  function setDay(field: "from" | "to", day: string) {
    const next = { from: value.from, to: value.to, [field]: day };
    if (!next.from && !next.to) {
      onChange({ range: defaultKey === "all" ? null : "all", from: null, to: null });
      return;
    }
    onChange({ range: "custom", from: next.from || null, to: next.to || null });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <SelectField
        label="Time range"
        value={value.key}
        disabled={disabled}
        className={selectClassName}
        onValueChange={(next) => selectKey(next as DateRangeKey)}
        options={DATE_RANGE_OPTIONS.map((option) => ({
          value: option.key,
          label: option.label,
        }))}
      />
      {value.key === "custom" ? (
        <>
          <DatePicker
            label="From"
            value={value.from}
            max={value.to || undefined}
            disabled={disabled}
            className={dateClassName}
            onChange={(day) => setDay("from", day)}
          />
          <span className="text-xs text-slate">to</span>
          <DatePicker
            label="To"
            value={value.to}
            min={value.from || undefined}
            disabled={disabled}
            className={dateClassName}
            onChange={(day) => setDay("to", day)}
          />
        </>
      ) : null}
    </div>
  );
}
