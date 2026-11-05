import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleReviewService } from "@/lib/services/google-reviews";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/lib/google-api-gate", () => ({
  googleFetch: fetchMock,
  parseRetryAfter: () => null,
  withGooglePriority: (_priority: string, fn: () => unknown) => fn(),
}));

const reviewName = "accounts/account-1/locations/location-1/reviews/review-1";
const comment = "Thank you for your feedback!";
const storedReply = { comment, updateTime: "2026-11-05T16:00:00Z" };
const review = { name: reviewName, reviewId: "review-1" };

function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => fetchMock.mockReset());

describe("Google reply publishing after a 404", () => {
  it("retries the approved content once when Google can still read the review", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, review))
      .mockResolvedValueOnce(response(200, storedReply));

    await expect(GoogleReviewService.replyToReview("token", reviewName, comment)).resolves.toEqual(storedReply);
    expect(fetchMock.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["PUT", "GET", "PUT"]);
    expect(fetchMock.mock.calls[2][1].body).toBe(JSON.stringify({ comment }));
  });

  it("accepts a read-confirmed matching reply without writing again", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, { ...review, reviewReply: storedReply }));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment)).resolves.toEqual(storedReply);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a readable review when the bounded retry also returns 404", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, review))
      .mockResolvedValueOnce(response(404));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_REPLY_UNAVAILABLE", statusCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("confirms missing only after a review 404 and a successful parent list", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, { reviews: [{ name: "another-review", reviewId: "another-id" }], totalReviewCount: 1 }));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_REVIEW_MISSING", statusCode: 410 });
    expect(fetchMock.mock.calls[2][0]).toContain("accounts/account-1/locations/location-1/reviews?");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer token");
  });

  it("handles a parent with zero reviews", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, { totalReviewCount: 0 }));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_REVIEW_MISSING" });
  });

  it.each([401, 403, 404, 503])("never infers deletion when the parent returns %s", async (status) => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(status));
    const error = await GoogleReviewService.replyToReview("token", reviewName, comment).catch((e: unknown) => e);
    expect(error).not.toMatchObject({ code: "GOOGLE_REVIEW_MISSING" });
  });

  it.each([response(200, { reviews: [review], totalReviewCount: 1 }), response(200, {})])(
    "does not mark missing on a contradictory or malformed parent response",
    async (parentResponse) => {
      fetchMock.mockResolvedValueOnce(response(404))
        .mockResolvedValueOnce(response(404))
        .mockResolvedValueOnce(parentResponse);
      await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
        .rejects.toMatchObject({ code: "GOOGLE_REVIEW_CHECK_FAILED" });
    }
  );

  it("does not hide the review when verification fails on the network", async () => {
    fetchMock.mockResolvedValueOnce(response(404)).mockRejectedValueOnce(new Error("network failure"));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_REVIEW_CHECK_FAILED", statusCode: 503 });
  });

  it("keeps an uncertain retry outcome for later reconciliation", async () => {
    fetchMock.mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, review))
      .mockRejectedValueOnce(new Error("connection lost after sending"));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_API_ERROR", googleErrorCode: undefined });
  });

  it("does not infer deletion or retry a different Google error", async () => {
    fetchMock.mockResolvedValueOnce(response(403));
    await expect(GoogleReviewService.replyToReview("token", reviewName, comment))
      .rejects.toMatchObject({ code: "GOOGLE_API_ERROR", googleErrorCode: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
