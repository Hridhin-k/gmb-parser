"use client";

import { useRouter } from "next/navigation";
import { useScopedTransition } from "@/components/transition-scope";
import { cn } from "@/lib/utils";

export interface PeriodOption {
  key: string;
  label: string;
  href: string;
  pressed: boolean;
}

/** 7 / 30 / 90 days. Each option is a URL built on the server, so scope params are kept. */
export function PeriodToggle({ options }: { options: PeriodOption[] }) {
  const router = useRouter();
  const { start } = useScopedTransition();
  return (
    <div role="group" aria-label="Period" className="flex rounded-full bg-[#eaecf0] p-[3px]">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.pressed}
          onClick={() => {
            if (option.pressed) return;
            start(() => router.push(option.href, { scroll: false }));
          }}
          className={cn(
            "flex h-[34px] cursor-pointer items-center rounded-full px-4 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand",
            option.pressed ? "bg-white text-ink shadow-[0_1px_2px_rgba(20,24,31,0.12)]" : "text-ink-2 hover:text-ink"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
