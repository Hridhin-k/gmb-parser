import { afterEach, describe, expect, it } from "vitest";
import {
  dashboardContextCacheKey,
  forgetWorkspaceDashboardCaches,
  locationWindowCacheKey,
} from "@/lib/services/dashboard-cache";
import { peek, put, remember, resetTtlCacheForTests } from "@/lib/ttl-cache";

afterEach(() => {
  resetTtlCacheForTests();
});

describe("dashboard cache keys", () => {
  it("keeps tenants, scopes and date ranges distinct", () => {
    const base = {
      clientId: null as string | null,
      groupId: null as string | null,
      locationId: null as string | null,
    };
    const a = dashboardContextCacheKey("ws-a", base, { start: null, end: null });
    const b = dashboardContextCacheKey("ws-b", base, { start: null, end: null });
    const group = dashboardContextCacheKey("ws-a", { ...base, groupId: "g1" }, { start: null, end: null });
    const loc = dashboardContextCacheKey("ws-a", { ...base, locationId: "l1" }, { start: null, end: null });
    const month = dashboardContextCacheKey("ws-a", base, {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-02-01T00:00:00.000Z",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(group);
    expect(a).not.toBe(loc);
    expect(a).not.toBe(month);
    expect(a).toContain("dashctx:ws-a:");
  });

  it("day-bounds rolling ISO starts so preset TTL keys do not churn every ms", () => {
    const base = {
      clientId: null as string | null,
      groupId: null as string | null,
      locationId: null as string | null,
    };
    const a = dashboardContextCacheKey("ws-a", base, {
      start: "2026-09-27T12:00:00.001Z",
      end: null,
    });
    const b = dashboardContextCacheKey("ws-a", base, {
      start: "2026-09-27T12:00:00.999Z",
      end: null,
    });
    const nextDay = dashboardContextCacheKey("ws-a", base, {
      start: "2026-09-28T00:00:00.000Z",
      end: null,
    });
    expect(a).toBe(b);
    expect(a).toContain("2026-09-27");
    expect(a).not.toBe(nextDay);
  });

  it("normalizes location id order for slice/insights keys", () => {
    const left = locationWindowCacheKey("slice", "ws", ["b", "a"], null, null);
    const right = locationWindowCacheKey("slice", "ws", ["a", "b"], null, null);
    expect(left).toBe(right);
    expect(locationWindowCacheKey("insights", "ws", ["a"], "s", "e")).not.toBe(
      locationWindowCacheKey("slice", "ws", ["a"], "s", "e")
    );
    expect(
      locationWindowCacheKey("signals", "ws", ["a"], "2026-01-01T12:00:00.000Z", null)
    ).toBe(locationWindowCacheKey("signals", "ws", ["a"], "2026-01-01T18:00:00.000Z", null));
  });
});

describe("forgetWorkspaceDashboardCaches", () => {
  it("invalidates only the affected workspace prefixes", async () => {
    await remember("dashctx:ws-a:org:::", 10_000, async () => ({ reviews: 1 }));
    await remember("dashctx:ws-b:org:::", 10_000, async () => ({ reviews: 2 }));
    await remember("slice:ws-a:::loc", 10_000, async () => ({ reviews: 3 }));
    await remember("insights:ws-a:::loc", 10_000, async () => ({ reviews: 4 }));
    await remember("signals:ws-a:::loc:2026-10-27", 10_000, async () => ({ ok: true }));
    await remember("onboard-gate:ws-a", 10_000, async () => ({ completed: true }));
    await remember("inbox:ws-a:{}", 10_000, async () => ({ rows: [] }));
    await remember("review-count:ws-a::::", 10_000, async () => 9);
    put("catalog:ws-a", { ok: true }, 10_000);
    put("catalog:ws-b", { ok: true }, 10_000);
    put("shell:user-1:ws-a:clients:locs", { n: 1 }, 10_000);
    put("shell:user-1:ws-b:clients:locs", { n: 2 }, 10_000);
    put("chrome:user-1:ws-a", { chrome: true }, 10_000);
    put("roster:ws-a", { members: [] }, 10_000);

    forgetWorkspaceDashboardCaches("ws-a");

    expect(peek("dashctx:ws-a:org:::")).toBeUndefined();
    expect(peek("slice:ws-a:::loc")).toBeUndefined();
    expect(peek("insights:ws-a:::loc")).toBeUndefined();
    expect(peek("signals:ws-a:::loc:2026-10-27")).toBeUndefined();
    expect(peek("onboard-gate:ws-a")).toBeUndefined();
    expect(peek("inbox:ws-a:{}")).toBeUndefined();
    expect(peek("review-count:ws-a::::")).toBeUndefined();
    expect(peek("catalog:ws-a")).toBeUndefined();
    expect(peek("shell:user-1:ws-a:clients:locs")).toBeUndefined();

    expect(peek("dashctx:ws-b:org:::")).toEqual({ reviews: 2 });
    expect(peek("catalog:ws-b")).toEqual({ ok: true });
    expect(peek("shell:user-1:ws-b:clients:locs")).toEqual({ n: 2 });
    // Membership chrome/roster are not review-derived; left for their own paths.
    expect(peek("chrome:user-1:ws-a")).toEqual({ chrome: true });
    expect(peek("roster:ws-a")).toEqual({ members: [] });
  });

  it("does nothing for an empty workspace id", () => {
    put("dashctx:ws-a:x", 1, 10_000);
    forgetWorkspaceDashboardCaches("");
    expect(peek("dashctx:ws-a:x")).toBe(1);
  });
});
