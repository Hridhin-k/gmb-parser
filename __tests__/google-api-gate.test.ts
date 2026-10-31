import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireGoogleSlot,
  backoffMs,
  googleFetch,
  parseRetryAfter,
  resetGoogleGate,
  withGooglePriority,
} from "@/lib/google-api-gate";
import { describeSyncFailure } from "@/lib/sync-failure";
import { classifyReviewError, isRetryableReviewError } from "@/lib/services/google-reviews";
import { GoogleApiError } from "@/lib/errors";

function res(status: number, headers: Record<string, string> = {}) {
  return new Response("{}", { status, headers });
}

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("nonsense")).toBeNull();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
  });
});

describe("backoffMs", () => {
  it("grows exponentially with jitter and honours Retry-After", () => {
    vi.stubEnv("GOOGLE_API_RETRY_BASE_MS", "1000");
    expect(backoffMs(1, null, () => 0)).toBe(500);
    expect(backoffMs(1, null, () => 1)).toBe(1000);
    expect(backoffMs(3, null, () => 1)).toBe(4000);
    expect(backoffMs(2, 9000, () => 0)).toBe(9000);
    expect(backoffMs(20, null, () => 1)).toBe(30_000);
    vi.unstubAllEnvs();
  });
});

describe("pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_API_RPM", "60"); // one slot per second
    resetGoogleGate();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetGoogleGate();
  });

  it("spaces background calls by the configured interval", async () => {
    const done: number[] = [];
    const calls = [0, 1, 2].map(() => acquireGoogleSlot("background").then(() => done.push(Date.now())));
    await vi.advanceTimersByTimeAsync(2100);
    await Promise.all(calls);
    const start = done[0];
    expect(done.map((t) => t - start)).toEqual([0, 1000, 2000]);
  });

  it("lets interactive calls jump a background backlog", async () => {
    const order: string[] = [];
    const bg = [0, 1, 2].map((i) => acquireGoogleSlot("background").then(() => order.push(`bg${i}`)));
    await Promise.resolve();
    const ui = withGooglePriority("interactive", () =>
      acquireGoogleSlot().then(() => order.push("ui"))
    );
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([...bg, ui]);
    expect(order.indexOf("ui")).toBeLessThan(order.indexOf("bg2"));
  });
});

describe("googleFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GOOGLE_API_RPM", "0");
    vi.stubEnv("GOOGLE_API_RETRY_BASE_MS", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retries 429 then returns the success", async () => {
    fetchMock.mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
    const r = await googleFetch("https://x.test", {});
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the last 429 once attempts run out", async () => {
    fetchMock.mockResolvedValue(res(429));
    const r = await googleFetch("https://x.test", {}, { maxAttempts: 3 });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    fetchMock.mockResolvedValue(res(403));
    const r = await googleFetch("https://x.test", {});
    expect(r.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures and rethrows the last one", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(googleFetch("https://x.test", {}, { maxAttempts: 2 })).rejects.toThrow("boom");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("error classification and messages", () => {
  it("treats throttling and 5xx as retryable, auth as not", () => {
    expect(classifyReviewError(new GoogleApiError("x", 503))).toBe("server");
    expect(classifyReviewError(new GoogleApiError("x", undefined))).toBe("network");
    for (const c of ["rate_limit", "quota", "server", "network"]) expect(isRetryableReviewError(c)).toBe(true);
    for (const c of ["authentication", "authorization", "not_found", "invalid_request", null]) {
      expect(isRetryableReviewError(c)).toBe(false);
    }
  });

  it("gives every class an honest status and next step", () => {
    expect(describeSyncFailure("rate_limit")).toMatchObject({ status: 429, retryable: true });
    expect(describeSyncFailure("network")).toMatchObject({ status: 503, retryable: true });
    expect(describeSyncFailure("authentication")).toMatchObject({ status: 401, action: "reconnect", retryable: false });
    expect(describeSyncFailure("authorization")).toMatchObject({ status: 403, retryable: false });
    expect(describeSyncFailure("not_found")).toMatchObject({ status: 404 });
    expect(describeSyncFailure(undefined).status).toBe(500);
  });
});
