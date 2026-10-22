import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchWithTransientRetry,
  isIssuedAtFutureRejection,
} from "@/lib/supabase/transient-fetch";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function response(status: number, body: string) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

const FUTURE_JWT_BODY = JSON.stringify({
  code: "PGRST301",
  details: null,
  hint: null,
  message: "JWT issued at future",
});

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isIssuedAtFutureRejection", () => {
  it("matches the PostgREST clock-skew rejection", () => {
    expect(isIssuedAtFutureRejection(401, FUTURE_JWT_BODY)).toBe(true);
    expect(isIssuedAtFutureRejection(401, "JWT not yet valid")).toBe(true);
  });

  it("does not match other failures", () => {
    expect(isIssuedAtFutureRejection(401, "Invalid API key")).toBe(false);
    expect(isIssuedAtFutureRejection(403, FUTURE_JWT_BODY)).toBe(false);
    expect(isIssuedAtFutureRejection(200, FUTURE_JWT_BODY)).toBe(false);
  });
});

describe("fetchWithTransientRetry", () => {
  it("retries a JWT-issued-at-future rejection and returns the success", async () => {
    mockFetch
      .mockResolvedValueOnce(response(401, FUTURE_JWT_BODY))
      .mockResolvedValueOnce(response(200, "[]"));

    const promise = fetchWithTransientRetry("https://example.test/rest/v1/x");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts and returns the last rejection", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(response(401, FUTURE_JWT_BODY)));

    const promise = fetchWithTransientRetry("https://example.test/rest/v1/x");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a genuine auth failure", async () => {
    mockFetch.mockResolvedValueOnce(response(401, "Invalid API key"));

    const res = await fetchWithTransientRetry("https://example.test/rest/v1/x");

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry successes or server errors", async () => {
    mockFetch.mockResolvedValueOnce(response(500, "boom"));

    const res = await fetchWithTransientRetry("https://example.test/rest/v1/x");

    expect(res.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates network errors without retrying", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(fetchWithTransientRetry("https://example.test/rest/v1/x")).rejects.toThrow(
      "fetch failed"
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
