"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ShellSummary } from "@/lib/services/shell-summary";

function itemClass(active: boolean): string {
  return `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${active ? "font-medium text-ink" : "text-slate"}`;
}

export function MobileNav({ summary }: { summary: ShellSummary }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = new URLSearchParams();
  for (const key of ["client", "group", "location"] as const) {
    const value = params.get(key);
    if (value) search.set(key, value);
  }
  const range = params.get("range");
  if (range === "7d" || range === "30d") search.set("range", range);
  const query = search.toString();
  const href = (path: string) => (query ? `${path}?${query}` : path);
  const overview = pathname === "/m";
  const approve = pathname.startsWith("/m/approve");
  const escalations = pathname.startsWith("/m/escalations");

  return (
    <nav
      aria-label="Mobile work"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-silver bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg">
        <Link href={href("/m")} className={itemClass(overview)} aria-current={overview ? "page" : undefined}>
          Overview
        </Link>
        <Link
          href={href("/m/approve")}
          className={itemClass(approve)}
          aria-current={approve ? "page" : undefined}
        >
          Approve
          <span className="text-[11px] text-slate">{summary.drafts}</span>
        </Link>
        <Link
          href={href("/m/escalations")}
          className={itemClass(escalations)}
          aria-current={escalations ? "page" : undefined}
        >
          Escalations
          <span className="text-[11px] text-slate">{summary.escalations}</span>
        </Link>
      </div>
    </nav>
  );
}
