"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Checkbox-list dropdown for filters that accept several values at once.
 * Selection is draft-only: the parent decides when it takes effect (Go).
 */
export function MultiSelectField({
  label,
  values,
  options,
  onChange,
  placeholder = "Any",
  className,
  disabled,
}: {
  label: string;
  values: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((option) => values.includes(option.value));
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]!.label
        : `${selected[0]!.label} +${selected.length - 1}`;

  function toggle(value: string) {
    onChange(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value]
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={`${label}: ${summary}`}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-1.5 rounded-lg border border-silver bg-white py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-50",
          selected.length === 0 && "text-stone",
          className
        )}
      >
        <span className="line-clamp-1 flex-1 text-left">{summary}</span>
        <ChevronDown className="pointer-events-none size-4 shrink-0 text-stone" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-56 gap-0 p-1">
        <div role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto">
          {options.map((option) => {
            const active = values.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => toggle(option.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink outline-none hover:bg-paper focus-visible:bg-paper",
                  active && "font-medium"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-silver bg-white text-white",
                    active && "border-ink bg-ink"
                  )}
                >
                  {active ? <Check className="size-3.5" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
        {values.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-md border-t border-silver px-2 pt-2 pb-1 text-left text-xs font-medium text-slate outline-none hover:text-ink focus-visible:text-ink"
          >
            Clear selection
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
