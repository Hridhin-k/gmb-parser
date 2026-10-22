/**
 * Runs `fn` over `items` with at most `concurrency` promises in flight.
 * Results keep input order; a rejected item does not stop the others —
 * the rejection is captured as `{ ok: false, error }` at its position.
 */
export type PoolResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<PoolResult<R>>> {
  const results = new Array<PoolResult<R>>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
