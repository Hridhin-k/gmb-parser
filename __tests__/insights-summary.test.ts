import { describe, expect, it } from "vitest";
import { nextActions, shortVersion, type InsightRecord } from "@/lib/insight-report";
import { analyticsRedirect, reportsRedirect } from "@/lib/insights-links";
import { insightsReportLines, pdfText } from "@/lib/insights-pdf";
import { buildMoodSeries, heatmapNote, locationHeatmap, monthQuotes } from "@/lib/insight-mood";
import { namedStaff } from "@/lib/insight-dashboard";

function insight(patch: Partial<InsightRecord>): InsightRecord {
  return {
    id: "a".repeat(24),
    category: "recurring_issue",
    sentiment: "negative",
    title: "Long waits at Downtown",
    detail: "Waits are getting longer. Nobody explains the delay.",
    importance: 3,
    severity: null,
    evidenceReviewIds: [],
    evidenceExcerpts: ["Waited 50 minutes and nobody explained why"],
    supportingReviews: 17,
    denominator: 220,
    calculation: "17 of 220 analysed reviews",
    context: "",
    confidence: 0.8,
    limitations: [],
    suggestedAction: null,
    ...patch,
  };
}

const theme = (topic: string, praise: number, complaints: number) => ({
  topic,
  label: topic[0].toUpperCase() + topic.slice(1).replace(/_/g, " "),
  praise,
  complaints,
  praiseReviews: praise,
  complaintReviews: complaints,
});

describe("shortVersion", () => {
  it("writes the headline and cards from the AI report, problems highlighted", () => {
    const short = shortVersion({
      insights: [
        insight({ id: "b".repeat(24), sentiment: "positive", category: "recurring_strength", title: "Online booking is praised", importance: 4, supportingReviews: 31 }),
        insight({ id: "c".repeat(24), title: "Long waits at Downtown", importance: 5 }),
        insight({ id: "d".repeat(24), title: "Order mistakes at Elm St", importance: 4, supportingReviews: 12 }),
        insight({ id: "e".repeat(24), category: "serious_incident", title: "Charged twice", importance: 5 }),
      ],
      themes: [],
      mood: { now: 78, yearAgo: 70, monthAgo: 74 },
    });
    expect(short?.source).toBe("ai");
    const sentence = short?.sentence.map((part) => part.text).join("");
    expect(sentence).toBe(
      "Customers are happier than a year ago — online booking is praised. Two problems are costing you stars: long waits at Downtown and order mistakes at Elm St."
    );
    expect(short?.sentence.filter((part) => part.problem).map((part) => part.text)).toEqual([
      "long waits at Downtown",
      "order mistakes at Elm St",
    ]);
    expect(short?.takeaways.map((t) => [t.kind, t.reviews])).toEqual([
      ["good", 31],
      ["fix_first", 17],
      ["fix_next", 12],
    ]);
    // Incidents never become a takeaway.
    expect(short?.takeaways.some((t) => t.title === "Charged twice")).toBe(false);
    expect(short?.takeaways[1].body).toBe("Waits are getting longer.");
  });

  it("links a takeaway to its topic when the insight is about one", () => {
    const short = shortVersion({
      insights: [
        insight({ id: "c".repeat(24), context: "topic wait_time", importance: 5 }),
        insight({ id: "d".repeat(24), context: "staff Lena", importance: 4 }),
      ],
      themes: [],
      mood: { now: null, yearAgo: null, monthAgo: null },
    });
    expect(short?.takeaways.map((t) => t.topic)).toEqual(["wait_time", null]);
  });

  it("falls back to theme counts before the AI report exists", () => {
    const short = shortVersion({
      insights: [],
      themes: [theme("friendly_staff", 40, 2), theme("wait_time", 3, 9), theme("parking", 1, 4), theme("price", 2, 1)],
      mood: { now: 60, yearAgo: null, monthAgo: 66 },
    });
    expect(short?.source).toBe("counts");
    expect(short?.sentence.map((part) => part.text).join("")).toBe(
      "Customers are less happy than last month, and friendly staff gets the most praise. The most common complaints are wait time and parking."
    );
    expect(short?.takeaways.map((t) => [t.kind, t.topic])).toEqual([
      ["good", "friendly_staff"],
      ["fix_first", "wait_time"],
      ["fix_next", "parking"],
    ]);
    expect(short?.takeaways[1].body).toBe("9 complaints, 75% of what was said about it.");
  });

  it("says nothing when there is nothing to say", () => {
    expect(shortVersion({ insights: [], themes: [], mood: { now: null, yearAgo: null, monthAgo: null } })).toBeNull();
  });
});

describe("nextActions", () => {
  it("lists suggested actions, problems first, with the evidence count", () => {
    const actions = nextActions([
      insight({ id: "1".repeat(24), sentiment: "positive", category: "recurring_strength", title: "Staff praised", suggestedAction: "Thank the team", importance: 5 }),
      insight({ id: "2".repeat(24), suggestedAction: "Add a 15-minute buffer on Mondays", importance: 4 }),
      insight({ id: "3".repeat(24), suggestedAction: null }),
      insight({ id: "4".repeat(24), category: "serious_incident", suggestedAction: "Check the till records", importance: 5 }),
    ]);
    expect(actions.map((a) => a.id)).toEqual(["2".repeat(24), "1".repeat(24)]);
    expect(actions[0]).toEqual({
      id: "2".repeat(24),
      title: "Add a 15-minute buffer on Mondays",
      why: "Long waits at Downtown. 17 reviews of 220.",
    });
  });
});

