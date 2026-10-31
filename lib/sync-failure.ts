// Maps a review-sync error class to what a person should see and do about it.
// Messages are safe to show in the browser; no provider detail leaks through.

import { isRetryableReviewError } from "@/lib/services/google-reviews";

export interface SyncFailureInfo {
  status: number;
  message: string;
  /** Trying again later can work without anyone changing anything. */
  retryable: boolean;
  /** Seconds to wait before retrying, when retryable. */
  retryAfterSeconds?: number;
  /** A step the user must take first. */
  action?: "reconnect" | "check_access";
}

export function describeSyncFailure(errorClass: string | null | undefined): SyncFailureInfo {
  switch (errorClass) {
    case "quota":
    case "rate_limit":
      return {
        status: 429,
        message:
          "Google is limiting requests right now. Your existing reviews are safe — try again in a few minutes.",
        retryable: true,
        retryAfterSeconds: 120,
      };
    case "server":
    case "network":
      return {
        status: 503,
        message: "Google isn't responding right now. Your existing reviews are safe — try again shortly.",
        retryable: true,
        retryAfterSeconds: 30,
      };
    case "authentication":
      return {
        status: 401,
        message: "Google sign-in has expired or was revoked. Reconnect your Google account to keep syncing.",
        retryable: false,
        action: "reconnect",
      };
    case "authorization":
      return {
        status: 403,
        message: "This Google account no longer has permission to read reviews for this location.",
        retryable: false,
        action: "check_access",
      };
    case "not_found":
      return {
        status: 404,
        message: "Google can't find this location. It may have been removed or transferred.",
        retryable: false,
        action: "check_access",
      };
    default:
      return {
        status: 500,
        message: "Sync failed unexpectedly. Please try again; if it keeps failing, contact support.",
        retryable: true,
        retryAfterSeconds: 60,
      };
  }
}

export { isRetryableReviewError };
