"use client";

import { useRouter } from "next/navigation";
import { useScopedTransition } from "@/components/transition-scope";
import { SelectField } from "@/components/ui/select-field";

export interface PeriodOption {
  key: string;
  label: string;
  href: string;
  pressed: boolean;
}

/** Period URLs are built on the server so changing dates preserves scope. */
export function PeriodToggle({ options }: { options: PeriodOption[] }) {
  const router = useRouter();
  const { start } = useScopedTransition();
  return (
    <div className="shrink-0">
    <SelectField label="Reporting period" value={options.find((o) => o.pressed)?.key ?? "3m"}
      className="min-w-[11rem]" options={options.map((o) => ({ value: o.key, label: o.label }))}
      onValueChange={(key) => {
        const option = options.find((o) => o.key === key);
        if (option && !option.pressed) start(() => router.push(option.href, { scroll: false }));
      }} />
    </div>
  );
}
