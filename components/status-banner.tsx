"use client";

import type { ReactNode } from "react";
import { ActivityStatus } from "@/components/activity-status";
import { Button } from "@/components/ui/button";
import type { StatusCopy } from "@/lib/ui-status";
import { cn } from "@/lib/utils";

/** Section-level activity while an action runs (keeps surrounding content visible). */
export function OperationStatus({
  copy,
  className,
}: {
  copy: StatusCopy;
  className?: string;
}) {
  return (
    <div className={className}>
      <ActivityStatus title={copy.title} detail={copy.detail} tone={copy.tone ?? "work"} />
    </div>
  );
}

/** Plain-language failure with optional retry. Does not invent causes. */
export function FailureBanner({
  title,
  detail,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800",
        className
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-[13px] font-normal text-red-700">{detail}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Shown when the URL scope/filters changed and the server render has not caught up. */
export function ScopeUpdating({ copy }: { copy: StatusCopy }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <ActivityStatus title={copy.title} detail={copy.detail} tone={copy.tone ?? "work"} />
      <p className="rounded-xl border border-[#e6ebf2] bg-white px-4 py-6 text-sm text-slate" role="status">
        Previous figures for another scope stay hidden so they are not mistaken for this selection.
      </p>
    </div>
  );
}

/** Non-blocking note when displayed data may be stale after a failed refresh. */
export function StaleNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900",
        className
      )}
    >
      {children}
    </p>
  );
}
