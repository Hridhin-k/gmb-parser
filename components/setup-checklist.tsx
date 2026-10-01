"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Check, X } from "lucide-react";
import { SyncButton } from "@/components/sync-button";
import { cn } from "@/lib/utils";

interface SetupChecklistProps {
  workspaceId: string;
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
        <Link href="/settings" className="font-medium text-[#4823ff] hover:text-[#7e78ff]">
          Open settings
        </Link>
      ),
    },
    {
      done: hasLocations,
      title: "Assign locations to clients",
      body: "Import your profiles, then put each location under the business it belongs to.",
      action: (
        <Link href="/clients" className="font-medium text-[#4823ff] hover:text-[#7e78ff]">
          Go to clients
        </Link>
      ),
    },
    {
      done: hasReviews,
      title: "Sync reviews",
      body: "Pull every review for your assigned locations into one inbox.",
      action: hasConnection && hasLocations ? <SyncButton syncAll size="xs" label="Sync now" /> : null,
    },
    {
      done: hasPublished,
      title: "Publish your first reply",
      body: "Open a review, generate a draft, edit it, approve, and publish to Google.",
      action: hasReviews ? (
        <Link
          href="/dashboard?filter=unanswered#inbox"
          className="font-medium text-[#4823ff] hover:text-[#7e78ff]"
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
      className="rounded-[20px] border border-[#d9d2ff] bg-white p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="setup-heading"
            className="text-[22px] leading-[1.3] tracking-[-0.02em] text-[#18161a]"
            style={{ fontFamily: "var(--font-plus-jakarta), sans-serif" }}
          >
            Get set up
          </h2>
          <p className="mt-1 text-sm font-light text-[#898b91]">
            {completed} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full p-1.5 text-[#898b91] hover:bg-[#f3f2ef] hover:text-[#18161a]"
          aria-label="Hide setup checklist"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#ede9ff]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={completed}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-[#4823ff] transition-all"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={cn(
              "flex flex-col gap-2 rounded-2xl border p-4",
              step.done ? "border-[#e6e4e1] bg-[#fafaf8]" : "border-[#d9d2ff] bg-white"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  step.done ? "bg-green-500 text-white" : "bg-[#ede9ff] text-[#4823ff]"
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <p
                className={cn(
                  "text-sm font-semibold",
                  step.done ? "text-[#898b91] line-through" : "text-[#18161a]"
                )}
              >
                {step.title}
              </p>
            </div>
            <p className="text-[13px] font-light leading-relaxed text-[#5f6168]">{step.body}</p>
            {!step.done && step.action ? <div className="mt-auto text-sm">{step.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
