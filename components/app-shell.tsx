"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Building2,
  MessageSquareText,
  Settings,
  Menu,
  X,
  LogOut,
  ClipboardList,
  BarChart3,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients",   label: "Clients",   icon: Building2 },
  { href: "/reviews",   label: "Reviews",   icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audit",     label: "Audit Log", icon: ClipboardList },
  { href: "/settings",  label: "Settings",  icon: Settings },
] as const;

interface AppShellProps {
  user: User;
  workspaceName: string;
  workspaces: Array<{ id: string; name: string }>;
  activeWorkspaceId: string;
  children: React.ReactNode;
}

export function AppShell({
  user,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // A full reload drops the cached RSC payload of the signed-in session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  const initials = (user.email ?? "U").slice(0, 2).toUpperCase();

  // Close sidebar on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setSidebarOpen(false);
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

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          role="presentation"
        />
      )}

      {/* Sidebar */}
        <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(100%,18rem)] flex-col border-r border-[#ede9ff] bg-white transition-transform duration-150 ease-out lg:static lg:w-60 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-lg tracking-[-0.03em] text-[#18161a]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4823ff] text-[11px] font-bold text-white">
              G
            </span>
            GRM
          </Link>
          <button
            className="rounded p-1 text-[#898b91] hover:text-[#5f6168] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-sidebar-border px-3 py-2">
          {workspaces.length > 1 ? (
            <label className="block">
              <span className="sr-only">Workspace</span>
              <select
                aria-label="Workspace"
                value={activeWorkspaceId}
                disabled={switching}
                onChange={async (event) => {
                  const workspaceId = event.target.value;
                  setSwitching(true);
                  try {
                    await fetch("/api/workspace/active", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ workspaceId }),
                    });
                    router.refresh();
                  } finally {
                    setSwitching(false);
                  }
                }}
                className="w-full truncate rounded-full border border-[#d9d2ff] bg-white px-3 py-2 text-sm text-[#18161a]"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="truncate text-sm font-medium text-[#18161a]">{workspaceName}</p>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-2 py-2" role="navigation">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-3 text-[15px] font-medium transition-colors lg:py-2 lg:text-[14px]",
                  active
                    ? "bg-[#ede9ff] text-[#4823ff]"
                    : "text-[#18161a] hover:bg-[#ede9ff]/60"
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="h-[15px] w-[15px] shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border p-2">
          <div className="mb-1 flex gap-3 px-2.5 text-xs text-[#898b91]">
            <a href="/privacy" className="hover:text-[#4823ff]">
              Privacy
            </a>
            <a href="/terms" className="hover:text-[#4823ff]">
              Terms
            </a>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-full px-2.5 py-2 text-left text-sm text-[#18161a] hover:bg-[#ede9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="bg-primary text-[8px] font-medium text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{user.email}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-44">
              <DropdownMenuItem
                className="cursor-pointer text-[13px]"
                disabled={signingOut}
                onClick={() => {
                  void signOut();
                }}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex h-14 shrink-0 items-center border-b border-[#ede9ff] bg-[#fafaf8] px-3 lg:hidden">
          <button
            className="mr-2 rounded-full p-2 text-[#18161a] hover:bg-[#ede9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-medium text-[#18161a]">
            {NAV_ITEMS.find(
              (item) => pathname === item.href || pathname.startsWith(item.href + "/")
            )?.label ?? "GRM"}
          </p>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#fafaf8]" id="main-content">
          <div className="mx-auto max-w-[1200px] px-4 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
