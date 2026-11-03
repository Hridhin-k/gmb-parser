import Link from "next/link";
import { cn } from "@/lib/utils";

export interface InboxTabLink {
  label: string;
  href: string;
  active: boolean;
  count: number;
}

/** To reply / Follow-ups / Sent, each with its count. The active tab is underlined in ink. */
export function InboxTabs({ tabs, className }: { tabs: InboxTabLink[]; className?: string }) {
  return (
    <nav aria-label="Review status" className={cn("flex flex-wrap gap-1 border-b border-line", className)}>
      {tabs.map((tab) => (
        <Link
          key={tab.href + tab.label}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors sm:gap-2 sm:px-3.5",
            tab.active ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-ink-3 hover:text-ink"
          )}
        >
          {tab.label}
          <span
            className={cn(
              "rounded-full px-[7px] py-px text-xs font-semibold tabular-nums",
              tab.active ? "bg-ink text-white" : "bg-line-2 text-ink-2"
            )}
          >
            {tab.count.toLocaleString("en-US")}
          </span>
        </Link>
      ))}
    </nav>
  );
}
