"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, Menu } from "lucide-react";
import { ActivityStatus } from "@/components/activity-status";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

interface AgencyTopBarProps {
  user: User;
  onOpenMenu?: () => void;
}

export function AgencyTopBar({ user, onOpenMenu }: AgencyTopBarProps) {
  const [signingOut, setSigningOut] = useState(false);
  const initials = (user.email ?? "U").slice(0, 2).toUpperCase();

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <header className="shrink-0 border-b border-silver bg-white">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        {onOpenMenu ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onOpenMenu}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : null}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-silver focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
              aria-label="Account menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-paper text-[11px] font-medium text-ink">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-56">
              <p className="truncate px-2 py-1.5 text-xs text-slate">{user.email}</p>
              <DropdownMenuItem
                className="cursor-pointer text-sm"
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
      </div>
      {signingOut ? (
        <div className="border-t border-silver px-3 py-2 sm:px-4">
          <ActivityStatus
            title="Signing you out"
            detail="Closing this session. You will land on the sign-in page."
          />
        </div>
      ) : null}
    </header>
  );
}
