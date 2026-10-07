export interface ReviewText {
  original: string;
  /** Google's machine translation, when the review carries one that differs from the original. */
  translation: string | null;
}

const TRANSLATED = "(Translated by Google)";
const ORIGINAL = "(Original)";

function normalized(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Dice coefficient over character bigrams, 0–1. */
function similarity(a: string, b: string): number {
  const x = normalized(a);
  const y = normalized(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const bg = x.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (x.length + y.length - 2);
}

/**
 * Google stores translated reviews as either
 *   "(Translated by Google) <translation>\n\n(Original)\n<original>" or
 *   "<original>\n\n(Translated by Google)\n<translation>".
 */
export function splitGoogleTranslation(comment: string): ReviewText {
  const text = comment.trim();
  const tIdx = text.indexOf(TRANSLATED);
  if (tIdx === -1) return { original: text, translation: null };

  let original: string;
  let translation: string;
  if (tIdx === 0) {
    const rest = text.slice(TRANSLATED.length);
    const oIdx = rest.indexOf(ORIGINAL);
    if (oIdx === -1) return { original: rest.trim(), translation: null };
    translation = rest.slice(0, oIdx).trim();
    original = rest.slice(oIdx + ORIGINAL.length).trim();
  } else {
    original = text.slice(0, tIdx).trim();
    translation = text.slice(tIdx + TRANSLATED.length).trim();
  }

  if (!original) return { original: translation, translation: null };
  // Google often "translates" Malayalam typed in English letters into a near-copy.
  if (!translation || similarity(translation, original) >= 0.85) {
    return { original, translation: null };
  }
  return { original, translation };
}

/** Best single-language version of a review for analysis (translation when present). */
export function readableReviewText(comment: string | null): string | null {
  if (!comment?.trim()) return null;
  const { original, translation } = splitGoogleTranslation(comment);
  return translation ?? original;
}
