// =============================================================================
// GRM — Server-side input validation helpers
//
// All validation is done with Zod (already a project dependency).
// These functions are server-only — never import in client components.
// =============================================================================

import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { DATE_RANGE_OPTIONS, type DateRangeKey } from "@/lib/date-range";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Standard UUID v4 shape — rejects arbitrary strings, prevents injection. */
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Invalid ID format"
  );

/** Reply / AI content — non-empty, max 4 000 chars (Google's limit is ~4 000). */
const replyContentSchema = z
  .string()
  .min(1, "Reply content cannot be empty")
  .max(4000, "Reply content must be 4 000 characters or fewer")
  .transform((s) => s.trim());

/** Safe page number — positive integer, bounded. */
const pageSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(1000)
  .default(1);

/** Safe filter string — no SQL wildcards, reasonable length. */
const filterStringSchema = z
  .string()
  .max(200)
  .transform((s) => s.trim())
  .optional()
  .default("");

// ---------------------------------------------------------------------------
// Exported validators
// ---------------------------------------------------------------------------

/**
 * Validates a UUID from route params or body.
 * Throws ValidationError on failure (caught by API route error handlers).
 */
export function validateId(value: unknown, fieldName = "id"): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid ${fieldName}: must be a valid UUID`, {
      field: fieldName,
      value: typeof value === "string" ? value.slice(0, 40) : typeof value,
    });
  }
  return result.data;
}

/**
 * Validates and coerces a page number from searchParams/query.
 */
export function validatePage(value: unknown): number {
  const result = pageSchema.safeParse(value);
  if (!result.success) return 1;
  return result.data;
}

/**
 * Validates a filter/search string — strips, trims, bounds length.
 */
export function validateFilterString(value: unknown): string {
  const result = filterStringSchema.safeParse(value);
  if (!result.success) return "";
  return result.data;
}

// ---------------------------------------------------------------------------
// Schemas for composite request bodies
// ---------------------------------------------------------------------------

/** POST /api/reviews/[reviewId]/reply */
export const createReplyBodySchema = z.object({
  content: replyContentSchema,
  expectedGoogleReply: z.string().max(10000).nullable().optional(),
});

/** PUT /api/reviews/[reviewId]/reply */
export const updateReplyBodySchema = z.object({
  content: replyContentSchema,
  replyId: uuidSchema,
  expectedContent: z.string().max(10000).optional(),
  expectedGoogleReply: z.string().max(10000).nullable().optional(),
});

/** DELETE /api/reviews/[reviewId]/reply */
export const deleteReplyBodySchema = z.object({
  replyId: uuidSchema,
});

/** POST /api/reviews/[reviewId]/reply/approve */
export const approveReplyBodySchema = z.object({
  replyId: uuidSchema,
});

/** POST /api/reviews/[reviewId]/reply/publish */
export const publishReplyBodySchema = z.object({
  replyId: uuidSchema,
});

/** POST /api/reviews/bulk */
export const bulkReviewsBodySchema = z.object({
  action: z.enum(["generate", "approve", "publish", "discard", "assign"]),
  reviewIds: z.array(uuidSchema).min(1).max(50),
  assigneeId: z.string().uuid().nullable().optional(),
  /** generate only: end each draft with the saved resolution phone and/or email. */
  contact: z.enum(["phone", "email", "both"]).optional(),
});

/** POST /api/reviews/sync */
const syncPeriodSchema = z.object({
  range: z.enum(DATE_RANGE_OPTIONS.map((option) => option.key) as [DateRangeKey, ...DateRangeKey[]]),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine((period) => period.range !== "custom" || Boolean(period.from && period.to && period.from <= period.to),
  { message: "Choose a valid start and end date for the sync period." });

export const syncBodySchema = z.discriminatedUnion("all", [
  z.object({
    all: z.literal(true),
    full: z.boolean().optional(),
    period: syncPeriodSchema.optional(),
    /** Narrow the sync to these locations (the page's scope). Omit for the whole workspace. */
    locationIds: z.array(uuidSchema).min(1).max(1000).optional(),
  }),
  z.object({
    all: z.literal(false).optional(),
    locationId: uuidSchema,
    connectionId: uuidSchema.optional(),
    full: z.boolean().optional(),
    period: syncPeriodSchema.optional(),
  }),
]);

/**
 * Parse and validate a request body schema, throwing ValidationError on failure.
 * Use this in API routes: const body = await parseBody(request, mySchema);
 */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("Invalid JSON in request body");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ValidationError(
      first?.message ?? "Invalid request body",
      { fields: result.error.issues.map((e: z.ZodIssue) => ({ path: e.path.join("."), message: e.message })) }
    );
  }

  return result.data as z.infer<T>;
}
