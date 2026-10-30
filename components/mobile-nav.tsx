"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Flag, Home, type LucideIcon } from "lucide-react";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { cn } from "@/lib/utils";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  count,
  tone = "default",
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  count?: number;
  tone?: "default" | "bad" | "ai";
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={count != null ? `${label}, ${count.toLocaleString("en-US")} waiting` : label}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
        active ? "text-brand" : "text-ink-3 hover:text-ink"
      )}
    >
      <span className="relative">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        {count != null && count > 0 ? (
          <span
            aria-hidden
            className={cn(
              "absolute -right-3 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[16px] tabular-nums",
              tone === "bad" ? "bg-bad text-white" : tone === "ai" ? "bg-ai text-white" : "bg-ink-2 text-white"
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

export function MobileNav({ summary }: { summary: ShellSummary }) {
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
  const overview = pathname === "/m";
  const approve = pathname.startsWith("/m/approve");
  const escalations = pathname.startsWith("/m/escalations");

  return (
    <nav
      aria-label="Mobile work"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-lg">
        <NavItem href={href("/m")} label="Home" icon={Home} active={overview} />
        <NavItem href={href("/m/approve")} label="Approve" icon={Check} active={approve} count={summary.drafts} tone="ai" />
        <NavItem
          href={href("/m/escalations")}
          label="Cases"
          icon={Flag}
          active={escalations}
          count={summary.escalations}
          tone="bad"
        />
      </div>
    </nav>
  );
}
