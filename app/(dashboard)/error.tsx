"use client";

import { ErrorState } from "@/components/error-state";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      layout="section"
      title="Unable to load this page"
      message={
        error.message ||
        "An unexpected error occurred. Please try again or contact support if the problem persists."
      }
      digest={error.digest}
      onRetry={reset}
    />
  );
}
