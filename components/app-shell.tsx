"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import type { User } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import {
  ChartColumn,
  ChevronsUpDown,
  Inbox,
  LogOut,
  MapPin,
  Home,
  Send,
  SlidersHorizontal,
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
import { GlobalFilters } from "@/components/global-filters";
import { PlacePicker } from "@/components/place-picker";
import { SidebarSearch } from "@/components/sidebar-search";
import type { ScopeCatalog } from "@/lib/scope";
import type { ShellSummary } from "@/lib/services/shell-summary";
import { homePath, scopedHref, visibleNav, type ShellNavId } from "@/lib/shell";
import { roleName } from "@/lib/ui/vocabulary";

const NAV: Record<ShellNavId, { href: string; label: string; icon: LucideIcon }> = {
  overview: { href: "/overview", label: "Today", icon: Home },
  inbox: { href: "/reviews", label: "Reviews", icon: Inbox },
  insights: { href: "/insights", label: "Insights", icon: ChartColumn },
  requests: { href: "/requests", label: "Get reviews", icon: Send },
  locations: { href: "/locations", label: "Locations", icon: MapPin },
  settings: { href: "/settings", label: "Settings", icon: SlidersHorizontal },
};

/** Pages folded into a nav item still light that item up. */
const ALSO_UNDER: Partial<Record<ShellNavId, string[]>> = {
  overview: ["/portfolio"],
  inbox: ["/escalations"],
  insights: ["/analytics", "/reports"],
  locations: ["/businesses"],
  settings: ["/team", "/audit", "/portfolio/usage"],
};

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

function under(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navActive(pathname: string, id: ShellNavId) {
  // /portfolio/usage belongs to Settings, not to Today's /portfolio.
  if (id === "overview" && under(pathname, "/portfolio/usage")) return false;
  return [NAV[id].href, ...(ALSO_UNDER[id] ?? [])].some((href) => under(pathname, href));
}

/** Today counts what is urgent; Reviews counts what has no reply. */
function badgeFor(id: ShellNavId, summary: ShellSummary): { value: number; tone: "default" | "bad"; label: string } | null {
  if (id === "overview") {
    const urgent = summary.escalations + summary.failed;
    return urgent > 0 ? { value: urgent, tone: "bad", label: "need you now" } : null;
  }
  if (id === "inbox" && summary.unreplied > 0) return { value: summary.unreplied, tone: "default", label: "reviews without a reply" };
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

function NavItem({
  id,
  summary,
  pathname,
  searchParams,
  onNavigate,
}: {
  id: ShellNavId;
  summary: ShellSummary;
  pathname: string;
  searchParams: URLSearchParams;
  onNavigate: () => void;
}) {
  const item = NAV[id];
  const Icon = item.icon;
  const active = navActive(pathname, id);
  const badge = badgeFor(id, summary);
  return (
    <Link
      href={scopedHref(item.href, searchParams, pathname)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        active ? "bg-brand-tint font-semibold text-brand" : "text-ink-2 hover:bg-paper hover:text-ink"
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge ? (
        <span
          className={cn(
            "ml-auto min-w-[22px] rounded-full px-1.5 py-px text-center text-xs font-semibold tabular-nums",
            badge.tone === "bad" ? "bg-bad-tint text-bad" : active ? "bg-white text-ink-2" : "bg-paper text-ink-2"
          )}
          aria-label={`${badge.value.toLocaleString("en-US")} ${badge.label}`}
        >
          {formatBadge(badge.value)}
        </span>
      ) : null}
    </Link>
  );
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
  const items = visibleNav(role).filter((id) => id !== "settings");
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((id) => (
        <NavItem key={id} id={id} summary={summary} pathname={pathname} searchParams={searchParams} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function SettingsLink(props: Omit<Parameters<typeof NavItem>[0], "id" | "searchParams">) {
  const searchParams = useSearchParams();
  return <NavItem {...props} id="settings" searchParams={searchParams} />;
}

function SidebarNavLive(props: Omit<Parameters<typeof SidebarNav>[0], "searchParams">) {
  const searchParams = useSearchParams();
  return <SidebarNav {...props} searchParams={searchParams} />;
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
  catalog,
  summary,
  logoUrl,
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
              <Suspense fallback={<div className="h-[52px] rounded-[10px] border border-line" />}>
                <PlacePicker
                  catalog={catalog}
                  workspaceName={workspaceName}
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  logoUrl={logoUrl}
                  profiles={summary.profiles}
                  home={home}
                  canManageLocations={visibleNav(role).includes("locations")}
                  onNavigate={closeSidebar}
                />
              </Suspense>
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

          <div className="pt-2">
            <Suspense fallback={<div className="h-9 rounded-md bg-paper" />}>
              <SidebarSearch onNavigate={closeSidebar} />
            </Suspense>
          </div>

          <nav className="-mx-1 flex-1 overflow-y-auto px-1 pb-2 pt-2">
            <Suspense fallback={null}>
              <SidebarNavLive role={role} summary={summary} pathname={pathname} onNavigate={closeSidebar} />
            </Suspense>
          </nav>

          <div className="flex flex-col gap-0.5 border-t border-line pt-2">
            {visibleNav(role).includes("settings") ? (
              <Suspense fallback={null}>
                <SettingsLink summary={summary} pathname={pathname} onNavigate={closeSidebar} />
              </Suspense>
            ) : null}
            <AccountFooter user={user} role={role} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<div className="h-[52px] shrink-0 border-b border-line bg-white lg:hidden" />}>
            <ShellHeader workspaceName={workspaceName} catalog={catalog} onOpenMenu={() => setSidebarOpen(true)} />
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
