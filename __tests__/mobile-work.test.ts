import { describe, expect, it } from "vitest";
import { EMPTY_FACTS } from "@/lib/metrics";
import {
  countDeltaLabel,
  mobileDateRange,
  mobileHref,
  ratingDeltaLabel,
  skippedIds,
  slaRemaining,
  themeBars,
  weekBrief,
} from "@/lib/mobile-work";

describe("mobile work", () => {
  it("describes the due time without inventing a callback", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    expect(slaRemaining("2026-10-16T14:30:00.000Z", now)).toEqual({
      label: "2h 30m left",
      overdue: false,
    });
    expect(slaRemaining("2026-10-16T10:00:00.000Z", now).overdue).toBe(true);
    expect(slaRemaining("not-a-date").label).toBe("No due time is stored");
  });

  it("keeps the weekly summary to stored counts", () => {
    const brief = weekBrief({
      facts: { ...EMPTY_FACTS, reviews: 4, ratingSum: 16, replied: 2, oneToThree: 1 },
      previous: { ...EMPTY_FACTS, reviews: 2, ratingSum: 10 },
      replyTarget: null,
      scopeLabel: "all clients in this view",
    });
    expect(brief).toContain("Last 7 days");
    expect(brief).toContain("4 reviews");
    expect(brief).not.toMatch(/Kochi|billing/i);
    expect(brief).toContain("No reply target is saved.");
  });

  it("compares a period only when the previous one has reviews", () => {
    expect(countDeltaLabel(12, 10)).toBe("20% more than the previous period");
    expect(countDeltaLabel(12, 0)).toBeNull();
    expect(ratingDeltaLabel(4, 4.2)).toBe("0.20 lower than the previous period");
    expect(ratingDeltaLabel(4, null)).toBeNull();
  });

  it("ignores skip values that are not review ids", () => {
    expect(skippedIds("nope,11111111-1111-4111-8111-111111111111")).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(mobileHref("/m/approve", { client: null, skip: "abc" })).toBe("/m/approve?skip=abc");
  });

  it("uses a 7-day window and the desktop month for 30 days", () => {
    const now = new Date("2026-10-16T18:00:00.000Z");
    const week = mobileDateRange("7d", now);
    const start = week.start?.getTime();
    const end = week.end?.getTime();
    expect(start).toBeTypeOf("number");
    expect(end).toBeTypeOf("number");
    expect((end ?? 0) - (start ?? 0)).toBe(7 * 86_400_000);
    expect(mobileDateRange("30d", now).label).toBe("30 days");
  });

  it("ranks complaint themes from the period", () => {
    const bars = themeBars({
      ...EMPTY_FACTS,
      themeMonths: [
        { month: "2026-10", theme: "wait", count: 2 },
        { month: "2026-09", theme: "wait", count: 1 },
        { month: "2026-10", theme: "staff", count: 1 },
      ],
    });
    expect(bars[0]).toMatchObject({ id: "wait", label: "Wait time", count: 3, width: 100 });
    expect(bars[1]?.label).toBe("Staff");
  });
});
