import { describe, expect, it } from "vitest";
import { DATE_RANGE_OPTIONS, dateRangeParams, parseDateRange, parseFocusWindow, previousDateRange } from "@/lib/date-range";
import { scopeFilterApply, timeFilterApply } from "@/lib/filter-apply";

const now = new Date("2026-10-08T12:00:00Z");

describe("parseDateRange", () => {
  it("falls back to the page default when nothing is set", () => {
    expect(parseDateRange({}, "6m", now)).toMatchObject({ key: "6m", label: "Last 6 months" });
    expect(parseDateRange({ range: "bogus" }, "all", now)).toMatchObject({
      key: "all",
      start: null,
      end: null,
    });
  });

  it("rolls presets back from now", () => {
    const range = parseDateRange({ range: "3m" }, "all", now);
    expect(range.start?.toISOString()).toBe("2026-07-08T12:00:00.000Z");
    expect(range.end).toBeNull();
  });

  it("treats custom dates as whole UTC days with an exclusive end", () => {
    const range = parseDateRange({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, "all", now);
    expect(range.start?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(range.label).toBe("1 Jan 2026 – 31 Mar 2026");
  });

  it("reads bare from/to as custom, swaps reversed dates, and ignores bad ones", () => {
    expect(parseDateRange({ from: "2026-05-01" }, "all", now)).toMatchObject({
      key: "custom",
      from: "2026-05-01",
      end: null,
    });
    expect(parseDateRange({ range: "custom", from: "2026-03-01", to: "2026-01-01" }, "all", now))
      .toMatchObject({ from: "2026-01-01", to: "2026-03-01" });
    expect(parseDateRange({ range: "custom", from: "nope" }, "1m", now).key).toBe("1m");
  });
});

describe("previousDateRange", () => {
  it("returns the same-length window just before", () => {
    const preset = previousDateRange(parseDateRange({ range: "6m" }, "all", now), now);
    expect(preset?.start.toISOString()).toBe("2025-10-08T12:00:00.000Z");
    expect(preset?.end.toISOString()).toBe("2026-04-08T12:00:00.000Z");

    const custom = previousDateRange(
      parseDateRange({ range: "custom", from: "2026-03-01", to: "2026-03-10" }, "all", now),
      now
    );
    expect(custom?.start.toISOString()).toBe("2026-02-19T00:00:00.000Z");
    expect(custom?.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("has nothing before all time", () => {
    expect(previousDateRange(parseDateRange({}, "all", now), now)).toBeNull();
  });
});

describe("parseFocusWindow", () => {
  it("opens one slice without becoming the navbar period", () => {
    const focus = parseFocusWindow({ focusFrom: "2026-09-01", focusTo: "2026-09-30" });
    expect(focus?.key).toBe("custom");
    expect(focus?.from).toBe("2026-09-01");
    expect(parseFocusWindow({})).toBeNull();
    expect(parseDateRange({ range: "all" }, "12m", now).key).toBe("all");
  });
});

describe("dateRangeParams", () => {
  it("omits the page default and keeps custom dates", () => {
    expect(dateRangeParams(parseDateRange({}, "6m", now), "6m")).toEqual({});
    expect(dateRangeParams(parseDateRange({ range: "12m" }, "6m", now), "6m")).toEqual({ range: "12m" });
    expect(
      dateRangeParams(parseDateRange({ range: "custom", from: "2026-01-01" }, "all", now), "all")
    ).toEqual({ range: "custom", from: "2026-01-01" });
  });
});

describe("filter apply copy", () => {
  it("names the period that is loading", () => {
    expect(timeFilterApply({ range: "6m", from: null, to: null }, "12m")).toEqual({
      title: "Applying Last 6 months",
      detail: "Loading Last 6 months. The numbers on this page stay on the previous period until this filter finishes.",
    });
    expect(timeFilterApply({ range: null, from: null, to: null }, "12m").title).toBe("Applying Last 12 months");
    expect(timeFilterApply({ range: "custom", from: "2026-04-21", to: "2026-10-21" }, "12m").title).toBe(
      "Applying custom dates"
    );
  });

  it("names the organisation, group, or outlet that is loading", () => {
    expect(scopeFilterApply({ kind: "Outlet", label: "Fazyo Alappuzha" })).toEqual({
      title: "Applying Fazyo Alappuzha",
      detail:
        "The outlet filter is loading. The numbers on this page stay on the previous selection until this filter finishes.",
    });
  });
});

describe("day range presets", () => {
  const now = new Date("2026-11-03T10:00:00Z");

  it("offers short and long reporting periods together", () => {
    expect(DATE_RANGE_OPTIONS.map((option) => option.key)).toEqual(expect.arrayContaining(["today", "7d", "30d", "3m", "6m", "12m", "all", "custom"]));
  });

  it("starts Today at local midnight, including day boundaries and DST", () => {
    const early = new Date("2026-11-03T01:00:00Z");
    expect(parseDateRange({ range: "today" }, "all", early, "Asia/Kolkata")).toMatchObject({
      key: "today", label: "Today", start: new Date("2026-11-02T18:30:00Z"), end: null,
    });
    expect(parseDateRange({ range: "today" }, "all", early, "America/New_York").start).toEqual(new Date("2026-11-02T05:00:00Z"));
    expect(parseDateRange({ range: "today" }, "all", new Date("2026-11-01T18:00:00Z"), "America/New_York").start).toEqual(new Date("2026-11-01T04:00:00Z"));
    expect(parseDateRange({ range: "today" }, "all", new Date("2026-03-08T18:00:00Z"), "America/New_York").start).toEqual(new Date("2026-03-08T05:00:00Z"));
    expect(dateRangeParams(parseDateRange({ range: "today" }, "all", early), "3m")).toEqual({ range: "today" });
  });

  it("parses 7d, 30d and 90d as rolling windows", () => {
    const range = parseDateRange({ range: "30d" }, "all", now);
    expect(range.key).toBe("30d");
    expect(range.label).toBe("Last 30 days");
    expect(range.start?.toISOString()).toBe("2026-10-04T10:00:00.000Z");
    expect(range.end).toBeNull();
    expect(parseDateRange({ range: "7d" }, "all", now).start?.toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });

  it("compares with the same number of days before", () => {
    const range = parseDateRange({ range: "7d" }, "all", now);
    expect(previousDateRange(range, now)).toEqual({
      start: new Date("2026-10-20T10:00:00Z"),
      end: new Date("2026-10-27T10:00:00Z"),
    });
  });

  it("writes the key back to the URL", () => {
    expect(dateRangeParams(parseDateRange({ range: "90d" }, "all", now), "30d")).toEqual({ range: "90d" });
    expect(dateRangeParams(parseDateRange({ range: "30d" }, "all", now), "30d")).toEqual({});
  });
});
