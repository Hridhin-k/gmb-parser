import { GoogleApiError, AppError } from "@/lib/errors";
import type { GoogleReview, GoogleReviewsResponse, GoogleApiErrorBody } from "@/lib/types/google";
import { googleFetch, parseRetryAfter, withGooglePriority } from "@/lib/google-api-gate";
import { comparePublishedReply } from "@/lib/reply-adjustments";

// Google My Business API v4 — the only official review API endpoint.
// https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews
const MY_BUSINESS_API = "https://mybusiness.googleapis.com/v4";

// Maximum page size allowed by the API
const PAGE_SIZE = 50;

function verificationFailure(error?: unknown): AppError {
  const status = error instanceof GoogleApiError ? error.googleErrorCode : undefined;
  if (status === 401 || status === 403) {
    return new AppError(
      "Google could not verify this review with the connected account. Check the location's access in Settings.",
      status === 401 ? "GOOGLE_AUTH" : "GOOGLE_FORBIDDEN",
      403
    );
  }
  return new AppError(
    "Google could not verify whether this review is available. Nothing was removed. Please try again.",
    "GOOGLE_REVIEW_CHECK_FAILED",
    503
  );
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------
export type ReviewApiErrorClass =
  | "authentication"   // 401 — token invalid or expired
  | "authorization"    // 403 — insufficient permission
  | "quota"            // 429 with quotaExceeded reason
  | "rate_limit"       // 429 with rateLimitExceeded reason
  | "not_found"        // 404 — location deleted or not accessible
  | "invalid_request"  // 400 — bad parameters
  | "server"           // 5xx — Google-side failure
  | "network"          // fetch threw (no response)
  | "unknown";         // anything else

export function classifyReviewError(error: unknown): ReviewApiErrorClass {
  if (!(error instanceof GoogleApiError)) return "unknown";
  switch (error.googleErrorCode) {
    case 401: return "authentication";
    case 403: return "authorization";
    case 404: return "not_found";
    case 400: return "invalid_request";
    case 429: {
      const reason = (error.metadata?.body as string | undefined) ?? "";
      return reason.includes("quotaExceeded") ? "quota" : "rate_limit";
    }
    default:
      return typeof error.googleErrorCode === "number" && error.googleErrorCode >= 500
        ? "server"
        : error.googleErrorCode === undefined
        ? "network"
        : "unknown";
  }
}

/** Failures worth trying again later: Google throttled us or was briefly down. */
export function isRetryableReviewError(errorClass: string | null | undefined): boolean {
  return (
    errorClass === "quota" ||
    errorClass === "rate_limit" ||
    errorClass === "server" ||
    errorClass === "network"
  );
}

// ---------------------------------------------------------------------------
// Internal fetch with structured error parsing
// ---------------------------------------------------------------------------
async function reviewApiFetch<T>(url: string, accessToken: string): Promise<T> {
  let response: Response;

  try {
    // Paced, and 429/5xx are retried with backoff inside the gate.
    response = await googleFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (cause) {
    // Network-level failure — no HTTP response
    throw new GoogleApiError(
      "Network error contacting Google Reviews API",
      undefined,
      { url, cause: cause instanceof Error ? cause.message : String(cause) }
    );
  }

  if (!response.ok) {
    let body = "";
    let errorBody: GoogleApiErrorBody = {};
    try {
      body = await response.text();
      errorBody = JSON.parse(body) as GoogleApiErrorBody;
    } catch {
      // body parse failed — use raw text
    }

    const msg = errorBody.error?.message ?? `HTTP ${response.status}`;
    throw new GoogleApiError(msg, response.status, {
      url,
      body,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// GoogleReviewService
// ---------------------------------------------------------------------------
export class GoogleReviewService {
  /**
   * Fetches one page of reviews for a location.
   * `locationName` is the Google resource name, e.g. "accounts/X/locations/Y".
   */
  static async listReviews(
    accessToken: string,
    locationName: string,
    pageToken?: string
  ): Promise<GoogleReviewsResponse> {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      orderBy: "updateTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    return reviewApiFetch<GoogleReviewsResponse>(
      `${MY_BUSINESS_API}/${locationName}/reviews?${params}`,
      accessToken
    );
  }

  /**
   * Reads one review, including any reply Google already stored.
   * `reviewName` is the full resource name, e.g. "accounts/X/locations/Y/reviews/Z".
   */
  static async getReview(accessToken: string, reviewName: string): Promise<GoogleReview> {
    return reviewApiFetch<GoogleReview>(`${MY_BUSINESS_API}/${reviewName}`, accessToken);
  }

  /**
   * Publishes a reply to a review. Returns the reply object Google sent back.
   * An empty body is not treated as success.
   */
  static async replyToReview(
    accessToken: string,
    reviewName: string,
    comment: string
  ): Promise<{ comment: string; updateTime: string | null }> {
    try {
      return await this.writeReply(accessToken, reviewName, comment);
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.googleErrorCode !== 404) throw error;
    }

    // A 404 from the write endpoint alone does not prove that a review was deleted.
    let review: GoogleReview;
    try {
      review = await withGooglePriority("interactive", () => this.getReview(accessToken, reviewName));
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.googleErrorCode !== 404) {
        throw verificationFailure(error);
      }
      const match = /^(accounts\/[^/]+\/locations\/[^/]+)\/reviews\/([^/]+)$/.exec(reviewName);
      if (!match) throw verificationFailure();
      let page: GoogleReviewsResponse;
      try {
        // Check the same parent with the same credentials before hiding a review.
        page = await withGooglePriority("interactive", () => this.listReviews(accessToken, match[1]));
      } catch (parentError) {
        throw verificationFailure(parentError);
      }
      if ((!Array.isArray(page.reviews) && page.totalReviewCount !== 0)
        || page.reviews?.some((item) => item.name === reviewName || item.reviewId === match[2])) {
        throw verificationFailure();
      }
      throw new AppError(
        "Google no longer returns this review. It has been removed from the reply queue; its history is kept.",
        "GOOGLE_REVIEW_MISSING",
        410
      );
    }
    if (review.name !== reviewName) throw verificationFailure();
    if (comparePublishedReply(comment, review.reviewReply?.comment) === "matched") {
      return { comment: review.reviewReply!.comment, updateTime: review.reviewReply!.updateTime ?? null };
    }

    // Google can still read this review: retry this approved write once, never loop.
    try {
      return await this.writeReply(accessToken, reviewName, comment);
    } catch (error) {
      if (error instanceof GoogleApiError && error.googleErrorCode === 404) {
        throw new AppError(
          "The review still exists on Google, but Google could not accept the reply. Please try again later or reply in Google Business Profile.",
          "GOOGLE_REPLY_UNAVAILABLE",
          503
        );
      }
      throw error;
    }
  }

  private static async writeReply(
    accessToken: string,
    reviewName: string,
    comment: string
  ): Promise<{ comment: string; updateTime: string | null }> {
    let response: Response;
    try {
      // A person is waiting on this: jump the queue, retry briefly.
      response = await googleFetch(
        `${MY_BUSINESS_API}/${reviewName}/reply`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment }),
          cache: "no-store",
        },
        { priority: "interactive", maxAttempts: 3 }
      );
    } catch (cause) {
      throw new GoogleApiError(
        "Network error publishing reply",
        undefined,
        { cause: cause instanceof Error ? cause.message : String(cause) }
      );
    }

    const body = await response.text().catch(() => "");
    if (!response.ok) {
      throw new GoogleApiError(
        `Failed to publish reply: ${response.status}`,
        response.status,
        { reviewName, body, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) }
      );
    }

    let parsed: { comment?: string; updateTime?: string } = {};
    try {
      parsed = body ? (JSON.parse(body) as { comment?: string; updateTime?: string }) : {};
    } catch {
      parsed = {};
    }
    if (!parsed.comment?.trim()) {
      throw new GoogleApiError(
        "Google did not return the reply it stored.",
        undefined,
        { reviewName, body }
      );
    }
    return { comment: parsed.comment, updateTime: parsed.updateTime ?? null };
  }

  /**
   * Deletes a reply from a review.
   */
  static async deleteReply(
    accessToken: string,
    reviewName: string
  ): Promise<void> {
    let response: Response;
    try {
      response = await googleFetch(
        `${MY_BUSINESS_API}/${reviewName}/reply`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
        { priority: "interactive", maxAttempts: 3 }
      );
    } catch (cause) {
      throw new GoogleApiError(
        "Network error deleting reply",
        undefined,
        { cause: cause instanceof Error ? cause.message : String(cause) }
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleApiError(
        `Failed to delete reply: ${response.status}`,
        response.status,
        { reviewName, body }
      );
    }
  }
}

// Re-export so callers can type check against
export type { GoogleReview, GoogleReviewsResponse };
export { AppError };
