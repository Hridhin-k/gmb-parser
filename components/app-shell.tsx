"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback, useTransition } from "react";
import { signOut } from "next-auth/react";
import type { User } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChartColumn,
  Check,
  ChevronsUpDown,
  FileText,
  Inbox,
  LayoutGrid,
  Lightbulb,
  LogOut,
  MapPin,
  Home,
  ListChecks,
  Send,
  Settings,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterApplyFrame, FilterNavigation } from "@/components/filter-navigation";
import { ShellHeader } from "@/components/shell-header";
import { MobileNav } from "@/components/mobile-nav";
import { ActivityStatus } from "@/components/activity-status";
import { GlobalFilters } from "@/components/global-filters";
import type { ScopeCatalog } from "@/lib/scope";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { canOpenPath, homePath, scopedHref, visibleNav, type ShellNavId } from "@/lib/shell";
import { roleName } from "@/lib/ui/vocabulary";

type NavKey = ShellNavId | "audit";

const NAV: Record<NavKey, { href: string; label: string; icon: LucideIcon }> = {
  clients: { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
  overview: { href: "/overview", label: "Overview", icon: Home },
  inbox: { href: "/reviews", label: "Reviews", icon: Inbox },
  escalations: { href: "/escalations", label: "Escalations", icon: AlertTriangle },
  analytics: { href: "/analytics", label: "Analytics", icon: ChartColumn },
  insights: { href: "/insights", label: "Insights", icon: Lightbulb },
  reports: { href: "/reports", label: "Reports & alerts", icon: FileText },
  requests: { href: "/requests", label: "Review requests", icon: Send },
  locations: { href: "/locations", label: "Locations", icon: MapPin },
  team: { href: "/team", label: "Team", icon: UsersRound },
  settings: { href: "/settings", label: "Settings", icon: Settings },
  usage: { href: "/portfolio/usage", label: "Usage", icon: LayoutGrid },
  audit: { href: "/audit", label: "Audit log", icon: ListChecks },
};

/** Daily work first; occasional administration below a quieter "Manage" divider. */
const SECTIONS: Array<{ label: string; ids: NavKey[] }> = [
  { label: "Work", ids: ["clients", "overview", "inbox", "escalations"] },
  { label: "Understand", ids: ["analytics", "insights", "reports"] },
  { label: "Grow", ids: ["requests"] },
  { label: "Manage", ids: ["locations", "team", "settings", "audit"] },
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
  children: React.ReactNode;
}

function navActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function badgeFor(id: NavKey, summary: ShellSummary): { value: number; tone: "default" | "bad" } | null {
  if (id === "inbox" && summary.unreplied > 0) return { value: summary.unreplied, tone: "default" };
  if (id === "escalations" && summary.escalations > 0) return { value: summary.escalations, tone: "bad" };
  return null;
}

function formatBadge(value: number) {
  if (value > 9999) return `${Math.floor(value / 1000)}k`;
  return value.toLocaleString("en-US");
}

function displayName(user: User) {
  const meta = user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const raw = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
  if (raw.trim()) return raw.trim();
  return user.email ?? "You";
}

function initialsOf(text: string) {
  const parts = text.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "U") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function SidebarNav({
  role,
  summary,
  pathname,
  searchParams,
  onNavigate,
}: {
  role: string | null;
  summary: ShellSummary;
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate: () => void;
}) {
  const allowed = new Set<NavKey>(visibleNav(role));
  if (canOpenPath("/audit", role) && allowed.has("team")) allowed.add("audit");

  return (
    <>
      {SECTIONS.map((section) => {
        const items = section.ids.filter((id) => allowed.has(id));
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {items.map((id) => {
                const item = NAV[id];
                const Icon = item.icon;
                const href = scopedHref(item.href, searchParams, pathname);
                const active = navActive(pathname, item.href);
                const badge = badgeFor(id, summary);
                return (
                  <Link
                    key={id}
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                      active ? "bg-brand-tint text-brand" : "text-ink-2 hover:bg-paper hover:text-ink"
                    )}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badge ? (
                      <span
                        className={cn(
                          "ml-auto rounded-full px-1.5 py-px text-[11px] tabular-nums",
                          badge.tone === "bad"
                            ? "bg-bad-tint text-bad"
                            : active
                              ? "bg-white text-ink-2"
                              : "bg-paper text-ink-2"
                        )}
                        aria-label={`${badge.value.toLocaleString("en-US")} ${id === "inbox" ? "reviews without a reply" : "open escalations"}`}
                      >
                        {formatBadge(badge.value)}
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

function SidebarNavLive(props: Omit<Parameters<typeof SidebarNav>[0], "searchParams">) {
  const searchParams = useSearchParams();
  return <SidebarNav {...props} searchParams={searchParams} />;
}

function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  workspaceName,
  productTitle,
  logoUrl,
  clientCount,
  home,
}: {
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  workspaceName: string;
  productTitle: string;
  logoUrl?: string | null;
  clientCount: number;
  home: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const switching = saving || refreshing;
  const subtitle =
    clientCount > 1 ? `${clientCount.toLocaleString("en-US")} businesses` : productTitle !== workspaceName ? productTitle : "Workspace";

  const mark = logoUrl ? (
    // The agency supplied this URL. It is shown only after they save it.
    <img src={logoUrl} alt="" className="size-7 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">
      {workspaceName.trim().charAt(0).toUpperCase() || "R"}
    </span>
  );

  const body = (
    <>
      {mark}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{workspaceName}</span>
        <span className="block truncate text-[11px] text-ink-3">{subtitle}</span>
      </span>
    </>
  );

  if (workspaces.length <= 1) {
    return (
      <Link href={home} className="flex w-full items-center gap-2.5 rounded-md border border-line bg-white px-2 py-1.5 hover:bg-paper">
        {body}
      </Link>
    );
  }

  async function choose(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) return;
    setSaving(true);
    try {
      await fetch("/api/workspace/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      startRefresh(() => {
        router.push("/");
        router.refresh();
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex w-full items-center gap-2.5 rounded-md border border-line bg-white px-2 py-1.5 outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line"
          aria-label={`Workspace: ${workspaceName}. Switch workspace`}
          disabled={switching}
        >
          {body}
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Switch workspace</p>
          {workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} className="cursor-pointer text-[13px]" onClick={() => void choose(workspace.id)}>
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {workspace.id === activeWorkspaceId ? <Check className="size-3.5 text-brand" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
          <p className="border-t border-line px-2 pb-1 pt-2 text-[11px] leading-snug text-ink-3">
            Switching changes your team, permissions and settings. To narrow what you see, use the scope bar instead.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {switching ? (
        <ActivityStatus title="Opening that workspace" detail="Loading its businesses, reviews and Google connections." />
      ) : null}
    </div>
  );
}

function AccountFooter({ user, role }: { user: User; role: string | null }) {
  const [signingOut, setSigningOut] = useState(false);
  const name = displayName(user);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line"
        aria-label="Account menu"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dde3ee] text-[11px] font-semibold text-ink-2">
          {initialsOf(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">{name}</span>
          <span className="block truncate text-[11px] text-ink-3">{roleName(role)}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <p className="truncate px-2 py-1.5 text-xs text-ink-3">{user.email}</p>
        <DropdownMenuItem className="cursor-pointer text-[13px]" render={<a href="/privacy" />}>
          Privacy
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer text-[13px]" render={<a href="/terms" />}>
          Terms
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer text-[13px]"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut({ redirectTo: "/login" });
          }}
        >
          <LogOut className="mr-1.5 size-3.5" aria-hidden />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return (
      <FilterNavigation>
        <div className="flex h-dvh flex-col overflow-hidden bg-paper text-[15px]">
          <header className="shrink-0 border-b border-line bg-white px-4 pb-2.5 pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-ink">{workspaceName}</p>
              <Link
                href={scopedHref(home, searchParams, pathname)}
                className="inline-flex h-9 shrink-0 items-center rounded-md px-2 text-[13px] font-medium text-brand hover:bg-brand-tint"
              >
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
            <div className="mx-auto w-full max-w-lg px-4 py-3 pb-28">
              <FilterApplyFrame>{children}</FilterApplyFrame>
            </div>
          </main>
          <Suspense fallback={null}>
            <MobileNav summary={summary} />
          </Suspense>
        </div>
      </FilterNavigation>
    );
  }

  return (
    <FilterNavigation>
      <div className="flex h-dvh overflow-hidden bg-paper">
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={closeSidebar} role="presentation" />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[min(100%,16rem)] flex-col gap-1 border-r border-line bg-white p-3 transition-transform duration-150 ease-out lg:static lg:w-[232px] lg:shrink-0",
            sidebarOpen ? "translate-x-0" : "max-lg:-translate-x-full"
          )}
          aria-label="Main navigation"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <WorkspaceSwitcher
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                workspaceName={workspaceName}
                productTitle={productTitle}
                logoUrl={logoUrl}
                clientCount={clients.length}
                home={scopedHref(home, searchParams, pathname)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={closeSidebar}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </Button>
          </div>

          <nav className="-mx-1 flex-1 overflow-y-auto px-1 pb-2">
            <Suspense fallback={null}>
              <SidebarNavLive role={role} summary={summary} pathname={pathname} onNavigate={closeSidebar} />
            </Suspense>
          </nav>

          <div className="border-t border-line pt-2">
            <AccountFooter user={user} role={role} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<div className="h-[52px] shrink-0 border-b border-line bg-white" />}>
            <ShellHeader role={role} catalog={catalog} summary={summary} onOpenMenu={() => setSidebarOpen(true)} />
          </Suspense>
          <main className="flex-1 overflow-y-auto" id="main-content">
            <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 pb-8 pt-5 sm:px-6">
              <FilterApplyFrame>{children}</FilterApplyFrame>
            </div>
          </main>
        </div>
      </div>
    </FilterNavigation>
  );
}
