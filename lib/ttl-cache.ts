interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function sweep(now: number): void {
  if (store.size < 200) return;
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
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
  sweep(now);
}

/** Shares one load across overlapping callers and keeps the result for `ttlMs`. */
export function remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load()
    .then((value) => {
      put(key, value, ttlMs);
      inflight.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, promise);
  return promise;
}

export function forget(key: string): void {
  store.delete(key);
}

export function forgetPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Drops the signed-in shell after a workspace switch or a role change. */
export function forgetUserNavigation(userId: string): void {
  forgetPrefix(`chrome:${userId}:`);
  forget(`tenant-access:${userId}`);
  forgetPrefix(`shell:${userId}:`);
}
