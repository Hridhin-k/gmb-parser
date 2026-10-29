"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { visibleMobileNav, type ShellRole } from "@/lib/shell";

function itemClass(active: boolean): string {
  return `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${active ? "font-medium text-ink" : "text-slate"}`;
}

export function MobileNav({ summary, role }: { summary: ShellSummary; role: ShellRole }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = new URLSearchParams();
  for (const key of ["client", "group", "location"] as const) {
    const value = params.get(key);
    if (value) search.set(key, value);
  }
  for (const key of ["range", "from", "to"] as const) {
    const value = params.get(key);
    if (value) search.set(key, value);
  }
  const query = search.toString();
  const href = (path: string) => (query ? `${path}?${query}` : path);
  const items = visibleMobileNav(role);

  return (
    <nav
      aria-label="Mobile work"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-silver bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active =
            item.href === "/m"
              ? pathname === "/m"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge =
            item.badge === "drafts"
              ? summary.drafts
              : item.badge === "escalations"
                ? summary.escalations
                : null;
          return (
            <Link
              key={item.id}
              href={href(item.href)}
              className={itemClass(active)}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
              {badge !== null ? <span className="text-[11px] text-slate">{badge}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
