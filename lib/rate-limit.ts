// =============================================================================
// GRM — In-process rate limiter
//
// Uses a sliding window per (userId, operation) key.
// This is a per-instance in-memory store — sufficient for a single-server
// deployment. For multi-instance deployments, replace with Redis/Upstash.
//
// Never throws — returns a RateLimitResult so callers can decide how to respond.
// =============================================================================

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

export interface RateLimitConfig {
  /** Maximum requests in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

// Evict stale entries periodically to prevent unbounded memory growth
let lastEviction = Date.now();
const EVICTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function evictStale(windowMs: number): void {
  const now = Date.now();
  if (now - lastEviction < EVICTION_INTERVAL_MS) return;
  lastEviction = now;
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > windowMs * 2) {
      store.delete(key);
    }
  }
}

/**
 * Check and record a rate-limited request.
 *
 * @param userId  The authenticated user ID
 * @param op      Operation name, e.g. "ai.generate" or "sync.location"
 * @param config  Limit configuration
 */
export function checkRateLimit(
  userId: string,
  op: string,
  config: RateLimitConfig
): RateLimitResult {
  evictStale(config.windowMs);

  const now = Date.now();
  const key = `${userId}:${op}`;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= config.windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: config.limit - 1, resetMs: config.windowMs };
  }

  if (entry.count >= config.limit) {
    const resetMs = config.windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: config.limit - entry.count,
    resetMs: config.windowMs - (now - entry.windowStart),
  };
}

// ---------------------------------------------------------------------------
// Pre-configured limits for each protected operation
// ---------------------------------------------------------------------------

/** AI draft generation: max 5 per user per minute */
export const AI_GENERATE_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 60_000,
};

/** Review sync (single location): max 10 per user per minute */
export const SYNC_LOCATION_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60_000,
};

/** Bulk sync (all locations): max 3 per user per 5 minutes */
export const SYNC_ALL_LIMIT: RateLimitConfig = {
  limit: 3,
  windowMs: 5 * 60_000,
};

/** Reply publish: max 20 per user per minute */
export const PUBLISH_LIMIT: RateLimitConfig = {
  limit: 20,
  windowMs: 60_000,
};

/** CSV export: max 5 per user per minute */
export const EXPORT_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 60_000,
};
