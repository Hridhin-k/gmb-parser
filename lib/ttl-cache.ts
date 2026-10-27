import { getBenchDiagStore, recordCacheEvent } from "@/lib/bench-diag";

interface Entry<T> {
  value: T;
  expires: number;
}

/** Soft cap so a busy Node process cannot retain unbounded dashboard entries. */
export const TTL_CACHE_MAX_ENTRIES = 500;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
}

function evictIfNeeded(now: number): void {
  sweep(now);
  if (store.size < TTL_CACHE_MAX_ENTRIES) return;
  // Drop expired first, then oldest inserts (Map iteration order).
  for (const key of store.keys()) {
    if (store.size < TTL_CACHE_MAX_ENTRIES) return;
    store.delete(key);
  }
}

/** A value stored for this process only. Expired entries are treated as missing. */
export function peek<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function put<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  store.set(key, { value, expires: now + ttlMs });
  evictIfNeeded(now);
}

/**
 * Shares one load across overlapping callers and keeps the result for `ttlMs`.
 * Rejected loaders leave the key empty so the next caller retries.
 * A completed load only writes when it is still the current in-flight promise,
 * so a later invalidation cannot be overwritten by a stale result.
 */
export function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit !== undefined) {
    if (getBenchDiagStore()) recordCacheEvent("hit");
    return Promise.resolve(hit);
  }
  const pending = inflight.get(key);
  if (pending) {
    if (getBenchDiagStore()) recordCacheEvent("singleflight");
    return pending as Promise<T>;
  }
  if (getBenchDiagStore()) recordCacheEvent("miss");
  const promise = load()
    .then((value) => {
      if (inflight.get(key) === promise) {
        put(key, value, ttlMs);
        inflight.delete(key);
      }
      return value;
    })
    .catch((error: unknown) => {
      if (inflight.get(key) === promise) inflight.delete(key);
      throw error;
    });
  inflight.set(key, promise);
  return promise;
}

export function forget(key: string): void {
  store.delete(key);
  inflight.delete(key);
}

export function forgetPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

export function forgetKeysMatching(predicate: (key: string) => boolean): void {
  for (const key of store.keys()) {
    if (predicate(key)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (predicate(key)) inflight.delete(key);
  }
}

/** Drops the signed-in shell after a workspace switch or a role change. */
export function forgetUserNavigation(userId: string): void {
  forgetPrefix(`chrome:${userId}:`);
  forget(`tenant-access:${userId}`);
  forgetPrefix(`shell:${userId}:`);
}

/** Test-only: wipe process cache between cases. */
export function resetTtlCacheForTests(): void {
  store.clear();
  inflight.clear();
}

export function ttlCacheSizeForTests(): { store: number; inflight: number } {
  return { store: store.size, inflight: inflight.size };
}
