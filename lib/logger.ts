// =============================================================================
// GRM — Structured Server Logger
//
// Outputs JSON log lines that can be parsed by log aggregation tools.
//
// SAFETY RULES (enforced by scrubSensitive):
//   - Never log OAuth access tokens
//   - Never log OAuth refresh tokens
//   - Never log Gemini API keys
//   - Never log any value whose key contains "token", "secret", "key", "password"
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  clientId?: string;
  locationId?: string;
  reviewId?: string;
  replyId?: string;
  operation?: string;
  durationMs?: number;
  success?: boolean;
  errorCode?: string;
  statusCode?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Secret scrubber — removes any key that looks like it could hold a secret
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api_key/i,
  /apikey/i,
  /access_token/i,
  /refresh_token/i,
  /_enc$/i,
  /private/i,
  /credential/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function scrubSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = scrubSensitive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core emit function
// ---------------------------------------------------------------------------

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  // Only run server-side (not in browser/client components)
  if (typeof window !== "undefined") return;

  const safe = scrubSensitive(context as Record<string, unknown>);

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safe,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const logger = {
  debug: (message: string, ctx?: LogContext) => emit("debug", message, ctx),
  info:  (message: string, ctx?: LogContext) => emit("info",  message, ctx),
  warn:  (message: string, ctx?: LogContext) => emit("warn",  message, ctx),
  error: (message: string, ctx?: LogContext) => emit("error", message, ctx),
};

// ---------------------------------------------------------------------------
// Request timing helper
// ---------------------------------------------------------------------------

/**
 * Wraps an async operation with structured start/end logging and duration.
 * Automatically logs success or failure with safe context.
 */
export async function withLogging<T>(
  operation: string,
  ctx: Omit<LogContext, "operation" | "durationMs" | "success" | "errorCode">,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  logger.info(`${operation}.started`, { ...ctx, operation });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    logger.info(`${operation}.completed`, { ...ctx, operation, durationMs, success: true });
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    const errorCode =
      (error instanceof Error && "code" in error)
        ? (error as { code: string }).code
        : "UNKNOWN_ERROR";
    const message = error instanceof Error ? error.message : String(error);

    logger.error(`${operation}.failed`, {
      ...ctx,
      operation,
      durationMs,
      success: false,
      errorCode,
      errorMessage: message,
    });

    throw error;
  }
}
