import { describe, expect, it } from "vitest";
import {
  latestPeriodReviews,
  parsePeriodInsight,
  periodInsightPrompt,
  periodInsightScopeSelected,
  PERIOD_INSIGHT_REVIEW_CAP,
  type PeriodReviewLine,
} from "@/lib/period-gemini-insight";

function line(when: string, text = "Slow service", stars = 2): PeriodReviewLine {
  return { stars, when, location: "Mall Road", text };
}

describe("period insight scope", () => {
  it("runs only when an organisation, group, or outlet is selected", () => {
    expect(periodInsightScopeSelected({ clientId: null, groupId: null, locationId: null, blocked: false })).toBe(false);
    expect(periodInsightScopeSelected({ clientId: "org", groupId: null, locationId: null, blocked: false })).toBe(true);
    expect(periodInsightScopeSelected({ clientId: null, groupId: "group", locationId: null, blocked: false })).toBe(true);
    expect(periodInsightScopeSelected({ clientId: null, groupId: null, locationId: "outlet", blocked: false })).toBe(true);
    expect(periodInsightScopeSelected({ clientId: "org", groupId: null, locationId: null, blocked: true })).toBe(false);
  });
});

describe("latest period reviews", () => {
  it("keeps the newest 100 and drops the rest", () => {
    const rows = Array.from({ length: 120 }, (_, index) => line(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:0${index % 10}Z`, `review ${index}`));
    const result = latestPeriodReviews(rows);
    expect(result.reviews).toHaveLength(PERIOD_INSIGHT_REVIEW_CAP);
    expect(result.capped).toBe(true);
    expect(result.reviews[0]?.when >= result.reviews[99]?.when).toBe(true);
  });

  it("keeps every review when fewer than 100 are available", () => {
    const result = latestPeriodReviews([line("2026-03-01T00:00:00Z"), line("2026-04-01T00:00:00Z")]);
    expect(result.capped).toBe(false);
    expect(result.reviews.map((review) => review.when)).toEqual(["2026-04-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
  });
});

describe("period insight prompt and parse", () => {
  it("sends the review text and the cap note, and does not invent a customer name", () => {
    const prompt = periodInsightPrompt({
      scopeTitle: "Fazyo",
      periodLabel: "Last month",
      reviews: [line("2026-09-02T10:00:00Z", "The fitting room queue was long")],
      capped: true,
    });
    expect(prompt).toContain("The fitting room queue was long");
    expect(prompt).toContain("latest 1 reviews");
    expect(prompt).toContain("limited to 100");
    expect(prompt).toContain("Do not name individual customers");
    expect(prompt).not.toContain("reviewer");
  });

  it("accepts a grounded JSON reading and drops a broken card", () => {
    const copy = parsePeriodInsight(
      JSON.stringify({
        headline: "Queues are the complaint that keeps showing up.",
        summary: "Recent visits describe a long wait at the fitting room. Praise is mostly about staff who stayed calm.",
        insights: [
          { title: "Fitting room wait", detail: "Several low-star reviews describe a queue.", tone: "problem" },
          { title: "", detail: "missing title" },
        ],
        actions: ["Open a second fitting room at peak hours."],
      })
    );
    expect(copy?.headline).toContain("Queues");
    expect(copy?.insights).toHaveLength(1);
    expect(copy?.insights[0]?.tone).toBe("problem");
    expect(copy?.actions).toEqual(["Open a second fitting room at peak hours."]);
  });

  it("rejects a response that is not the expected object", () => {
    expect(parsePeriodInsight("not json")).toBeNull();
    expect(parsePeriodInsight("[]")).toBeNull();
    expect(parsePeriodInsight(JSON.stringify({ headline: "Only a headline" }))).toBeNull();
  });
});
