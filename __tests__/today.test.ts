import { describe, expect, it } from "vitest";
import type { OverviewKpis } from "@/lib/overview-board";
import {
  buildDays,
  buildKpis,
  buildLocationTable,
  buildNeedsYou,
  buildThemes,
  dayKeyInZone,
  formatDuration,
  greeting,
  niceMax,
  sparkSeries,
  sparkShape,
  todayRange,
  type TodayLocationInput,
} from "@/lib/today";

const now = new Date("2026-11-03T04:30:00Z"); // 10:00 in Kolkata
const zone = "Asia/Kolkata";

describe("todayRange", () => {
  it("keeps 7, 30 and 90 days", () => {
    expect(todayRange({ range: "7d" }, now).key).toBe("7d");
    expect(todayRange({ range: "90d" }, now).key).toBe("90d");
  });

  it("defaults to 30 days and maps other periods to the nearest window", () => {
    expect(todayRange({}, now).key).toBe("30d");
    expect(todayRange({ range: "all" }, now).key).toBe("30d");
    expect(todayRange({ range: "1m" }, now).key).toBe("30d");
    expect(todayRange({ range: "3m" }, now).key).toBe("90d");
    expect(todayRange({ range: "12m" }, now).key).toBe("90d");
    expect(todayRange({ range: "custom", from: "2026-10-28", to: "2026-11-02" }, now).key).toBe("7d");
  });
});

