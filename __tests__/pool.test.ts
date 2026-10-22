import { describe, expect, it } from "vitest";
import { mapPool } from "@/lib/pool";

describe("mapPool", () => {
  it("preserves input order regardless of completion order", async () => {
    const results = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([60, 20, 40]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("captures a rejection at its position and keeps going", async () => {
    const results = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 30 });
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 4, async (n: number) => n)).toEqual([]);
  });
});
