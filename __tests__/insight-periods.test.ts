import { describe, expect, it } from "vitest";
import { insightPeriods, matchPeriod, previousWindow } from "@/lib/insight-periods";
import { describeChanges, mergeThemes } from "@/lib/insight-changes";

const now = new Date("2026-11-02T10:00:00Z");

describe("insightPeriods", () => {
  it("aligns to calendar months", () => {
    const byKey = Object.fromEntries(insightPeriods(now).map((p) => [p.key, p]));
    expect(byKey.this_month).toMatchObject({ from: "2026-11-01", to: "2026-11-02" });
    expect(byKey.last_month).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(byKey.last_3).toMatchObject({ from: "2026-08-01", to: "2026-10-31" });
    expect(byKey.ytd).toMatchObject({ from: "2026-01-01" });
  });
  it("crosses the year boundary", () => {
    const jan = new Date("2027-01-15T00:00:00Z");
    const byKey = Object.fromEntries(insightPeriods(jan).map((p) => [p.key, p]));
    expect(byKey.last_month).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(byKey.last_3).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
  });
  it("matches a custom range back to its period", () => {
    expect(matchPeriod({ key: "custom", from: "2026-10-01", to: "2026-10-31" }, now)?.key).toBe("last_month");
    expect(matchPeriod({ key: "3m", from: "", to: "" }, now)).toBeNull();
  });
  it("finds the previous window of equal length", () => {
    const prev = previousWindow(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"), now);
    expect(prev.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(prev.start.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("theme changes", () => {
  const current = {
    positive: [{ topic: "advice_quality", count: 9, reviews: 8 }],
    negative: [{ topic: "turnaround", count: 6, reviews: 5 }, { topic: "billing", count: 1, reviews: 1 }],
  };
  const previous = {
    positive: [{ topic: "advice_quality", count: 4, reviews: 4 }],
    negative: [{ topic: "turnaround", count: 2, reviews: 2 }, { topic: "billing", count: 0, reviews: 0 }],
  };
  it("merges praise and complaints per theme", () => {
    const rows = mergeThemes(current, previous);
    expect(rows[0]).toMatchObject({ topic: "advice_quality", praise: 9, complaints: 0, praisePrev: 4 });
    expect(rows.find((r) => r.topic === "turnaround")).toMatchObject({ complaints: 6, complaintsPrev: 2 });
  });
  it("reports only meaningful moves, biggest first", () => {
    const changes = describeChanges(mergeThemes(current, previous));
    expect(changes[0]).toEqual({ tone: "good", text: "Praise for Advice Quality rose from 4 mentions to 9." });
    expect(changes[1]).toEqual({ tone: "bad", text: "Complaints about Turnaround rose from 2 mentions to 6." });
    expect(changes.some((c) => c.text.includes("Billing"))).toBe(false);
  });
  it("says nothing without a previous period", () => {
    expect(describeChanges(mergeThemes(current, null))).toEqual([]);
  });
});

import { formatSpan } from "@/lib/duration";

describe("formatSpan", () => {
  const h = 3_600_000;
  it("reads like a person would say it", () => {
    expect(formatSpan(20 * 60_000)).toBe("20m");
    expect(formatSpan(5 * h + 10 * 60_000)).toBe("5h 10m");
    expect(formatSpan(-18774 * h - 3 * 60_000)).toBe("2.1 years");
    expect(formatSpan(10 * 24 * h)).toBe("10 days");
    expect(formatSpan(120 * 24 * h)).toBe("4 months");
  });
});
