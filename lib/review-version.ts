import { createHash } from "crypto";

/**
 * Review versioning for Google sync. A fingerprint covers the fields that
 * change what a review means: stars, text, and the review's create time.
 * Reviewer name, profile photo, and Google update timestamps are not included.
 */

const STAR_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function canonicalReviewText(value: string | null | undefined): string {
  if (!value) return "";
  return value.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/** Same instant, whatever offset or millisecond form Google used. */
export function canonicalInstant(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) return value.trim();
  return new Date(parsed).toISOString();
}

export function canonicalStars(value: number | string): number {
  if (typeof value === "number" && value >= 1 && value <= 5) return value;
  if (typeof value === "string" && STAR_WORDS[value]) return STAR_WORDS[value];
  throw new Error("Review star rating is not a Google rating");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ContentFingerprintInput {
  starRating: number | string;
  comment: string | null;
  createTime: string | null;
}

export function contentFingerprint(input: ContentFingerprintInput): string {
  const stars = canonicalStars(input.starRating);
  const comment = canonicalReviewText(input.comment);
  const created = canonicalInstant(input.createTime);
  return sha256(`stars:${stars}\ncomment:${comment}\ncreated:${created}`);
}

/** Google's reply text. Empty and missing are the same response state. */
export function responseFingerprint(replyComment: string | null | undefined): string {
  return sha256(`reply:${canonicalReviewText(replyComment)}`);
}

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
  /** Comment text changed. */
  textChanged: boolean;
  /** Star rating changed and the comment did not. */
  ratingChanged: boolean;
  /** Review date changed. */
  dateChanged: boolean;
  /** Google reply text changed. */
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
