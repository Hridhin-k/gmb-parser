"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden />
        </div>
        <h1 className="mt-4 text-base font-semibold text-graphite">
          Unable to load the application
        </h1>
        <p className="mt-1 max-w-sm text-[13px] text-slate">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-slate">
            Reference: {error.digest}
          </p>
        )}
        <Button variant="outline" className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
