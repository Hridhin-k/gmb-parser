"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  MessageSquareText,
  Settings,
  Menu,
  X,
  LogOut,
  ClipboardList,
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
  { href: "/audit",     label: "Audit Log", icon: ClipboardList },
  { href: "/settings",  label: "Settings",  icon: Settings },
] as const;

interface AppShellProps {
  user: User;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const initials = (user.email ?? "U").slice(0, 2).toUpperCase();

  // Close sidebar on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [sidebarOpen, handleKeyDown]);

  return (
    <div className="flex h-screen overflow-hidden">
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
          "fixed inset-y-0 left-0 z-50 flex w-52 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-150 ease-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-gray-900"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
              G
            </span>
            GRM
          </Link>
          <button
            className="rounded p-1 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
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
                  "flex items-center gap-2 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-[7px] text-left text-[13px] text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                onSelect={() => {
                  router.push("/api/auth/signout");
                }}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex h-11 shrink-0 items-center border-b border-border bg-white px-4 lg:px-6">
          <button
            className="mr-3 rounded p-1 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Breadcrumb-style page title from current route */}
          <nav className="flex items-center gap-1 text-[13px] text-gray-500" aria-label="Breadcrumb">
            {NAV_ITEMS.filter(
              (item) => pathname === item.href || pathname.startsWith(item.href + "/")
            ).map((item) => (
              <span key={item.href} className="font-medium text-gray-700">
                {item.label}
              </span>
            ))}
          </nav>
          <div className="flex-1" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto" id="main-content">
          <div className="mx-auto max-w-6xl px-4 py-5 lg:px-8 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
