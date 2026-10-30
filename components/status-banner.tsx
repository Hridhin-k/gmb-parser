"use client";

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
        "rounded-lg border border-bad-line bg-bad-tint px-3 py-2.5 text-[13px] text-[#9b1c1c]",
        className
      )}
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-[13px] font-normal text-[#9b1c1c]">{detail}</p>
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
      <p className="rounded-lg border border-line bg-white px-4 py-6 text-[13px] text-ink-3" role="status">
        Previous figures for another scope stay hidden so they are not mistaken for this selection.
      </p>
    </div>
  );
}