describe("old page links", () => {
  it("sends analytics to Insights with the place and dates", () => {
    expect(analyticsRedirect({ client: "c1", range: "6m", rankBy: "reply" })).toBe("/insights?client=c1&range=6m");
    expect(analyticsRedirect({ section: "themes", location: "l1" })).toBe("/insights?location=l1&tab=topics");
    expect(analyticsRedirect({})).toBe("/insights");
  });

  it("sends reports to the Reports and alerts tab, keeping section and edit", () => {
    expect(reportsRedirect({})).toBe("/insights?tab=reports");
    expect(reportsRedirect({ tab: "alerts", group: "g1", range: "custom", from: "2026-01-01", to: "2026-02-01" })).toBe(
      "/insights?group=g1&range=custom&from=2026-01-01&to=2026-02-01&tab=reports&view=alerts"
    );
    expect(reportsRedirect({ tab: "reports", edit: "r1" })).toBe("/insights?tab=reports&edit=r1");
  });
});

describe("client report PDF", () => {
  it("uses plain characters the PDF font can draw", () => {
    expect(pdfText("Harbor Dental — Downtown · −58 “ok” it’s…")).toBe("Harbor Dental - Downtown - -58 \"ok\" it's...");
  });

  it("lists the short version, mood by month, topics and actions", () => {
    const points = buildMoodSeries(
      ["2026-09", "2026-10"],
      [
        { month: "2025-10", positive: 7, negative: 3 },
        { month: "2026-09", positive: 6, negative: 4 },
        { month: "2026-10", positive: 8, negative: 2 },
      ],
      [{ month: "2026-10", reviews: 12, rating: 4.5 }]
    );
    const doc = insightsReportLines({
      placeName: "Harbor Dental",
      periodLabel: "Last 12 months",
      generatedOn: "3 November 2026",
      counts: { analysed: 20, eligible: 22 },
      short: { source: "counts", sentence: [{ text: "Customers are happier." }], takeaways: [] },
      points,
      trends: [],
      actions: [{ id: "x", title: "Add a buffer", why: "Waits." }],
      locationNote: null,
    });
    expect(doc.title).toBe("Insights: Harbor Dental");
    expect(doc.lines).toContain("Customers are happier.");
    expect(doc.lines).toContain("- September 2026: 60% happy - 0 reviews");
    expect(doc.lines).toContain("- October 2026: 80% happy (a year earlier 70%) - 12 reviews, 4.5 average");
    expect(doc.lines).toContain("1. Add a buffer");
  });
});

describe("monthQuotes", () => {
  it("quotes a complaint when the mood fell and praise when it rose", () => {
    const quotes = monthQuotes(
      [
        { month: "2026-08", happy: 70 },
        { month: "2026-09", happy: 60 },
        { month: "2026-10", happy: 75 },
        { month: "2026-11", happy: null },
      ],
      [
        { month: "2026-09", sentiment: "positive", excerpt: "Lovely staff" },
        { month: "2026-09", sentiment: "negative", excerpt: "Waited an hour" },
        { month: "2026-10", sentiment: "positive", excerpt: "Back on time" },
        { month: "2026-10", sentiment: "negative", excerpt: "Parking was hard" },
      ]
    );
    expect(quotes).toEqual([null, "Waited an hour", "Back on time", null]);
  });
});

describe("heatmapNote", () => {
  const names = new Map([
    ["down", "Downtown"],
    ["river", "Riverside"],
    ["elm", "Elm St"],
  ]);

  it("names the one location where a topic is negative", () => {
    const heat = locationHeatmap([
      { locationId: "down", topic: "wait_time", positive: 2, negative: 18 },
      { locationId: "river", topic: "wait_time", positive: 13, negative: 7 },
      { locationId: "elm", topic: "wait_time", positive: 8, negative: 2 },
    ]);
    expect(heatmapNote(heat, names)).toBe("Downtown is the only location where wait time is negative (−80). Elsewhere it averages +45.");
  });

  it("says nothing when every cell is mixed or positive", () => {
    const heat = locationHeatmap([{ locationId: "down", topic: "staff", positive: 9, negative: 1 }]);
    expect(heatmapNote(heat, names)).toBeNull();
  });
});

describe("namedStaff", () => {
  it("drops words that name nobody and keeps the most mentioned people", () => {
    expect(
      namedStaff([
        { name: "team", count: 6 },
        { name: "Lena", count: 11 },
        { name: "Sam", count: 18 },
        { name: "The Staff", count: 4 },
      ])
    ).toEqual([
      { name: "Sam", count: 18 },
      { name: "Lena", count: 11 },
    ]);
  });
});
