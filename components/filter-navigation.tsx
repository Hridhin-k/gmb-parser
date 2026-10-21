"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ActivityStatus } from "@/components/activity-status";

export interface FilterApply {
  title: string;
  detail: string;
  href: string;
}

interface FilterNavigationValue {
  applying: FilterApply | null;
  begin: (next: FilterApply, navigate: () => void) => void;
}

const FilterNavigationContext = createContext<FilterNavigationValue | null>(null);

/**
 * Header filters call begin() before the server render arrives, so the page
 * can say which filter is loading instead of sitting on the previous numbers.
 */
export function FilterNavigation({ children }: { children: ReactNode }) {
  const [applying, setApplying] = useState<FilterApply | null>(null);
  const [pending, start] = useTransition();
  const sawPending = useRef(false);

  useEffect(() => {
    if (!applying) {
      sawPending.current = false;
      return;
    }
    if (pending) {
      sawPending.current = true;
      return;
    }
    if (sawPending.current) {
      sawPending.current = false;
      setApplying(null);
    }
  }, [applying, pending]);

  const begin = (next: FilterApply, navigate: () => void) => {
    setApplying(next);
    start(navigate);
  };

  return <FilterNavigationContext.Provider value={{ applying, begin }}>{children}</FilterNavigationContext.Provider>;
}

export function useFilterNavigation(): FilterNavigationValue {
  const value = useContext(FilterNavigationContext);
  if (value) return value;
  return {
    applying: null,
    begin: (_next, navigate) => navigate(),
  };
}

/** Names the filter in flight and dims the previous numbers underneath. */
export function FilterApplyFrame({ children }: { children: ReactNode }) {
  const { applying } = useFilterNavigation();
  return (
    <>
      {applying ? (
        <div className="sticky top-0 z-20 mb-4">
          <ActivityStatus title={applying.title} detail={applying.detail} />
        </div>
      ) : null}
      <div
        className={applying ? "pointer-events-none opacity-50 motion-safe:transition-opacity" : undefined}
        aria-busy={applying ? true : undefined}
      >
        {children}
      </div>
    </>
  );
}
