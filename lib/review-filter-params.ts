/**
 * Multi-value review filter params.
 *
 * The inbox filters are multiselect: several statuses, star ratings,
 * languages, themes, or assignees can be active at once. They travel in the
 * URL as one comma-joined param (`filter=unanswered,draft&rating=1,2`), so
 * older single-value links (`rating=4`) keep working unchanged.
 */

/** Status keys the inbox query understands. `all` means "no status filter". */
export const REVIEW_STATUS_KEYS = [
  "unanswered",
  "attention",
  "answered",
  "draft",
  "approved",
  "failed",
  "published",
  "reopened",
  "escalated",
] as const;

export type ReviewStatusKey = (typeof REVIEW_STATUS_KEYS)[number];

/** Flatten a raw param (string, repeated param, comma list) into clean values. */
export function splitParamValues(value: string | string[] | undefined | null): string[] {
  const parts = (Array.isArray(value) ? value : [value ?? ""])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set(parts)];
}

/** Values from the param that belong to `allowed`, in first-seen order. */
export function parseAllowedParams(
  value: string | string[] | undefined | null,
  allowed: readonly string[]
): string[] {
  const allowedSet = new Set(allowed);
  return splitParamValues(value).filter((item) => allowedSet.has(item));
}

/** Selected status keys. `all` and unknown keys drop out; empty means All. */
export function parseStatusParams(value: string | string[] | undefined | null): string[] {
  return parseAllowedParams(value, REVIEW_STATUS_KEYS);
}

/** Selected star ratings (1–5), highest first. */
export function parseRatingParams(value: string | string[] | undefined | null): number[] {
  const ratings = splitParamValues(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 5);
  return [...new Set(ratings)].sort((a, b) => b - a);
}

/** Join values back into one param value, or null when there is nothing to set. */
export function serializeParamValues(values: readonly (string | number)[]): string | null {
  return values.length > 0 ? values.join(",") : null;
}

const STATUS_OPERANDS: Record<string, string> = {
  unanswered: "reply_status.eq.none",
  attention: "reply_status.in.(none,draft,failed)",
  answered: "reply_status.neq.none",
  draft: "reply_status.eq.draft",
  approved: "reply_status.in.(approved,pending_publish)",
  failed: "reply_status.eq.failed",
  published: "reply_status.eq.published",
  // PostgREST has no portable "is not null" operand inside or(); any real
  // reopen timestamp is after the epoch.
  reopened: "reopened_at.gt.1970-01-01T00:00:00Z",
  escalated: "and(star_rating.lte.3,reply_status.in.(none,draft,failed))",
};

/** One status as a PostgREST `or()` operand, or null for unknown keys. */
export function statusFilterOperand(status: string): string | null {
  return STATUS_OPERANDS[status] ?? null;
}

/**
 * Combined `or()` filter for two or more statuses (a review matching ANY
 * selected status). Null when fewer than two usable statuses — callers use
 * the plain single-status condition instead.
 */
export function statusOrFilter(statuses: readonly string[]): string | null {
  const operands = statuses
    .map((status) => statusFilterOperand(status))
    .filter((operand): operand is string => operand !== null);
  return operands.length >= 2 ? operands.join(",") : null;
}
