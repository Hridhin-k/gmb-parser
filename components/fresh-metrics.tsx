"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ScopeUpdating } from "@/components/status-banner";
import { overviewQueryKey } from "@/lib/overview-board";
import { SCOPE_REFRESH, type StatusCopy } from "@/lib/ui-status";

export type FreshMetricsSurface = keyof typeof SCOPE_REFRESH;

/**
 * Hides the previous scope's numbers as soon as the URL changes, until the
 * server render matches — so figures from another org/group/outlet never linger.
 *
 * Search-param reads stay in a tiny Suspense probe so the metrics themselves
 * never get replaced by a page-level loading banner.
 */
export function FreshMetrics({
  rendered,
  children,
  surface = "generic",
  copy,
}: {
  rendered: string;
  children: ReactNode;
  /** Which page-level refresh copy to show while the URL and server diverge. */
  surface?: FreshMetricsSurface;
  copy?: StatusCopy;
}) {
  const [live, setLive] = useState<string | null>(null);
  const mismatched = live !== null && live !== rendered;

  return (
    <>
      <Suspense fallback={null}>
        <SearchParamsProbe onKey={setLive} />
      </Suspense>
      {mismatched ? (
        <ScopeUpdating copy={copy ?? SCOPE_REFRESH[surface] ?? SCOPE_REFRESH.generic} />
      ) : (
        children
      )}
    </>
  );
}

function SearchParamsProbe({ onKey }: { onKey: (key: string) => void }) {
  const searchParams = useSearchParams();
  const key = overviewQueryKey((name) => searchParams.get(name));
  useEffect(() => {
    onKey(key);
  }, [key, onKey]);
  return null;
}
