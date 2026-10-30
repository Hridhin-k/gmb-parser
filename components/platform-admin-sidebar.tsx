"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, Building2, Settings2, UsersRound, type LucideIcon } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

const NAV: Array<{ href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }> = [
  { href: "/admin", label: "Tenants", icon: Building2, match: (p) => p === "/admin" || p.startsWith("/admin/tenants") },
  { href: "/admin/users", label: "Users", icon: UsersRound, match: (p) => p.startsWith("/admin/users") },
  { href: "/admin/health", label: "Health", icon: Activity, match: (p) => p.startsWith("/admin/health") },
  { href: "/admin/ops", label: "Operations", icon: Settings2, match: (p) => p.startsWith("/admin/ops") },
];

function initials(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return letters.toUpperCase() || "PA";
}

function Mark() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-white text-xs font-bold text-admin" aria-hidden>
        RP
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-white">Platform admin</p>
        <p className="text-xs text-[#7d8595]">RevuPilot staff only</p>
      </div>
    </div>
  );
}

function NavLinks({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  return (
    <nav aria-label="Platform admin" className={cn("flex gap-0.5", compact ? "flex-row flex-wrap" : "flex-col")}>
      {NAV.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
              active ? "bg-admin-2 text-white" : "text-[#c7cdd8] hover:bg-admin-2/60 hover:text-white"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Dark platform-admin shell: sidebar on desktop, a dark bar with the same links on small screens. */
export function PlatformAdminSidebar({ email }: { email: string }) {
  const pathname = usePathname() ?? "/admin";
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-1 border-r border-[#2a3040] bg-admin p-3 lg:flex">
        <Mark />
        <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7d8595]">Platform</p>
        <NavLinks pathname={pathname} />
        <div className="mt-auto flex flex-col gap-2 border-t border-[#2a3040] px-1 pt-3">
          <div className="flex items-center gap-2.5 px-1">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-admin-2 text-[11px] font-semibold text-white" aria-hidden>
              {initials(email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white" title={email}>{email}</p>
              <p className="text-xs text-[#7d8595]">Platform admin · staff only</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <Link href="/overview" className="inline-flex items-center gap-1 font-medium text-[#afc2f7] hover:text-white">
              <ArrowLeft className="size-3.5" aria-hidden /> Exit to workspace
            </Link>
            <SignOutButton className="text-[#c7cdd8] hover:text-white disabled:opacity-60" />
          </div>
        </div>
      </aside>

      <div className="border-b border-[#2a3040] bg-admin px-4 py-2 lg:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Mark />
          <div className="flex items-center gap-3 text-xs">
            <Link href="/overview" className="font-medium text-[#afc2f7] hover:text-white">Exit to workspace</Link>
            <SignOutButton className="text-[#c7cdd8] hover:text-white disabled:opacity-60" />
          </div>
        </div>
        <div className="mt-1">
          <NavLinks pathname={pathname} compact />
        </div>
        <p className="mt-1 truncate px-2 text-xs text-[#7d8595]">{email} · Platform admin · staff only</p>
      </div>
    </>
  );
}
