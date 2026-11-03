import Link from "next/link";
import { cn } from "@/lib/utils";

export const SETTINGS_GROUPS = ["Replies", "Workspace", "Account"] as const;

export interface SettingsNavItem {
  id: string;
  label: string;
  href: string;
  /** Section heading this item sits under. */
  group: (typeof SETTINGS_GROUPS)[number];
}

/** Grouped settings sections. On a phone the groups sit in one row that scrolls sideways. */
export function SettingsNav({ items, active }: { items: SettingsNavItem[]; active: string }) {
  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:w-[208px] lg:shrink-0">
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {SETTINGS_GROUPS.map((group) => {
          const rows = items.filter((item) => item.group === group);
          if (!rows.length) return null;
          return (
            <div key={group} className="flex shrink-0 flex-col gap-0.5">
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{group}</p>
              <div className="flex gap-0.5 lg:flex-col">
                {rows.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={item.id === active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 text-sm",
                      item.id === active
                        ? "bg-brand-tint font-semibold text-brand"
                        : "font-medium text-ink-2 hover:bg-white hover:text-ink"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
