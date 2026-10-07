"use client";

import { useLinkStatus } from "next/link";
import type { ComponentType } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Must render inside a `<Link>`; swaps the icon for a spinner while that link's navigation is pending. */
export function NavLinkIcon({
  icon: Icon,
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <span className={cn("flex size-4 shrink-0 items-center justify-center", className)} aria-hidden>
      {pending ? <Spinner size="sm" /> : <Icon className="size-4" aria-hidden />}
    </span>
  );
}
