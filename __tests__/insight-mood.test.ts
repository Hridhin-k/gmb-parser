import { describe, expect, it } from "vitest";
import {
  buildMoodSeries,
  buildTopicTrends,
  chartMonths,
  divergingRows,
  happyShare,
  heatScore,
  heatStep,
  locationHeatmap,
  monthBounds,
  monthDrivers,
  shiftMonth,
  signedPoints,
  trendStatus,
} from "@/lib/insight-mood";
import { spotMonthlyChanges } from "@/lib/insight-changes";
import { cleanNoteBody, isNoteMonth } from "@/lib/services/insight-notes";

const NOW = new Date("2026-11-03T10:00:00Z");

describe("chartMonths", () => {
  it("shows twelve whole months for a rolling year, ending with this month", () => {
    const months = chartMonths(new Date("2025-11-03T10:00:00Z"), null, NOW);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-12");
    expect(months.at(-1)).toBe("2026-11");
  });

  it("keeps a partial first month when the range is short", () => {
    expect(chartMonths(new Date("2026-10-03T10:00:00Z"), null, NOW)).toEqual(["2026-10", "2026-11"]);
  });

  it("treats a custom end as exclusive", () => {
    expect(chartMonths(new Date("2026-01-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"), NOW)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("covers the last two years for all time", () => {
    const months = chartMonths(null, null, NOW);
    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-12");
  });
});

describe("month helpers", () => {
  it("shifts across years and gives whole-month bounds", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 13)).toBe("2027-01");
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("signs points with a real minus", () => {
    expect(signedPoints(4)).toBe("+4");
    expect(signedPoints(-3)).toBe("−3");
    expect(signedPoints(0)).toBe("±0");
  });
});

describe("happyShare", () => {
  it("is the rounded share of praise", () => {
    expect(happyShare(3, 1)).toBe(75);
    expect(happyShare(1, 2)).toBe(33);
  });

  it("is null when there are too few mentions", () => {
    expect(happyShare(1, 1)).toBeNull();
    expect(happyShare(0, 0, 0)).toBeNull();
  });
});

describe("buildMoodSeries", () => {
  it("aligns counts, ratings and the same month a year earlier", () => {
    const series = buildMoodSeries(
      ["2026-01", "2026-02"],
      [
        { month: "2025-01", positive: 6, negative: 4 },
        { month: "2026-01", positive: 8, negative: 2 },
        { month: "2026-02", positive: 1, negative: 0 },
      ],
      [{ month: "2026-01", reviews: 12, rating: 4.4 }]
    );
    expect(series[0]).toMatchObject({
      month: "2026-01",
      label: "Jan",
      fullLabel: "January 2026",
      happy: 80,
      lastYear: 60,
      reviews: 12,
      rating: 4.4,
      from: "2026-01-01",
      to: "2026-01-31",
    });
    // One mention is not enough to call a month.
    expect(series[1]).toMatchObject({ happy: null, lastYear: null, reviews: 0, rating: null });
  });
});

describe("buildTopicTrends", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rows = [
    ...months.map((month, i) => ({ topic: "wait_time", month, positive: 6 - i, negative: 1 + i })),
    ...months.map((month) => ({ topic: "staff", month, positive: 9, negative: 1 })),
    { topic: "parking", month: "2026-01", positive: 1, negative: 1 },
  ];

  it("labels getting worse, steady, and drops rare topics", () => {
    const trends = buildTopicTrends(months, rows);
    expect(trends.map((t) => t.topic)).toEqual(["wait_time", "staff"]);
    const wait = trends[0];
    expect(wait.label).toBe("Wait Time");
    expect(wait.status).toBe("worse");
    expect(wait.delta).toBeLessThan(0);
    expect(wait.series).toHaveLength(6);
    expect(wait.now).toBe(14);
    expect(trends[1]).toMatchObject({ status: "steady", delta: 0, now: 90 });
  });

  it("classifies changes by the threshold", () => {
    expect(trendStatus(-6)).toBe("worse");
    expect(trendStatus(5)).toBe("steady");
    expect(trendStatus(6)).toBe("better");
    expect(trendStatus(null)).toBe("steady");
  });
});

describe("monthDrivers", () => {
  it("names the topics that moved most against the month before", () => {
    const months = ["2026-09", "2026-10"];
    const rows = [
      { topic: "wait_time", month: "2026-09", positive: 5, negative: 5 },
      { topic: "wait_time", month: "2026-10", positive: 2, negative: 8 },
      { topic: "staff", month: "2026-09", positive: 8, negative: 2 },
      { topic: "staff", month: "2026-10", positive: 9, negative: 1 },
      { topic: "new_only", month: "2026-10", positive: 0, negative: 9 },
    ];
    const drivers = monthDrivers(months, rows, 1);
    expect(drivers.map((d) => d.topic)).toEqual(["wait_time", "staff"]);
    expect(drivers[0]).toMatchObject({ direction: "down", points: -30, text: "complaints up from 5 to 8" });
    expect(drivers[1]).toMatchObject({ direction: "up", text: "complaints down from 2 to 1" });
    expect(monthDrivers(months, rows, 0)).toEqual([]);
  });
});

describe("spotMonthlyChanges", () => {
  it("pins months where complaints doubled or more", () => {
    const months = ["2026-08", "2026-09", "2026-10"];
    const rows = [
      { topic: "wait_time", month: "2026-08", positive: 4, negative: 2 },
      { topic: "wait_time", month: "2026-09", positive: 4, negative: 3 },
      { topic: "wait_time", month: "2026-10", positive: 3, negative: 9 },
      { topic: "booking", month: "2026-08", positive: 1, negative: 0 },
      { topic: "booking", month: "2026-09", positive: 6, negative: 0 },
    ];
    const changes = spotMonthlyChanges(months, rows);
    expect(changes).toEqual([
      { month: "2026-09", topic: "booking", tone: "good", text: "Praise for Booking rose from 1 to 6" },
      { month: "2026-10", topic: "wait_time", tone: "bad", text: "Complaints about Wait Time tripled (3 to 9)" },
    ]);
  });

  it("ignores small wobbles", () => {
    const rows = [
      { topic: "price", month: "2026-01", positive: 0, negative: 1 },
      { topic: "price", month: "2026-02", positive: 0, negative: 3 },
    ];
    expect(spotMonthlyChanges(["2026-01", "2026-02"], rows)).toEqual([]);
  });

  it("does not call the first month with readings a jump", () => {
    const rows = [{ topic: "staff", month: "2026-05", positive: 6, negative: 0 }];
    expect(spotMonthlyChanges(["2026-04", "2026-05"], rows)).toEqual([]);
  });
});

describe("Topics and Locations tabs", () => {
  it("scales diverging bars to the widest side", () => {
    const rows = divergingRows([
      { topic: "staff", label: "Staff", praise: 40, complaints: 4 },
      { topic: "wait", label: "Wait", praise: 2, complaints: 20 },
      { topic: "none", label: "None", praise: 0, complaints: 0 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ praiseWidth: 100, complaintWidth: 10 });
    expect(rows[1]).toMatchObject({ praiseWidth: 5, complaintWidth: 50 });
  });

  it("scores heatmap cells on a five-step scale", () => {
    expect(heatScore(9, 1)).toBe(80);
    expect(heatScore(1, 1)).toBeNull();
    expect([-80, -30, 0, 30, 80].map(heatStep)).toEqual([-2, -1, 0, 1, 2]);
    expect(heatStep(null)).toBeNull();
  });

  it("builds locations × topics, busiest first", () => {
    const map = locationHeatmap([
      { locationId: "a", topic: "staff", positive: 9, negative: 1 },
      { locationId: "a", topic: "wait", positive: 1, negative: 1 },
      { locationId: "b", topic: "wait", positive: 1, negative: 20 },
    ]);
    expect(map.topics.map((t) => t.topic)).toEqual(["wait", "staff"]);
    expect(map.rows.map((r) => r.locationId)).toEqual(["b", "a"]);
    expect(map.rows[0].cells).toEqual([
      { topic: "wait", score: -90, step: -2, mentions: 21 },
      { topic: "staff", score: null, step: null, mentions: 0 },
    ]);
    expect(map.rows[1].cells[0]).toMatchObject({ score: null, mentions: 2 });
  });
});

describe("note input", () => {
  it("accepts a month and a short note", () => {
    expect(isNoteMonth("2026-04")).toBe(true);
    expect(isNoteMonth("2026-13")).toBe(false);
    expect(isNoteMonth("2026-4")).toBe(false);
    expect(cleanNoteBody("  Online   booking launched ")).toBe("Online booking launched");
    expect(cleanNoteBody("   ")).toBeNull();
    expect(cleanNoteBody("x".repeat(281))).toBeNull();
  });
});
