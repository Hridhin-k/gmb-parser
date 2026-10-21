"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * `router.refresh()` starts its own transition, so a caller's `useTransition`
 * goes idle before the new server render arrives. This flag stays on until
 * `settle()` — usually from `useSettleWhenUpdated` when the server props change.
 */
export function useServerRefresh() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const refresh = useCallback(() => {
    setPending(true);
    router.refresh();
  }, [router]);

  const settle = useCallback(() => setPending(false), []);

  return { pending, refresh, settle };
}

/** Turns the refresh flag off once `value` changes after the refresh started. */
export function useSettleWhenUpdated(pending: boolean, settle: () => void, value: unknown) {
  const ready = useRef(false);
  const last = useRef(value);

  useEffect(() => {
    if (!ready.current) {
      ready.current = true;
      last.current = value;
      return;
    }
    if (!pending) {
      last.current = value;
      return;
    }
    if (!Object.is(last.current, value)) {
      last.current = value;
      settle();
    }
  }, [pending, settle, value]);
}
