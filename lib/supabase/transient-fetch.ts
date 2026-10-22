/**
 * Fetch wrapper for Supabase clients that survives one sporadic gateway
 * failure: "JWT issued at future" (PGRST301).
 *
 * With the current `sb_publishable_` / `sb_secret_` API keys, Supabase's
 * gateway mints a short-lived JWT for each request and PostgREST validates
 * it. When the validating instance's clock is a second or two behind the
 * minting instance, the token looks "issued in the future" and the request
 * is rejected with 401 before it ever executes — so retrying is safe for
 * every method, including writes: nothing was applied.
 *
 * Only that exact rejection is retried (twice, with a short back-off that
 * lets the clock skew pass). Every other response is returned untouched.
 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [350, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True only for the transient clock-skew rejection. Exported for tests. */
export function isIssuedAtFutureRejection(status: number, body: string): boolean {
  if (status !== 401) return false;
  return /jwt issued at future|jwt not yet valid|PGRST301/i.test(body);
}

export interface TransientFetchOptions {
  /** Per-attempt timeout. Omit for no timeout. */
  timeoutMs?: number;
}

export async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: TransientFetchOptions = {}
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const timeout = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
    const signal =
      timeout && init?.signal ? AbortSignal.any([init.signal, timeout]) : (init?.signal ?? timeout);

    let response: Response;
    try {
      response = await fetch(input instanceof Request ? input.clone() : input, {
        ...init,
        signal,
      });
    } catch (error) {
      // Network-level failures are not retried here; callers that need that
      // (e.g. rpcLocationReviewStats) layer their own retry on top.
      throw error;
    }

    if (attempt === MAX_ATTEMPTS - 1) return response;

    const body = await response
      .clone()
      .text()
      .catch(() => "");
    if (!isIssuedAtFutureRejection(response.status, body)) return response;

    lastError = undefined;
    await sleep(RETRY_DELAYS_MS[attempt] ?? 900);
  }

  // Unreachable in practice (the loop always returns), but keeps the type
  // checker honest if MAX_ATTEMPTS is ever set to 0.
  throw lastError ?? new Error("fetchWithTransientRetry: no attempt was made");
}
