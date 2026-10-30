"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/sync-button";
import { cn } from "@/lib/utils";

interface SetupChecklistProps {
  workspaceId: string;
  canSync: boolean;
  hasConnection: boolean;
  hasLocations: boolean;
  hasReviews: boolean;
  hasPublished: boolean;
}

const DISMISS_EVENT = "grm-setup-dismissed";

function storageKey(workspaceId: string) {
  return `grm:setup-dismissed:${workspaceId}`;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DISMISS_EVENT, callback);
  };
}

export function SetupChecklist({
  workspaceId,
  canSync,
  hasConnection,
  hasLocations,
  hasReviews,
  hasPublished,
}: SetupChecklistProps) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(storageKey(workspaceId)) === "1",
    () => false
  );

  const steps = [
    {
      done: hasConnection,
      title: "Connect Google",
      body: "Sign in with the Google account that manages your Business Profiles.",
      action: (
        <Link href="/settings" className="font-medium text-brand underline decoration-brand-line underline-offset-4 hover:decoration-ink">
          Open settings
        </Link>
      ),
    },
    {
      done: hasLocations,
      title: "Sync profiles",
      body: canSync
        ? "Click Sync profiles at the top of this page. Every brand on your Google account becomes a client, with its shops as locations."
        : "The workspace owner syncs profiles. Each brand becomes a client, with its shops as locations.",
      action: null,
    },
    {
      done: hasReviews,
      title: "Sync reviews",
      body: canSync
        ? "Pull every review for your assigned locations into one inbox."
        : "The workspace owner pulls reviews into the inbox.",
      action:
        canSync && hasConnection && hasLocations ? (
          <SyncButton syncAll size="xs" label="Sync now" />
        ) : null,
    },
    {
      done: hasPublished,
      title: "Publish your first reply",
      body: "Open a review, generate a draft, edit it, approve, and publish to Google.",
      action: hasReviews ? (
        <Link
          href="/reviews?filter=unanswered"
          className="font-medium text-brand underline decoration-brand-line underline-offset-4 hover:decoration-ink"
        >
          Show reviews that need a reply
        </Link>
      ) : null,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  if (dismissed || completed === steps.length) return null;

  function dismiss() {
    window.localStorage.setItem(storageKey(workspaceId), "1");
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  return (
    <section
      aria-labelledby="setup-heading"
      className="rounded-lg border border-line bg-white p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="setup-heading"
            className="text-[15px] font-semibold text-ink"
            style={{ fontFamily: "var(--font-heading), sans-serif" }}
          >
            Get set up
          </h2>
          <p className="mt-1 text-[13px] text-ink-3">
            {completed} of {steps.length} done
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={dismiss}
          className="text-ink-3"
          aria-label="Hide setup checklist"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={completed}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3.5",
              step.done ? "border-line bg-paper" : "border-line bg-white"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  step.done ? "bg-ok text-white" : "border border-line bg-white text-ink"
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <p
                className={cn(
                  "text-sm font-semibold",
                  step.done ? "text-ink-3 line-through" : "text-ink"
                )}
              >
                {step.title}
              </p>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">{step.body}</p>
            {!step.done && step.action ? <div className="mt-auto text-sm">{step.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
