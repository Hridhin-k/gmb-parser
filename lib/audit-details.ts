import { AppError, GoogleApiError } from "@/lib/errors";

// Applied both before storage and before sending historical metadata to the UI.
// Token counts are diagnostics; credentials and raw provider payloads are not.
const sensitive = /authorization|cookie|password|secret|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|^token$|_enc$|private[_-]?key|^headers$|^requestBody|^responseBody|^prompt$|^systemPrompt$|^stack$/i;

function scrubText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|client[_-]?secret)\s*[=:]\s*)["']?[^\s"'&,}]+["']?/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ya29\.[A-Za-z0-9._-]+|upstep_mcp_[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]");
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>();
  function visit(value: unknown, depth: number): unknown {
    if (typeof value === "string") return scrubText(value);
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object") return undefined;
    if (seen.has(value)) return "[Circular]";
    if (depth > 12) return "[Nested details omitted]";
    seen.add(value);
    const result = Array.isArray(value)
      ? value.map((item) => visit(item, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
          sensitive.test(key) || (/token/i.test(key) && !(typeof item === "number" && /^(?:inputTokens|outputTokens|cachedInputTokens|cacheWriteTokens|reasoningTokens|maxOutputTokens)$/i.test(key)))
            ? "[REDACTED]" : visit(item, depth + 1)]));
    seen.delete(value);
    return result;
  }
  return visit(metadata, 0) as Record<string, unknown>;
}

/** Diagnostic exception messages, never stacks, SDK request/response bodies or arbitrary error metadata. */
export function auditErrorDetails(error: unknown): Record<string, unknown> {
  const verification = error instanceof AppError && error.metadata?.verification;
  const safeVerification = verification && typeof verification === "object"
    ? Object.fromEntries(Object.entries(verification).filter(([key, value]) =>
        ["writeStatus", "reviewStatus", "parentStatus", "writeAttempts"].includes(key) && (typeof value === "number" || value === null)
        || key === "reason" && typeof value === "string" && /^[\w.-]{1,100}$/.test(value)
        || ["writeMessage", "retryMessage"].includes(key) && (value === null || typeof value === "string" && value.length <= 300)))
    : undefined;
  return {
    errorCode: error instanceof AppError ? error.code : "UNKNOWN_ERROR",
    errorClass: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? scrubText(error.message) : "An unexpected error occurred. Check server logs using the event context.",
    ...(error instanceof AppError ? { statusCode: error.statusCode } : {}),
    ...(error instanceof GoogleApiError ? { providerStatus: error.googleErrorCode } : {}),
    ...(safeVerification ? { verification: safeVerification } : {}),
  };
}

const labels: Record<string, string> = {
  errorCode: "Error code", errorClass: "Error type", errorMessage: "Reason", providerStatus: "Provider HTTP status",
  statusCode: "HTTP status", retryable: "Retryable", durationMs: "Duration (ms)", reviewId: "Review ID",
  replyId: "Reply ID", locationId: "Location ID", clientId: "Business ID", requestId: "Request ID",
  providerRequestId: "Provider request ID", failureCount: "Failed attempts", reviewMissingOnGoogle: "Missing on Google",
  providerResponseId: "Provider response ID",
  reviewsSynced: "New reviews", reviewsUpdated: "Updated reviews", pagesProcessed: "Pages", googleEmail: "Google account",
  aiConfigVersion: "AI config version", jobId: "Job ID", runId: "Run ID", reportId: "Report ID",
};

export function auditMetadataDetails(metadata: unknown): Array<{ label: string; value: string }> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(sanitizeAuditMetadata(metadata as Record<string, unknown>))
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({
      label: labels[key] ?? (key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())),
      value: typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value),
    }));
}
