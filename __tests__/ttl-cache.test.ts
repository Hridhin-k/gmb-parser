import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forget,
  forgetPrefix,
  peek,
  put,
  remember,
  resetTtlCacheForTests,
  ttlCacheSizeForTests,
  TTL_CACHE_MAX_ENTRIES,
} from "@/lib/ttl-cache";

afterEach(() => {
  resetTtlCacheForTests();
  vi.useRealTimers();
});

describe("remember", () => {
  it("returns a cache hit for the same key within the TTL", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { n: loads };
    };
    await expect(remember("k", 10_000, load)).resolves.toEqual({ n: 1 });
    await expect(remember("k", 10_000, load)).resolves.toEqual({ n: 1 });
    expect(loads).toBe(1);
  });

  it("does not share results across different keys", async () => {
    await remember("tenant-a", 10_000, async () => "A");
    await remember("tenant-b", 10_000, async () => "B");
    expect(peek("tenant-a")).toBe("A");
    expect(peek("tenant-b")).toBe("B");
  });

  it("coalesces concurrent misses into one load", async () => {
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      loads += 1;
      await gate;
      return "once";
    };
    const first = remember("same", 10_000, load);
    const second = remember("same", 10_000, load);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["once", "once"]);
    expect(loads).toBe(1);
  });

  it("allows retry after a rejected loader", async () => {
    let loads = 0;
    await expect(
      remember("retry", 10_000, async () => {
        loads += 1;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await expect(
      remember("retry", 10_000, async () => {
        loads += 1;
        return "ok";
      })
    ).resolves.toBe("ok");
    expect(loads).toBe(2);
  });

  it("refreshes after expiry", async () => {
    vi.useFakeTimers();
    let loads = 0;
    await remember("exp", 1_000, async () => {
      loads += 1;
      return loads;
    });
    vi.advanceTimersByTime(1_001);
    await expect(
      remember("exp", 1_000, async () => {
        loads += 1;
        return loads;
      })
    ).resolves.toBe(2);
    expect(loads).toBe(2);
  });

  it("does not serve expired peek values", () => {
    vi.useFakeTimers();
    put("gone", "x", 500);
    vi.advanceTimersByTime(501);
    expect(peek("gone")).toBeUndefined();
  });

  it("caches legitimate empty / zero results", async () => {
    await remember("empty", 10_000, async () => ({ reviews: 0 }));
    await expect(remember("empty", 10_000, async () => ({ reviews: 99 }))).resolves.toEqual({
      reviews: 0,
    });
  });

  it("forget clears store and in-flight so a new load can start", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loads = 0;
    const slow = remember("inflight", 10_000, async () => {
      loads += 1;
      await gate;
      return "stale";
    });
    forget("inflight");
    const fresh = remember("inflight", 10_000, async () => {
      loads += 1;
      return "fresh";
    });
    release();
    await expect(slow).resolves.toBe("stale");
    await expect(fresh).resolves.toBe("fresh");
    expect(peek("inflight")).toBe("fresh");
    expect(loads).toBe(2);
  });

  it("forgetPrefix clears matching keys only", async () => {
    await remember("dashctx:ws-a:x", 10_000, async () => "a");
    await remember("dashctx:ws-b:x", 10_000, async () => "b");
    forgetPrefix("dashctx:ws-a:");
    expect(peek("dashctx:ws-a:x")).toBeUndefined();
    expect(peek("dashctx:ws-b:x")).toBe("b");
  });

  it("bounds store growth", () => {
    for (let i = 0; i < TTL_CACHE_MAX_ENTRIES + 50; i += 1) {
      put(`k${i}`, i, 60_000);
    }
    expect(ttlCacheSizeForTests().store).toBeLessThanOrEqual(TTL_CACHE_MAX_ENTRIES);
  });
});
