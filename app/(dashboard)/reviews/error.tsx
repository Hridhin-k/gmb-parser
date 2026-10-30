"use client";

import { ErrorState } from "@/components/error-state";

export default function ReviewsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorState
      layout="section"
      title="Couldn't load reviews"
      message={
        error.message ||
        "The review list didn't load. Your scope and filters are kept in the address bar, so trying again shows the same view."
      }
      digest={error.digest}
      onRetry={retry}
    />
  );
}
