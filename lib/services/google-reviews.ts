import { GoogleApiError, AppError } from "@/lib/errors";
import type { GoogleReview, GoogleReviewsResponse, GoogleApiErrorBody } from "@/lib/types/google";

// Google My Business API v4 — the only official review API endpoint.
// https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews
const MY_BUSINESS_API = "https://mybusiness.googleapis.com/v4";

// Maximum page size allowed by the API
const PAGE_SIZE = 50;

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
    default:  return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Internal fetch with structured error parsing
// ---------------------------------------------------------------------------
async function reviewApiFetch<T>(url: string, accessToken: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
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
    throw new GoogleApiError(msg, response.status, { url, body });
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
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    return reviewApiFetch<GoogleReviewsResponse>(
      `${MY_BUSINESS_API}/${locationName}/reviews?${params}`,
      accessToken
    );
  }

  /**
   * Publishes a reply to a review.
   */
  static async replyToReview(
    accessToken: string,
    reviewName: string,
    comment: string
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${MY_BUSINESS_API}/${reviewName}/reply`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment }),
        cache: "no-store",
      });
    } catch (cause) {
      throw new GoogleApiError(
        "Network error publishing reply",
        undefined,
        { cause: cause instanceof Error ? cause.message : String(cause) }
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleApiError(
        `Failed to publish reply: ${response.status}`,
        response.status,
        { reviewName, body }
      );
    }
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
      response = await fetch(`${MY_BUSINESS_API}/${reviewName}/reply`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
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
