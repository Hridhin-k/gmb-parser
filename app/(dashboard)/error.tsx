"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden />
      </div>
      <h2 className="mt-3 text-[13px] font-medium text-[#18161a]">
        Unable to load this page
      </h2>
      <p className="mt-1 max-w-sm text-[13px] text-[#898b91]">
        {error.message || "An unexpected error occurred. Please try again or contact support if the problem persists."}
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-[#898b91]">Reference: {error.digest}</p>
      )}
      <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
