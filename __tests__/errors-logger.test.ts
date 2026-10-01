import { describe, it, expect, vi } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  DatabaseError,
  GoogleApiError,
  GoogleAuthError,
  GoogleForbiddenError,
  GoogleNotFoundError,
  GoogleQuotaError,
  GoogleRateLimitError,
  GoogleUnavailableError,
  GeminiError,
  UnknownError,
  toUserMessage,
  toStatusCode,
  toErrorCode,
  toLogContext,
} from "@/lib/errors";

describe("Error hierarchy — status codes", () => {
  it("AppError uses provided statusCode", () => {
    expect(new AppError("msg", "CODE", 418).statusCode).toBe(418);
  });
  it("AuthenticationError → 401", () => {
    expect(new AuthenticationError().statusCode).toBe(401);
  });
  it("AuthorizationError → 403", () => {
    expect(new AuthorizationError().statusCode).toBe(403);
  });
  it("ValidationError → 400", () => {
    expect(new ValidationError("bad").statusCode).toBe(400);
  });
  it("DatabaseError → 500", () => {
    expect(new DatabaseError().statusCode).toBe(500);
  });
  it("GoogleApiError → 502", () => {
    expect(new GoogleApiError("msg", 500).statusCode).toBe(502);
  });
  it("GoogleQuotaError → 502, googleErrorCode=429", () => {
    const e = new GoogleQuotaError();
    expect(e.statusCode).toBe(502);
    expect(e.googleErrorCode).toBe(429);
  });
  it("GoogleRateLimitError → 502, googleErrorCode=429", () => {
    expect(new GoogleRateLimitError().googleErrorCode).toBe(429);
  });
  it("GeminiError → 502", () => {
    expect(new GeminiError().statusCode).toBe(502);
  });
  it("UnknownError → 500", () => {
    expect(new UnknownError().statusCode).toBe(500);
  });
});

describe("Error hierarchy — names", () => {
  it("AuthenticationError.name", () => {
    expect(new AuthenticationError().name).toBe("AuthenticationError");
  });
  it("GoogleAuthError.name", () => {
    expect(new GoogleAuthError().name).toBe("GoogleAuthError");
  });
  it("GoogleForbiddenError.name", () => {
    expect(new GoogleForbiddenError().name).toBe("GoogleForbiddenError");
  });
  it("GoogleNotFoundError.name", () => {
    expect(new GoogleNotFoundError().name).toBe("GoogleNotFoundError");
  });
  it("GoogleUnavailableError.name", () => {
    expect(new GoogleUnavailableError().name).toBe("GoogleUnavailableError");
  });
  it("GeminiError.name", () => {
    expect(new GeminiError().name).toBe("GeminiError");
  });
});

describe("Error hierarchy — instanceof", () => {
  it("AuthenticationError instanceof AppError", () => {
    expect(new AuthenticationError()).toBeInstanceOf(AppError);
  });
  it("GoogleQuotaError instanceof GoogleApiError", () => {
    expect(new GoogleQuotaError()).toBeInstanceOf(GoogleApiError);
  });
  it("GeminiError instanceof AppError", () => {
    expect(new GeminiError()).toBeInstanceOf(AppError);
  });
  it("DatabaseError instanceof AppError", () => {
    expect(new DatabaseError()).toBeInstanceOf(AppError);
  });
});

describe("toUserMessage", () => {
  it("returns AppError message for known errors", () => {
    expect(toUserMessage(new ValidationError("Invalid email"))).toBe("Invalid email");
  });
  it("returns generic message for plain Error", () => {
    expect(toUserMessage(new Error("internal DB error"))).toContain("unexpected");
  });
  it("returns generic message for non-Error values", () => {
    expect(toUserMessage("string error")).toContain("unexpected");
  });
  it("returns generic message for null", () => {
    expect(toUserMessage(null)).toContain("unexpected");
  });
});

describe("toStatusCode", () => {
  it("returns AppError statusCode", () => {
    expect(toStatusCode(new AuthorizationError())).toBe(403);
  });
  it("returns 500 for plain Error", () => {
    expect(toStatusCode(new Error("oops"))).toBe(500);
  });
  it("returns 500 for non-Error", () => {
    expect(toStatusCode("string")).toBe(500);
  });
});

describe("toErrorCode", () => {
  it("returns code for AppError", () => {
    expect(toErrorCode(new ValidationError("x"))).toBe("VALIDATION_ERROR");
  });
  it("returns error name for plain Error", () => {
    expect(toErrorCode(new TypeError("x"))).toBe("TypeError");
  });
  it("returns UNKNOWN_ERROR for non-Error", () => {
    expect(toErrorCode(42)).toBe("UNKNOWN_ERROR");
  });
});

describe("toLogContext", () => {
  it("includes errorCode and message for AppError", () => {
    const ctx = toLogContext(new DatabaseError("DB failed"));
    expect(ctx.errorCode).toBe("DB_ERROR");
    expect(ctx.message).toBe("DB failed");
  });
  it("never exposes stack trace", () => {
    const ctx = toLogContext(new Error("oops"));
    expect(JSON.stringify(ctx)).not.toContain("at ");
  });
  it("handles non-Error values", () => {
    const ctx = toLogContext("raw string");
    expect(ctx.errorCode).toBe("UNKNOWN_ERROR");
  });
});

describe("Logger — secret scrubbing", () => {
  it("scrubs token keys from log context", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test-scrub", {
      userId: "user-1",
      access_token: "should-be-redacted",
      refresh_token: "also-redacted",
    });

    const logged = spy.mock.calls[0]?.[0] as string;
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("should-be-redacted");
    expect(logged).not.toContain("also-redacted");
    expect(logged).toContain("user-1");
    spy.mockRestore();
  });

  it("scrubs _enc suffix keys", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test-enc", {
      access_token_enc: "encrypted-token-value",
      refresh_token_enc: "encrypted-refresh-value",
    });

    const logged = spy.mock.calls[0]?.[0] as string;
    expect(logged).not.toContain("encrypted-token-value");
    expect(logged).not.toContain("encrypted-refresh-value");
    spy.mockRestore();
  });

  it("preserves safe context fields", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test-safe", {
      userId: "user-safe-1",
      workspaceId: "ws-safe-1",
      operation: "review.sync.test",
    });

    const logged = spy.mock.calls[0]?.[0] as string;
    expect(logged).toContain("user-safe-1");
    expect(logged).toContain("ws-safe-1");
    expect(logged).toContain("review.sync.test");
    spy.mockRestore();
  });

  it("includes timestamp in log output", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test-ts-event");

    const logged = spy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logged) as Record<string, unknown>;
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test-ts-event");
    spy.mockRestore();
  });

  it("uses console.error for error level", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("something went wrong", { errorCode: "TEST" });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("withLogging logs start and completion", async () => {
    const { withLogging } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await withLogging("test.operation.wl", { userId: "u-1" }, async () => "result");

    const calls = spy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("started"))).toBe(true);
    expect(calls.some((c) => c.includes("completed"))).toBe(true);
    spy.mockRestore();
  });

  it("withLogging logs failure and rethrows", async () => {
    const { withLogging } = await import("@/lib/logger");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      withLogging("failing.op.wl", { userId: "u-1" }, async () => {
        throw new Error("oops-wl");
      })
    ).rejects.toThrow("oops-wl");

    const calls = errorSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("failed"))).toBe(true);
    errorSpy.mockRestore();
  });
});
