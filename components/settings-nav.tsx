import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  id: string;
  label: string;
  href: string;
  /** Section heading this item sits under. */
  group: "Replies and AI" | "Workspace";
  /** Shown disabled with this note instead of a link. */
  comingSoon?: boolean;
}

/** Left settings sub-nav. Collapses to a scrollable row on narrow screens. */
export function SettingsNav({ items, active }: { items: SettingsNavItem[]; active: string }) {
  const groups = ["Replies and AI", "Workspace"] as const;
  return (
    <nav aria-label="Settings sections" className="lg:w-[208px] lg:shrink-0">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {groups.map((group) => {
          const rows = items.filter((item) => item.group === group);
          if (!rows.length) return null;
          return (
            <div key={group} className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5">
              <p className="hidden px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 first:pt-0 lg:block">
                {group}
              </p>
              {rows.map((item) =>
                item.comingSoon ? (
                  <span
                    key={item.id}
                    aria-disabled="true"
                    title="Not available yet"
                    className="flex shrink-0 cursor-not-allowed items-center justify-between gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] text-ink-3"
                  >
                    {item.label}
                    <span className="rounded-sm bg-paper px-1.5 py-0.5 text-[10px] font-medium text-ink-3">Coming soon</span>
                  </span>
                ) : (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={item.id === active ? "page" : undefined}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px]",
                      item.id === active
                        ? "bg-brand-tint font-medium text-brand"
                        : "text-ink-2 hover:bg-white hover:text-ink"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
