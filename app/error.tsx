"use client";

import { ErrorState } from "@/components/error-state";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      layout="screen"
      title="Unable to load the application"
      message={error.message || "An unexpected error occurred. Please try again."}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
