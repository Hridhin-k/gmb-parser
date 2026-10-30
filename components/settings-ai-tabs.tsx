"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsAiTab {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/** In-page tabs. Every panel stays mounted so unsaved form edits survive a tab switch. */
export function SettingsAiTabs({ tabs }: { tabs: SettingsAiTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActive(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="AI configuration" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`ai-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`ai-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => onKey(event, index)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px]",
              active === tab.id ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink"
            )}
          >
            {tab.label}
            {tab.count != null ? (
              <span className="rounded-sm bg-paper px-1.5 text-[11px] font-medium tabular-nums text-ink-3">{tab.count}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`ai-panel-${tab.id}`}
          aria-labelledby={`ai-tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
