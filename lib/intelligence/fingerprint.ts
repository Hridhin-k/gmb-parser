import { createHash } from "crypto";

/** Rules pass that writes a current intelligence row without calling Gemini. */
export const RULES_ANALYSIS_VERSION = "rules-v1";

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

/**
 * Fields that change what a review means: stars, text, and the review's create time.
 * Reviewer name, profile photo, and Google update timestamps are not included.
 */
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
