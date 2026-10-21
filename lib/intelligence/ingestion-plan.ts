import { canonicalInstant, canonicalReviewText, canonicalStars, contentFingerprint, responseFingerprint } from "@/lib/intelligence/fingerprint";

export interface StoredReviewVersion {
  id: string;
  comment: string | null;
  starRating: number;
  createTime: string;
  replyComment: string | null;
  contentFingerprint: string | null;
  responseFingerprint: string | null;
  missingOnGoogleAt: string | null;
}

export interface IncomingReviewVersion {
  starRating: number;
  comment: string | null;
  createTime: string;
  replyComment: string | null;
}

export interface ReviewVersionEffect {
  reviewId: string;
  contentFingerprint: string;
  responseFingerprint: string;
  /** Text, stars, or review date changed, or the review returned after a confirmed absence. */
  contentChanged: boolean;
  /** No stored row yet. A new review is processed even when it has no text. */
  created: boolean;
  /** Comment text changed. Embeddings follow the text, not the star rating. */
  textChanged: boolean;
  /** Star rating changed and the comment did not. */
  ratingChanged: boolean;
  /** Review date changed. Moves window membership. Does not by itself re-embed. */
  dateChanged: boolean;
  /** Google reply text changed. Does not by itself reclassify the review. */
  responseChanged: boolean;
}

export function planReviewVersion(
  prior: StoredReviewVersion | null,
  incoming: IncomingReviewVersion
): Omit<ReviewVersionEffect, "reviewId"> & { reviewId: string | null } {
  const nextContent = contentFingerprint({
    starRating: incoming.starRating,
    comment: incoming.comment,
    createTime: incoming.createTime,
  });
  const nextResponse = responseFingerprint(incoming.replyComment);
  const textChanged = !prior || canonicalReviewText(prior.comment) !== canonicalReviewText(incoming.comment);
  const ratingChanged = !prior || canonicalStars(prior.starRating) !== canonicalStars(incoming.starRating);
  const dateChanged = !prior || canonicalInstant(prior.createTime) !== canonicalInstant(incoming.createTime);
  if (!prior) {
    return {
      reviewId: null,
      contentFingerprint: nextContent,
      responseFingerprint: nextResponse,
      contentChanged: true,
      created: true,
      textChanged,
      ratingChanged,
      dateChanged,
      responseChanged: false,
    };
  }
  const priorContent =
    prior.contentFingerprint ??
    contentFingerprint({
      starRating: prior.starRating,
      comment: prior.comment,
      createTime: prior.createTime,
    });
  const priorResponse = prior.responseFingerprint ?? responseFingerprint(prior.replyComment);
  const returned = prior.missingOnGoogleAt !== null;
  return {
    reviewId: prior.id,
    contentFingerprint: nextContent,
    responseFingerprint: nextResponse,
    contentChanged: returned || priorContent !== nextContent,
    created: false,
    textChanged: returned || textChanged,
    ratingChanged,
    dateChanged,
    responseChanged: priorResponse !== nextResponse,
  };
}

/**
 * Google listReviews has no deletion event. A review is absent only when a full
 * sync read every page and the provider did not fail. Incremental, truncated,
 * and failed syncs prove nothing about reviews they did not return.
 */
export function absenceIsConfirmed(input: {
  mode: "incremental" | "full";
  providerFailed: boolean;
  truncated: boolean;
}): boolean {
  return input.mode === "full" && !input.providerFailed && !input.truncated;
}

export function reviewsConfirmedMissing<T extends { googleReviewName: string; missingOnGoogleAt: string | null }>(
  local: readonly T[],
  seenNames: ReadonlySet<string>
): T[] {
  return local.filter((row) => !seenNames.has(row.googleReviewName) && row.missingOnGoogleAt === null);
}
