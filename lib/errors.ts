// =============================================================================
// GRM — Centralized Error Hierarchy
//
// RULES:
//   - `message` is the SAFE user-facing message. Never put stack traces or
//     internal details here.
//   - `code` is the machine-readable error identifier for logging/routing.
//   - `metadata` is for server-side logging ONLY — never send to the browser.
//   - Never include OAuth tokens, API keys, or secrets anywhere in this file.
// =============================================================================

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// Authentication & Authorization
// ---------------------------------------------------------------------------

/** 401 — user is not authenticated */
export class AuthenticationError extends AppError {
  constructor(message = "You must be signed in to perform this action.") {
    super(message, "UNAUTHENTICATED", 401);
    this.name = "AuthenticationError";
  }
}

/** Legacy alias used in existing code */
export class AuthError extends AuthenticationError {
  constructor(message?: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** 403 — user is authenticated but lacks permission */
export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "FORBIDDEN", 403);
    this.name = "AuthorizationError";
  }
}

/** Legacy alias */
export class ForbiddenError extends AuthorizationError {
  constructor(message?: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** 400 — the request is malformed or contains invalid values */
export class ValidationError extends AppError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, metadata);
    this.name = "ValidationError";
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** 500 — a database operation failed unexpectedly */
export class DatabaseError extends AppError {
  constructor(
    message = "A database error occurred. Please try again.",
    metadata?: Record<string, unknown>
  ) {
    super(message, "DB_ERROR", 500, metadata);
    this.name = "DatabaseError";
  }
}

// ---------------------------------------------------------------------------
// Google API errors
// ---------------------------------------------------------------------------

/**
 * Base class for all Google API failures.
 * `googleErrorCode` carries the HTTP status from Google's response.
 */
export class GoogleApiError extends AppError {
  constructor(
    message: string,
    public readonly googleErrorCode?: number,
    metadata?: Record<string, unknown>
  ) {
    super(message, "GOOGLE_API_ERROR", 502, metadata);
    this.name = "GoogleApiError";
  }
}

/** 401 from Google — token invalid or expired */
export class GoogleAuthError extends GoogleApiError {
  constructor(message = "Your Google connection is no longer valid. Please reconnect.") {
    super(message, 401);
    this.name = "GoogleAuthError";
    // Override code for finer routing
    (this as unknown as { code: string }).code = "GOOGLE_AUTH_ERROR";
  }
}

/** 403 from Google — insufficient scope or revoked */
export class GoogleForbiddenError extends GoogleApiError {
  constructor(message = "You do not have permission to access this Google resource.") {
    super(message, 403);
    this.name = "GoogleForbiddenError";
    (this as unknown as { code: string }).code = "GOOGLE_FORBIDDEN";
  }
}

/** 404 from Google — resource deleted or inaccessible */
export class GoogleNotFoundError extends GoogleApiError {
  constructor(message = "The requested Google resource could not be found.") {
    super(message, 404);
    this.name = "GoogleNotFoundError";
    (this as unknown as { code: string }).code = "GOOGLE_NOT_FOUND";
  }
}

/** 429 from Google — quota exceeded */
export class GoogleQuotaError extends GoogleApiError {
  constructor(message = "Google API quota exceeded. Please try again later.") {
    super(message, 429);
    this.name = "GoogleQuotaError";
    (this as unknown as { code: string }).code = "GOOGLE_QUOTA_ERROR";
  }
}

/** 429 from Google — rate limited (short backoff appropriate) */
export class GoogleRateLimitError extends GoogleApiError {
  constructor(message = "Too many requests to Google. Please wait a moment.") {
    super(message, 429);
    this.name = "GoogleRateLimitError";
    (this as unknown as { code: string }).code = "GOOGLE_RATE_LIMIT";
  }
}

/** 5xx from Google — transient server-side failure */
export class GoogleUnavailableError extends GoogleApiError {
  constructor(message = "Google's service is temporarily unavailable. Please try again.") {
    super(message, 503);
    this.name = "GoogleUnavailableError";
    (this as unknown as { code: string }).code = "GOOGLE_UNAVAILABLE";
  }
}

// ---------------------------------------------------------------------------
// Gemini / AI errors
// ---------------------------------------------------------------------------

export class GeminiError extends AppError {
  constructor(
    message = "AI generation failed. Please try again.",
    code = "GEMINI_ERROR",
    metadata?: Record<string, unknown>
  ) {
    super(message, code, 502, metadata);
    this.name = "GeminiError";
  }
}

// ---------------------------------------------------------------------------
// Catch-all
// ---------------------------------------------------------------------------

export class UnknownError extends AppError {
  constructor(message = "An unexpected error occurred. Please try again.") {
    super(message, "UNKNOWN_ERROR", 500);
    this.name = "UnknownError";
  }
}

// ---------------------------------------------------------------------------
// Helper: produce a safe user message from any thrown value
// ---------------------------------------------------------------------------

/**
 * Extracts a user-safe error message from any thrown value.
 * Never exposes stack traces, raw DB errors, or internal codes.
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "An unexpected error occurred. Please try again.";
}

/**
 * Returns the HTTP status code appropriate for a thrown value.
 */
export function toStatusCode(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  return 500;
}

/**
 * Returns the machine-readable code for logging.
 */
export function toErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error) return error.name;
  return "UNKNOWN_ERROR";
}

/**
 * Returns safe server-log context for an error. Never includes secrets.
 */
export function toLogContext(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return {
      errorCode: error.code,
      statusCode: error.statusCode,
      message: error.message,
      // metadata is safe — we never put tokens there by convention
      ...(error.metadata ? { detail: error.metadata } : {}),
    };
  }
  if (error instanceof Error) {
    return { errorCode: error.name, message: error.message };
  }
  return { errorCode: "UNKNOWN_ERROR" };
}
