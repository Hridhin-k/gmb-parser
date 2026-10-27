import { afterEach, describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import {
  cacheDayBound,
  dashboardContextCacheKey,
  forgetWorkspaceDashboardCaches,
  locationWindowCacheKey,
} from "@/lib/services/dashboard-cache";
import { peek, remember, resetTtlCacheForTests } from "@/lib/ttl-cache";

afterEach(() => {
  resetTtlCacheForTests();
});

const org = { clientId: null as string | null, groupId: null as string | null, locationId: null as string | null };

function dashKey(workspaceId: string, range: { start: string | null; end: string | null }, scope = org) {
  return dashboardContextCacheKey(workspaceId, scope, range);
}

describe("Phase 6 cache-key correctness", () => {
  it("shares one key for the same rolling preset within a UTC day", () => {
    const morning = parseDateRange({ range: "1m" }, "all", new Date("2026-10-27T08:00:00.123Z"));
    const evening = parseDateRange({ range: "1m" }, "all", new Date("2026-10-27T20:59:59.999Z"));
    expect(dashKey("ws", { start: morning.start!.toISOString(), end: null })).toBe(
      dashKey("ws", { start: evening.start!.toISOString(), end: null })
    );
  });

  it("uses different keys on opposite sides of UTC midnight for rolling presets", () => {
    const before = parseDateRange({ range: "1m" }, "all", new Date("2026-10-27T23:59:59.000Z"));
    const after = parseDateRange({ range: "1m" }, "all", new Date("2026-10-28T00:00:01.000Z"));
    expect(dashKey("ws", { start: before.start!.toISOString(), end: null })).not.toBe(
      dashKey("ws", { start: after.start!.toISOString(), end: null })
    );
  });

  it("keeps custom ranges day-stable and distinct from presets", () => {
    const custom = parseDateRange(
      { range: "custom", from: "2026-01-01", to: "2026-03-31" },
      "all",
      new Date("2026-10-27T12:00:00Z")
    );
    const preset = parseDateRange({ range: "3m" }, "all", new Date("2026-10-27T12:00:00Z"));
    const customKey = dashKey("ws", {
      start: custom.start!.toISOString(),
      end: custom.end!.toISOString(),
    });
    const presetKey = dashKey("ws", { start: preset.start!.toISOString(), end: null });
    expect(customKey).toContain("2026-01-01");
    expect(customKey).toContain("2026-04-01");
    expect(customKey).not.toBe(presetKey);
    // Re-parsing the same custom days yields the same key.
    const again = parseDateRange(
      { range: "custom", from: "2026-01-01", to: "2026-03-31" },
      "all",
      new Date("2026-10-28T01:00:00Z")
    );
    expect(
      dashKey("ws", { start: again.start!.toISOString(), end: again.end!.toISOString() })
    ).toBe(customKey);
  });

  it("uses a stable all-time key", () => {
    const a = parseDateRange({ range: "all" }, "all");
    const b = parseDateRange({}, "all");
    expect(dashKey("ws", { start: a.start?.toISOString() ?? null, end: a.end?.toISOString() ?? null })).toBe(
      dashKey("ws", { start: b.start?.toISOString() ?? null, end: b.end?.toISOString() ?? null })
    );
    expect(dashKey("ws", { start: null, end: null })).toBe("dashctx:ws:::::");
  });

  it("separates workspaces, clients, groups, and locations", () => {
    const range = { start: "2026-09-27T12:00:00.000Z", end: null };
    expect(dashKey("ws-a", range)).not.toBe(dashKey("ws-b", range));
    expect(dashKey("ws-a", range, { ...org, clientId: "c1" })).not.toBe(dashKey("ws-a", range));
    expect(dashKey("ws-a", range, { ...org, groupId: "g1" })).not.toBe(
      dashKey("ws-a", range, { ...org, clientId: "c1" })
    );
    expect(dashKey("ws-a", range, { ...org, locationId: "l1" })).not.toBe(
      dashKey("ws-a", range, { ...org, groupId: "g1" })
    );
  });

  it("treats empty scope ids like org scope in the key (resolution happens before cache)", () => {
    const range = { start: "2026-09-27T12:00:00.000Z", end: null };
    expect(dashKey("ws", range, { clientId: "", groupId: "", locationId: "" })).toBe(
      dashKey("ws", range, org)
    );
  });

  it("day-bounds location-window keys without changing distinct prefixes", () => {
    expect(cacheDayBound("2026-10-27T15:22:33.444Z")).toBe("2026-10-27");
    expect(cacheDayBound(null)).toBeNull();
    expect(locationWindowCacheKey("insights", "ws", ["l2", "l1"], "2026-10-27T01:00:00.000Z", null)).toBe(
      locationWindowCacheKey("insights", "ws", ["l1", "l2"], "2026-10-27T23:00:00.000Z", null)
    );
    expect(locationWindowCacheKey("slice", "ws", ["l1"], "2026-10-27T01:00:00.000Z", null)).not.toBe(
      locationWindowCacheKey("insights", "ws", ["l1"], "2026-10-27T01:00:00.000Z", null)
    );
  });

  it("invalidation after a data change clears only that workspace and allows a fresh load", async () => {
    const keyA = dashKey("ws-a", { start: "2026-09-27T12:00:00.001Z", end: null });
    const keyB = dashKey("ws-b", { start: "2026-09-27T12:00:00.001Z", end: null });
    await remember(keyA, 45_000, async () => ({ reviews: 1 }));
    await remember(keyB, 45_000, async () => ({ reviews: 9 }));
    expect(peek(keyA)).toEqual({ reviews: 1 });

    forgetWorkspaceDashboardCaches("ws-a");
    expect(peek(keyA)).toBeUndefined();
    expect(peek(keyB)).toEqual({ reviews: 9 });

    await remember(keyA, 45_000, async () => ({ reviews: 2 }));
    expect(peek(keyA)).toEqual({ reviews: 2 });
  });

  it("a stale in-flight load after workspace forget cannot repopulate the cache", async () => {
    const key = dashKey("ws-a", { start: "2026-09-27T12:00:00.000Z", end: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = remember(key, 45_000, async () => {
      await gate;
      return { reviews: "stale" };
    });
    forgetWorkspaceDashboardCaches("ws-a");
    const fresh = remember(key, 45_000, async () => ({ reviews: "fresh" }));
    release();
    await expect(slow).resolves.toEqual({ reviews: "stale" });
    await expect(fresh).resolves.toEqual({ reviews: "fresh" });
    expect(peek(key)).toEqual({ reviews: "fresh" });
  });
});