describe("buildDays", () => {
  it("buckets by calendar day in the workspace timezone and flags 1–2 star days", () => {
    const days = buildDays(
      [
        // 22:00 UTC on 1 Nov is 03:30 on 2 Nov in Kolkata.
        { createdAt: "2026-11-01T22:00:00Z", stars: 5, replied: true, responseHours: 2 },
        { createdAt: "2026-11-02T08:00:00Z", stars: 2, replied: false, responseHours: null },
        { createdAt: "2026-11-03T01:00:00Z", stars: 4, replied: true, responseHours: 4 },
        // Before the first bar: counted on it so the bars add up.
        { createdAt: "2026-10-20T08:00:00Z", stars: 3, replied: false, responseHours: null },
      ],
      { days: 3, now, timeZone: zone }
    );
    expect(days.map((day) => day.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(days.map((day) => day.reviews)).toEqual([1, 2, 1]);
    expect(days.map((day) => day.low)).toEqual([0, 1, 0]);
    expect(days[1]!.ratingSum).toBe(7);
    expect(days[2]!.responseHoursSum).toBe(4);
  });

  it("reads the day in the given timezone", () => {
    expect(dayKeyInZone("2026-11-01T22:00:00Z", zone)).toBe("2026-11-02");
    expect(dayKeyInZone("2026-11-01T22:00:00Z", "UTC")).toBe("2026-11-01");
  });
});

describe("sparklines", () => {
  it("skips empty runs and needs two points", () => {
    expect(sparkShape([null, 4])).toBeNull();
    const shape = sparkShape([1, null, 3]);
    expect(shape?.points).toBe("0,36 112,4");
    expect(shape).toMatchObject({ endX: 112, endY: 4 });
  });

  it("uses up to eight runs, ending on today, with reviews as a daily average", () => {
    const days = buildDays(
      [
        { createdAt: "2026-11-03T01:00:00Z", stars: 5, replied: true, responseHours: 1 },
        { createdAt: "2026-11-02T01:00:00Z", stars: 3, replied: false, responseHours: null },
      ],
      { days: 30, now, timeZone: zone }
    );
    const sparks = sparkSeries(days);
    expect(sparks.reviews).toHaveLength(8);
    expect(sparks.reviews[7]).toBe(0.5);
    expect(sparks.rating[7]).toBe(4);
    expect(sparks.replyRate[7]).toBe(0.5);
    expect(sparks.rating.slice(0, 7).every((value) => value === null)).toBe(true);
  });
});

const kpis: OverviewKpis = {
  avgRating: 4.62,
  previousAvgRating: 4.5,
  reviews: 118,
  previousReviews: 100,
  negativeShare: 0.1,
  previousNegativeShare: 0.1,
  replyRate: 0.94,
  previousReplyRate: 0.92,
  avgResponseHours: 2.75,
  previousAvgResponseHours: 3,
  unreplied: 4,
  openEscalations: 1,
  overdueEscalations: 0,
};

describe("buildKpis", () => {
  it("formats values and deltas against the previous period", () => {
    const tiles = buildKpis(kpis, { rating: [], reviews: [], replyRate: [], replyHours: [] });
    expect(tiles.map((tile) => [tile.value, tile.delta, tile.tone])).toEqual([
      ["4.6", "+0.1", "good"],
      ["118", "+18%", "good"],
      ["94%", "+2 pts", "good"],
      ["2h 45m", "15 min faster", "good"],
    ]);
  });

  it("treats slower replies and lower ratings as bad, and says when there is nothing to compare", () => {
    const tiles = buildKpis(
      { ...kpis, avgRating: 4.2, avgResponseHours: 3.5, previousReplyRate: null },
      { rating: [], reviews: [], replyRate: [], replyHours: [] }
    );
    expect(tiles[0]).toMatchObject({ delta: "−0.3", tone: "bad", direction: "down" });
    expect(tiles[2]).toMatchObject({ delta: "No earlier period", tone: "flat" });
    expect(tiles[3]).toMatchObject({ delta: "30 min slower", tone: "bad", direction: "up" });
  });
});

describe("formatDuration", () => {
  it("reads as minutes, hours and minutes, or days", () => {
    expect(formatDuration(0.25)).toBe("15 min");
    expect(formatDuration(3)).toBe("3h");
    expect(formatDuration(2 + 50 / 60)).toBe("2h 50m");
    expect(formatDuration(72)).toBe("3.0 days");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("buildNeedsYou", () => {
  const hrefs = { unhappy: "/u", "follow-ups": "/f", drafts: "/d", failed: "/x" };

  it("counts what is waiting and says how old or due it is", () => {
    const tasks = buildNeedsYou(
      {
        unhappyUnreplied: 3,
        oldestUnhappyAt: "2026-11-01T04:00:00Z",
        followUps: 1,
        overdueFollowUps: 0,
        nextFollowUpDue: "2026-11-03T11:30:00Z",
        drafts: 6,
        failed: 0,
      },
      hrefs,
      now,
      zone
    );
    expect(tasks.map((task) => [task.id, task.count, task.hint, task.href])).toEqual([
      ["unhappy", 3, "Oldest 2 days", "/u"],
      ["follow-ups", 1, "Due 5 pm", "/f"],
      ["drafts", 6, "Ready to send", "/d"],
      ["failed", 0, "All published", "/x"],
    ]);
  });

  it("puts overdue follow-ups first in the hint", () => {
    const [, followUps] = buildNeedsYou(
      { unhappyUnreplied: 0, oldestUnhappyAt: null, followUps: 4, overdueFollowUps: 2, nextFollowUpDue: null, drafts: 0, failed: 0 },
      hrefs,
      now,
      zone
    );
    expect(followUps).toMatchObject({ label: "Call backs", hint: "2 past due" });
  });
});

function place(id: string, clientId: string, reviews: number, ratingSum: number, unreplied: number, previous?: [number, number]): TodayLocationInput {
  return {
    id,
    name: id,
    clientId,
    reviews,
    ratingSum,
    previousReviews: previous?.[0] ?? 0,
    previousRatingSum: previous?.[1] ?? 0,
    unreplied,
  };
}

describe("buildLocationTable", () => {
  const rows = [
    place("Riverside", "harbor", 10, 47, 4),
    place("Downtown", "harbor", 10, 43, 5, [10, 45]),
    place("Elm St", "bakery", 10, 42, 4),
    place("Quiet", "bakery", 0, 0, 0),
  ];

  it("puts most open reviews first, then the lowest rating, and drops places with nothing to show", () => {
    const table = buildLocationTable(rows, { group: false, businessName: () => null });
    expect(table.groups).toHaveLength(1);
    expect(table.groups[0]!.rows.map((row) => row.id)).toEqual(["Downtown", "Elm St", "Riverside"]);
    expect(table.barFrom).toBe(4);
    expect(table.groups[0]!.rows[0]!.width).toBeCloseTo(0.3);
    expect(table.groups[0]!.rows[0]!.change).toBeCloseTo(-0.2);
    expect(table.total).toBe(3);
  });

  it("groups rows by business in the same order", () => {
    const names: Record<string, string> = { harbor: "Harbor Dental", bakery: "Northside Bakery" };
    const table = buildLocationTable(rows, { group: true, businessName: (id) => names[id ?? ""] ?? null });
    expect(table.groups.map((group) => [group.name, group.rows.map((row) => row.id)])).toEqual([
      ["Harbor Dental", ["Downtown", "Riverside"]],
      ["Northside Bakery", ["Elm St"]],
    ]);
  });

  it("starts the bar lower when a location is below 4 stars", () => {
    const table = buildLocationTable([place("Low", "a", 10, 32, 0)], { group: false, businessName: () => null });
    expect(table.barFrom).toBe(3);
    const whole = buildLocationTable([place("Three", "a", 10, 30, 0)], { group: false, businessName: () => null });
    expect(whole.barFrom).toBe(2);
    expect(whole.groups[0]!.rows[0]!.width).toBeCloseTo(1 / 3);
  });
});

describe("buildThemes", () => {
  const bar = (label: string, count: number) => ({ label, count, reviews: count, href: "/insights" });

  it("takes two praise and two issues", () => {
    const themes = buildThemes([bar("Staff", 86), bar("Quality", 64), bar("Price", 10)], [bar("Waiting", 23), bar("Orders", 14)]);
    expect(themes.map((theme) => `${theme.kind}:${theme.label}`)).toEqual([
      "praise:Staff",
      "praise:Quality",
      "issue:Waiting",
      "issue:Orders",
    ]);
  });

  it("tops up from the other side when one is short", () => {
    const themes = buildThemes([bar("Staff", 86), bar("Quality", 64), bar("Price", 10)], [bar("Waiting", 23)]);
    expect(themes).toHaveLength(4);
    expect(themes.filter((theme) => theme.kind === "praise")).toHaveLength(3);
  });
});

describe("header helpers", () => {
  it("greets by the time of day in the workspace timezone", () => {
    expect(greeting(now, zone, "Maya Patel")).toBe("Good morning, Maya");
    expect(greeting(new Date("2026-11-03T10:00:00Z"), zone, null)).toBe("Good afternoon");
    expect(greeting(new Date("2026-11-03T14:00:00Z"), zone, "")).toBe("Good evening");
  });

  it("rounds the bar scale up to a multiple of five", () => {
    expect(niceMax([0, 3])).toBe(5);
    expect(niceMax([12, 7])).toBe(15);
  });
});
