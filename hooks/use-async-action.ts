"use client";

import { useCallback, useRef, useState } from "react";
import { explainFailure, failureKindFromStatus, type StatusCopy } from "@/lib/ui-status";

export interface AsyncActionState {
  pending: boolean;
  error: { title: string; detail: string; canRetry: boolean } | null;
}

/**
 * Shared pending/error handling for button-triggered async work.
 * Prevents duplicate submissions and clears errors on a new attempt.
 */
export function useAsyncAction(failureKind: Parameters<typeof explainFailure>[0] = "generic") {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AsyncActionState["error"]>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : null;
        setError(explainFailure(failureKind, message));
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [failureKind]
  );

  const failFromResponse = useCallback(
    (status: number, serverMessage?: string | null) => {
      const kind =
        failureKind === "generic" ? failureKindFromStatus(status) : failureKind;
      setError(explainFailure(kind, serverMessage));
    },
    [failureKind]
  );

  const clearError = useCallback(() => setError(null), []);

  return { pending, error, run, failFromResponse, clearError, setError };
}

export function buttonLabel(pending: boolean, idle: string, busy: StatusCopy): string {
  return pending ? busy.short : idle;
}
