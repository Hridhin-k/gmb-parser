"use client";

import { createContext, useContext, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface Scope {
  pending: boolean;
  start: TransitionStartFunction;
}

const ScopeContext = createContext<Scope | null>(null);

/**
 * Shares one navigation transition between filters and the results they control,
 * so the loading state shows on the results instead of the whole page.
 */
export function TransitionScope({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  return <ScopeContext.Provider value={{ pending, start }}>{children}</ScopeContext.Provider>;
}

/** The surrounding scope's transition, or a local one when rendered outside a scope. */
export function useScopedTransition(): Scope {
  const scope = useContext(ScopeContext);
  const [pending, start] = useTransition();
  return scope ?? { pending, start };
}

/** Dims its content and shows a floating status while the scope's transition is pending. */
export function PendingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const scope = useContext(ScopeContext);
  const pending = scope?.pending ?? false;

  return (
    <div className="relative" aria-busy={pending || undefined}>
      {pending ? (
        <div className="pointer-events-none sticky top-3 z-10 flex h-0 justify-center overflow-visible">
          <span
            role="status"
            aria-live="polite"
            className="mt-3 inline-flex h-fit items-center gap-2 rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white shadow-card-hover animate-in fade-in-0 slide-in-from-top-1"
          >
            <Spinner size="sm" />
            {label}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "transition-opacity duration-150",
          className,
          pending && "pointer-events-none opacity-50 [transition-delay:120ms]"
        )}
      >
        {children}
      </div>
    </div>
  );
}
