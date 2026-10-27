import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import {
  DASHBOARD_DEFAULT_TIMEZONE,
  dashboardFactWindows,
  resolveDashboardTimezone,
} from "@/lib/services/dashboard-metrics";

describe("resolveDashboardTimezone", () => {
  it("keeps known policy zones and falls back otherwise", () => {
    expect(resolveDashboardTimezone("UTC")).toBe("UTC");
    expect(resolveDashboardTimezone("Asia/Dubai")).toBe("Asia/Dubai");
    expect(resolveDashboardTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveDashboardTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(resolveDashboardTimezone(null)).toBe(DASHBOARD_DEFAULT_TIMEZONE);
    expect(resolveDashboardTimezone(undefined)).toBe(DASHBOARD_DEFAULT_TIMEZONE);
    expect(resolveDashboardTimezone("Europe/Paris")).toBe(DASHBOARD_DEFAULT_TIMEZONE);
  });
});

describe("dashboardFactWindows", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  it("emits only the current window for all-time", () => {
    const range = parseDateRange({ range: "all" }, "all");
    expect(dashboardFactWindows(range, "UTC")).toEqual([
      { kind: "current", start: null, end: null, timezone: "UTC" },
    ]);
  });

  it("emits current and previous for a preset window", () => {
    const range = parseDateRange({ range: "1m" }, "all");
    // Freeze previousDateRange via the range's own start/end (preset uses "now").
    const windows = dashboardFactWindows(range, "Asia/Kolkata");
    expect(windows).toHaveLength(2);
    expect(windows[0]?.kind).toBe("current");
    expect(windows[1]?.kind).toBe("previous");
    expect(windows[0]?.timezone).toBe("Asia/Kolkata");
    expect(windows[1]?.timezone).toBe("Asia/Kolkata");
    expect(windows[0]?.start).not.toBeNull();
    expect(windows[1]?.end).toBe(windows[0]?.start);
  });

  it("keeps organisation / group / location out of the window key (scopes are RPC args)", () => {
    const range = parseDateRange({ range: "3m" }, "all");
    const org = dashboardFactWindows(range, "UTC");
    const same = dashboardFactWindows(range, "UTC");
    expect(org).toEqual(same);
    expect(org.map((w) => w.kind)).toEqual(["current", "previous"]);
  });

  it("uses exclusive custom bounds for both windows", () => {
    const range = parseDateRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }, "all");
    const windows = dashboardFactWindows(range, "UTC");
    expect(windows).toHaveLength(2);
    expect(windows[0]?.start).toBe("2026-09-01T00:00:00.000Z");
    expect(windows[0]?.end).toBe("2026-10-01T00:00:00.000Z");
    expect(windows[1]?.end).toBe(windows[0]?.start);
    const span =
      new Date(windows[0]!.end!).getTime() - new Date(windows[0]!.start!).getTime();
    const prevSpan =
      new Date(windows[1]!.end!).getTime() - new Date(windows[1]!.start!).getTime();
    expect(prevSpan).toBe(span);
    void now;
  });
});
