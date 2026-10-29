"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { isSupportBlockedMutation, SUPPORT_READ_ONLY_MESSAGE } from "@/lib/support-view";

const SupportViewContext = createContext(false);

export function useSupportReadOnly(): boolean {
  return useContext(SupportViewContext);
}

/**
 * When a super admin is viewing a tenant, block mutating /api fetches in the
 * browser before they hit the network. The proxy still enforces the same rule.
 */
export function SupportViewGuard({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!active) return;

    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method =
        init?.method ??
        (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (isSupportBlockedMutation(method, url)) {
        toast.error(SUPPORT_READ_ONLY_MESSAGE);
        return new Response(JSON.stringify({ error: SUPPORT_READ_ONLY_MESSAGE }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return original(input, init);
    };

    document.documentElement.dataset.supportReadonly = "1";
    return () => {
      window.fetch = original;
      delete document.documentElement.dataset.supportReadonly;
    };
  }, [active]);

  return <SupportViewContext.Provider value={active}>{children}</SupportViewContext.Provider>;
}
