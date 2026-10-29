"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback, useTransition } from "react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Bell,
  Building2,
  ChartColumn,
  ChevronsUpDown,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  Link2,
  MapPin,
  MessageSquareText,
  Receipt,
  Settings,
  UsersRound,
  X,
} from "lucide-react";
import { NavLinkIcon } from "@/components/nav-link-icon";
import { Button } from "@/components/ui/button";
import { FilterApplyFrame, FilterNavigation } from "@/components/filter-navigation";
import { ShellHeader } from "@/components/shell-header";
import { MobileNav } from "@/components/mobile-nav";
import { ActivityStatus } from "@/components/activity-status";
import { SelectField } from "@/components/ui/select-field";
import { GlobalFilters } from "@/components/global-filters";
import type { ScopeCatalog } from "@/lib/scope";
import type { ShellSummary } from "@/lib/services/shell-summary";
import {
  canOpenPath,
  homePath,
  scopedHref,
  visibleNav,
  type ShellFeatureFlags,
  type ShellNavId,
} from "@/lib/shell";
import { toast } from "sonner";
import { type AttentionEventDetail } from "@/lib/attention-client";

const NAV: Record<
  ShellNavId,
  { href: string; label: string; icon: typeof LayoutDashboard; section: "work" | "manage" | "agency" }
> = {
  overview: { href: "/overview", label: "Overview", icon: LayoutDashboard, section: "work" },
  inbox: { href: "/reviews", label: "Inbox", icon: MessageSquareText, section: "work" },
  escalations: { href: "/escalations", label: "Escalations", icon: AlertTriangle, section: "work" },
  analytics: { href: "/analytics", label: "Analytics", icon: ChartColumn, section: "work" },
  insights: { href: "/insights", label: "Insights", icon: Lightbulb, section: "work" },
  reports: { href: "/reports", label: "Reports and alerts", icon: Bell, section: "work" },
  requests: { href: "/requests", label: "Review requests", icon: Link2, section: "work" },
  locations: { href: "/clients", label: "Locations and groups", icon: MapPin, section: "manage" },
  team: { href: "/team", label: "Team and roles", icon: UsersRound, section: "manage" },
  settings: { href: "/settings", label: "Settings", icon: Settings, section: "manage" },
  clients: { href: "/dashboard", label: "All clients", icon: LayoutGrid, section: "agency" },
  usage: { href: "/usage", label: "Usage", icon: Receipt, section: "agency" },
};

const SECTIONS = [
  { label: null, ids: ["overview", "inbox", "escalations", "analytics", "insights", "reports", "requests"] as const },
  { label: "Manage", ids: ["locations", "team", "settings"] as const },
  { label: "Agency", ids: ["clients", "usage"] as const },
];

interface AppShellProps {
  user: User;
  role: string | null;
  workspaceName: string;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  clients: Array<{ id: string; name: string }>;
  catalog: ScopeCatalog | null;
  summary: ShellSummary;
  logoUrl?: string | null;
  productTitle?: string;
  features?: ShellFeatureFlags;
  children: React.ReactNode;
}

