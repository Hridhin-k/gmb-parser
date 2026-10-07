"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useTransition } from "react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import {
  Building2,
  ChartColumn,
  ChevronsUpDown,
  History,
  LayoutGrid,
  MessageSquareText,
  Receipt,
  UsersRound,
  X,
} from "lucide-react";
import { NavLinkIcon } from "@/components/nav-link-icon";
import { Button } from "@/components/ui/button";
import { AgencyTopBar } from "@/components/agency-top-bar";
import { ActivityStatus } from "@/components/activity-status";
import { SelectField } from "@/components/ui/select-field";

const AGENCY_NAV = [
  { href: "/dashboard", label: "All clients", icon: LayoutGrid },
  { href: "/analytics", label: "Client reports", icon: ChartColumn },
  { href: "/settings", label: "Agency staff", icon: UsersRound },
  { href: "/dashboard#usage", label: "Usage and billing", icon: Receipt },
] as const;

const WORK_NAV = [
  { href: "/reviews", label: "Reviews", icon: MessageSquareText },
  { href: "/audit", label: "Audit log", icon: History },
] as const;

interface AppShellProps {
  user: User;
  workspaceName: string;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  clients: Array<{ id: string; name: string }>;
  children: React.ReactNode;
}

function ClientInitial({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase",
        active ? "bg-ink text-white" : "bg-paper text-slate ring-1 ring-silver"
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

function navActive(pathname: string, href: string) {
  if (href.includes("#")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  user,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  clients,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const switching = savingWorkspace || isRefreshing;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sidebarOpen, handleKeyDown]);

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
      active
        ? "bg-paper font-medium text-ink [&_svg]:text-ink"
        : "text-graphite hover:bg-paper hover:text-ink [&_svg]:text-stone hover:[&_svg]:text-graphite"
    );

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          role="presentation"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(100%,16.5rem)] flex-col border-r border-silver bg-white transition-transform duration-150 ease-out lg:static lg:w-56 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <Link
            href="/dashboard"
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-silver bg-white px-2.5 text-sm font-medium text-ink shadow-control transition-colors hover:border-stone"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-ink text-white">
              <Building2 className="size-3.5" aria-hidden />
            </span>
            <span className="truncate">{workspaceName}</span>
            {workspaces.length > 1 ? (
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-stone" aria-hidden />
            ) : null}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-slate lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {workspaces.length > 1 ? (
          <div className="px-3 pb-2">
            <SelectField
              id="workspace-switcher"
              label="Workspace"
              value={activeWorkspaceId}
              disabled={switching}
              className="w-full"
              onValueChange={async (workspaceId) => {
                setSavingWorkspace(true);
                try {
                  await fetch("/api/workspace/active", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspaceId }),
                  });
                  startRefresh(() => {
                    router.refresh();
                  });
                } finally {
                  setSavingWorkspace(false);
                }
              }}
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
              }))}
            />
            {switching ? (
              <div className="mt-2">
                <ActivityStatus
                  title="Opening that workspace"
                  detail="Loading its clients, reviews, and Google connection."
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <nav className="flex-1 overflow-y-auto px-2 pb-4" role="navigation">
          <div className="space-y-0.5">
            {AGENCY_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={linkClass(navActive(pathname, item.href))}
                aria-current={navActive(pathname, item.href) ? "page" : undefined}
              >
                <NavLinkIcon icon={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>

          <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-stone">
            Work
          </p>
          <div className="space-y-0.5">
            {WORK_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={linkClass(navActive(pathname, item.href))}
                aria-current={navActive(pathname, item.href) ? "page" : undefined}
              >
                <NavLinkIcon icon={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>

          <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-stone">
            Jump to client
          </p>
          <div className="space-y-0.5">
            {clients.length === 0 ? (
              <p className="px-3 py-2 text-sm text-stone">No clients yet</p>
            ) : (
              clients.map((client) => {
                const href = `/clients/${client.id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={client.id}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    className={linkClass(active)}
                    aria-current={active ? "page" : undefined}
                  >
                    <ClientInitial name={client.name} active={active} />
                    <span className="block truncate">{client.name}</span>
                  </Link>
                );
              })
            )}
          </div>
        </nav>

        <div className="flex gap-3 border-t border-silver px-4 py-3 text-xs text-slate">
          <a href="/privacy" className="hover:text-ink">
            Privacy
          </a>
          <a href="/terms" className="hover:text-ink">
            Terms
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgencyTopBar user={user} onOpenMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto" id="main-content">
          <div className="mx-auto max-w-[1280px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
