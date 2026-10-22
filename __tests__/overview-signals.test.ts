import { describe, expect, it } from "vitest";
import { signalsFromRpc } from "@/lib/overview-signals";

const NOW = new Date("2026-10-22T12:00:00.000Z");

describe("signalsFromRpc", () => {
  it("maps themes, the recent outlet (at the >=3 threshold) and the oldest overdue case", () => {
    const s = signalsFromRpc(
      {
        themes: [{ locationId: "loc-1", theme: "staff", count: 5 }],
        recentTop: { locationId: "loc-1", count: 3 },
        oldestOverdue: { id: "esc-1", dueAt: "2026-10-20T00:00:00.000Z", locationId: "loc-2" },
      },
      { since48: "2026-10-20T12:00:00.000Z", now: NOW }
    );
    expect(s.themes).toEqual([{ locationId: "loc-1", theme: "staff", count: 5 }]);
    expect(s.themesTruncated).toBe(false);
    expect(s.recentNegative).toEqual({
      locationId: "loc-1",
      count: 3,
      fromDay: "2026-10-20",
      toDay: "2026-10-22",
    });
    expect(s.oldestOverdue?.id).toBe("esc-1");
  });

  it("hides the recent outlet below 3 reviews and handles a missing payload", () => {
    const s = signalsFromRpc(
      { themes: [], recentTop: { locationId: "loc-1", count: 2 }, oldestOverdue: null },
      { since48: "2026-10-20T12:00:00.000Z", now: NOW }
    );
    expect(s.recentNegative).toBeNull();
    expect(signalsFromRpc(null, { since48: "2026-10-20T12:00:00.000Z", now: NOW }).themes).toEqual([]);
  });
});
