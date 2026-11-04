import { describe, expect, it } from "vitest";
import { forget, forgetPrefix, peek, remember } from "@/lib/ttl-cache";

describe("cache invalidation during a read", () => {
  it("starts a fresh read after a write and prevents the old read from repopulating the cache", async () => {
    let resolveOld!: (value: string) => void;
    const old = remember("invalidate-race:row", 60_000, () => new Promise<string>((resolve) => { resolveOld = resolve; }));
    forgetPrefix("invalidate-race:");
    expect(await remember("invalidate-race:row", 60_000, async () => "published")).toBe("published");
    resolveOld("draft");
    expect(await old).toBe("draft");
    expect(peek("invalidate-race:row")).toBe("published");
    forget("invalidate-race:row");
  });

  it("does not let a failed old request discard a newer in-flight read", async () => {
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (value: string) => void;
    const old = remember("failed-race", 60_000, () => new Promise<string>((_, reject) => { rejectOld = reject; }));
    const caught = old.catch(() => "failed");
    forget("failed-race");
    const fresh = remember("failed-race", 60_000, () => new Promise<string>((resolve) => { resolveNew = resolve; }));
    rejectOld(new Error("Old request failed"));
    await caught;
    const shared = remember("failed-race", 60_000, async () => "unexpected duplicate load");
    resolveNew("published");
    expect(await fresh).toBe("published");
    expect(await shared).toBe("published");
    forget("failed-race");
  });
});
