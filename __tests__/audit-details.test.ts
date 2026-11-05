import { describe, expect, it } from "vitest";
import { auditErrorDetails, auditMetadataDetails, sanitizeAuditMetadata } from "@/lib/audit-details";
import { AppError, GoogleApiError } from "@/lib/errors";

describe("audit diagnostics", () => {
  it("shows previously hidden failure fields, false values, counts and nested results", () => {
    const details = auditMetadataDetails({ errorCode: "GOOGLE_REPLY_UNAVAILABLE", retryable: false, failureCount: 0,
      verification: { reviewStatus: 200, replyStatus: 404 }, reviewIds: ["review-a", "review-b"], missing: null });
    expect(details).toEqual(expect.arrayContaining([
      { label: "Error code", value: "GOOGLE_REPLY_UNAVAILABLE" },
      { label: "Retryable", value: "No" },
      { label: "Failed attempts", value: "0" },
      { label: "Verification", value: JSON.stringify({ reviewStatus: 200, replyStatus: 404 }, null, 2) },
    ]));
    expect(details.some((detail) => detail.label === "Missing")).toBe(false);
    expect(auditMetadataDetails(null)).toEqual([]);
  });

  it("redacts credentials recursively, including objects inside arrays and inline bearer values", () => {
    const original = { accessToken: "private-access", inputTokens: 123, outputTokens: 0,
      nested: [{ authorization: "private-header", refresh_token: "private-refresh", model: "test-model" }],
      errorMessage: "Request failed with Bearer private-bearer and sk-privateapikey1234",
      requestBodyValues: { prompt: "private-review" }, responseBody: "private-response" };
    const safe = sanitizeAuditMetadata(original);
    const serialized = JSON.stringify(safe);
    for (const secret of ["private-access", "private-header", "private-refresh", "private-bearer", "sk-privateapikey1234", "private-review", "private-response"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(safe).toMatchObject({ inputTokens: 123, outputTokens: 0, nested: [{ model: "test-model" }] });
    expect(original.accessToken).toBe("private-access");
  });

  it("uses safe application messages and preserves Google HTTP status without copying raw error metadata", () => {
    expect(auditErrorDetails(new GoogleApiError("Google rejected the reply.", 403, { accessToken: "private", responseBody: "private" })))
      .toMatchObject({ errorCode: "GOOGLE_API_ERROR", errorMessage: "Google rejected the reply.", providerStatus: 403, statusCode: 502 });
    expect(auditErrorDetails(new Error("Failed to save analysis: access_token=private-value")))
      .toMatchObject({ errorMessage: "Failed to save analysis: access_token=[REDACTED]" });
    expect(auditErrorDetails(new AppError("Credits exhausted.", "AI_CREDITS_EXHAUSTED", 402)).errorCode).toBe("AI_CREDITS_EXHAUSTED");
  });
});