function ClientInitial({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase",
        active ? "bg-white text-navy" : "bg-white/10 text-white"
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

function navActive(pathname: string, href: string, hash: string) {
  const [path, fragment] = href.split("#");
  if (fragment) return pathname === path && hash === `#${fragment}`;
  if (pathname === path && hash) return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function badgeFor(id: ShellNavId, summary: ShellSummary): number {
  if (id === "inbox") return summary.unreplied;
  if (id === "escalations") return summary.escalations;
  return 0;
}

function SidebarNav({
  role,
  summary,
  pathname,
  hash,
  searchParams,
  onNavigate,
  features,
}: {
  role: string | null;
  summary: ShellSummary;
  pathname: string;
  hash: string;
  searchParams: URLSearchParams;
  onNavigate: () => void;
  features: ShellFeatureFlags;
}) {
  const allowed = new Set(visibleNav(role, features));
  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
      active
        ? "bg-white/15 font-medium text-white"
        : "text-white/75 hover:bg-white/10 hover:text-white"
    );

  return (
    <>
      {SECTIONS.map((section) => {
        const items = section.ids.filter((id) => allowed.has(id));
        if (items.length === 0) return null;
        return (
          <div key={section.label ?? "work"}>
            {section.label ? (
              <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-white/40">
                {section.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {items.map((id) => {
                const item = NAV[id];
                const href = scopedHref(item.href, searchParams, pathname);
                const active = navActive(pathname, item.href, hash);
                const badge = badgeFor(id, summary);
                return (
                  <Link
                    key={id}
                    href={href}
                    onClick={onNavigate}
                    className={linkClass(active)}
                    aria-current={active ? "page" : undefined}
                  >
                    <NavLinkIcon icon={item.icon} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badge > 0 ? (
                      <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-navy">
                        {badge > 99 ? "99+" : badge.toLocaleString("en-US")}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function SidebarNavLive(
  props: Omit<Parameters<typeof SidebarNav>[0], "searchParams" | "hash">
) {
  const searchParams = useSearchParams();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [props.pathname]);

  return <SidebarNav {...props} hash={hash} searchParams={searchParams} />;
}

export function AppShell({
  user,
  role,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  clients,
  catalog,
  summary,
  logoUrl,
  productTitle = "RevuPilot",
  features = {},
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const [opened, setOpened] = useState({ unreplied: 0, escalations: 0, alerts: [] as string[] });
  const summaryKey = `${summary.unreplied}:${summary.escalations}:${summary.notices.map((notice) => notice.id).join(",")}:${summary.dismissedAlerts.map((alert) => `${alert.id}:${alert.title}`).join(",")}`;
  const [syncedSummary, setSyncedSummary] = useState(summaryKey);
  if (syncedSummary !== summaryKey) {
    setSyncedSummary(summaryKey);
    setOpened({ unreplied: 0, escalations: 0, alerts: [] });
  }
  useEffect(() => {
    function apply(detail: AttentionEventDetail, direction: 1 | -1) {
      setOpened((current) => ({
        unreplied: Math.max(0, current.unreplied + direction * (detail.countsAsUnreplied ? 1 : 0)),
        escalations: Math.max(0, current.escalations + direction * (detail.countsAsEscalation ? 1 : 0)),
        alerts:
          detail.kind === "alert"
            ? direction === 1
              ? [...current.alerts, `${detail.id}\0${detail.title ?? ""}`]
              : current.alerts.filter((token) => token !== `${detail.id}\0${detail.title ?? ""}`)
            : current.alerts,
      }));
    }
    function onAttention(event: Event) {
      const detail = (event as CustomEvent<AttentionEventDetail>).detail;
      if (detail) apply(detail, 1);
    }
    function onFailed(event: Event) {
      const detail = (event as CustomEvent<AttentionEventDetail>).detail;
      if (detail) apply(detail, -1);
    }
    window.addEventListener("grm-attention", onAttention);
    window.addEventListener("grm-attention-failed", onFailed);
    return () => {
      window.removeEventListener("grm-attention", onAttention);
      window.removeEventListener("grm-attention-failed", onFailed);
    };
  }, []);
  const displaySummary: ShellSummary = {
    ...summary,
    unreplied: Math.max(0, summary.unreplied - opened.unreplied),
    escalations: Math.max(0, summary.escalations - opened.escalations),
    dismissedAlerts: [
      ...summary.dismissedAlerts,
      ...opened.alerts.map((token) => {
        const splitAt = token.indexOf("\0");
        return { id: token.slice(0, splitAt), title: token.slice(splitAt + 1) };
      }),
    ],
  };
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

  const home = homePath(role);
  const closeSidebar = () => setSidebarOpen(false);
  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
      active
        ? "bg-white/15 font-medium text-white"
        : "text-white/75 hover:bg-white/10 hover:text-white"
    );

  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return (
      <FilterNavigation>
      <div className="flex h-dvh flex-col overflow-hidden bg-paper">
        <header className="shrink-0 border-b border-silver bg-white px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-ink">{workspaceName}</p>
            <Link href={scopedHref(home, searchParams, pathname)} className="shrink-0 text-sm text-ink underline">
              Full app
            </Link>
          </div>
          {catalog ? (
            <div className="mt-2">
              <GlobalFilters catalog={catalog} showDate={false} />
            </div>
          ) : null}
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto" id="main-content">
          <div className="mx-auto w-full max-w-lg px-4 py-4 pb-28">
            <FilterApplyFrame>{children}</FilterApplyFrame>
          </div>
        </main>
        <Suspense fallback={null}>
          <MobileNav summary={displaySummary} role={role} />
        </Suspense>
      </div>
      </FilterNavigation>
    );
  }

  return (
    <FilterNavigation>
    <div className="flex h-dvh overflow-hidden bg-paper">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={closeSidebar}
          role="presentation"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(100%,16.5rem)] flex-col bg-navy text-white transition-transform duration-150 ease-out lg:static lg:w-56",
          sidebarOpen ? "translate-x-0" : "max-lg:-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <Link
            href={scopedHref(home, searchParams, pathname)}
            onClick={closeSidebar}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-white/15 bg-white/10 px-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
          >
            {logoUrl ? (
              // The agency supplied this URL. It is shown only after they save it.
              <img src={logoUrl} alt="" className="size-6 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white text-navy">
                <Building2 className="size-3.5" aria-hidden />
              </span>
            )}
            <span className="min-w-0 truncate">
              <span className="block truncate">{productTitle}</span>
              {productTitle !== workspaceName && workspaces.length > 1 ? (
                <span className="block truncate text-[11px] font-normal text-white/70">{workspaceName}</span>
              ) : null}
            </span>
            {workspaces.length > 1 ? (
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-white/70" aria-hidden />
            ) : null}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 lg:hidden"
            onClick={closeSidebar}
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
                if (workspaceId === activeWorkspaceId) return;
                setSavingWorkspace(true);
                try {
                  const response = await fetch("/api/workspace/active", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspaceId }),
                  });
                  const payload = (await response.json().catch(() => ({}))) as { error?: string };
                  if (!response.ok) {
                    toast.error(payload.error ?? "Could not switch workspace.");
                    return;
                  }
                  startRefresh(() => {
                    router.refresh();
                  });
                } catch {
                  toast.error("Could not reach the server to switch workspace.");
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
          <Suspense fallback={null}>
            <SidebarNavLive
              role={role}
              summary={displaySummary}
              pathname={pathname}
              onNavigate={closeSidebar}
              features={features}
            />
          </Suspense>

          {canOpenPath("/clients", role) ? (
            <>
              <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-white/40">
                Jump to client
              </p>
              <div className="space-y-0.5">
                {clients.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-white/50">No clients yet</p>
                ) : (
                  clients.map((client) => {
                    const href = `/clients/${client.id}`;
                    const active = pathname === href;
                    return (
                      <Link
                        key={client.id}
                        href={href}
                        onClick={closeSidebar}
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
            </>
          ) : null}
        </nav>

        <div className="flex gap-3 border-t border-white/10 px-4 py-3 text-xs text-white/60">
          <a href="/privacy" className="hover:text-white">
            Privacy
          </a>
          <a href="/terms" className="hover:text-white">
            Terms
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<div className="h-14 shrink-0 border-b border-silver bg-white" />}>
          <ShellHeader
            user={user}
            role={role}
            catalog={catalog}
            summary={displaySummary}
            onOpenMenu={() => setSidebarOpen(true)}
          />
        </Suspense>
        <main className="flex-1 overflow-y-auto" id="main-content">
          <div className="mx-auto max-w-[1280px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
            <FilterApplyFrame>{children}</FilterApplyFrame>
          </div>
        </main>
      </div>
    </div>
    </FilterNavigation>
  );
}
