import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import { buildSummaryDocument } from "@/lib/intelligence/summary-aggregate";
import { discoverFindings, type InsightInput, type InsightReview } from "@/lib/intelligence/insight";
import { summaryWindow } from "@/lib/intelligence/summary-window";

const workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const client = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const locationA = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const locationB = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function review(partial: Partial<InsightReview> & Pick<InsightReview, "id" | "locationId">): InsightReview {
  return {
    workspaceId: workspace,
    createdAt: "2026-08-10T00:00:00.000Z",
    stars: 5,
    overall: "positive",
    issues: [],
    praise: [],
    excerpts: [],
    clusterIds: [],
    severe: false,
    ...partial,
  };
}

function makeInput(reviews: InsightReview[]): InsightInput {
  const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "Asia/Kolkata");
  const summary = buildSummaryDocument({
    scopeType: "organisation",
    scopeId: client,
    locationIds: [locationA, locationB],
    window,
    reviews: reviews.map((item) => ({
      id: item.id,
      locationId: item.locationId,
      stars: item.stars,
      createdAt: item.createdAt,
      contentHash: item.id,
      overall: item.overall,
      topics: [...item.issues, ...item.praise],
      issues: item.issues,
      praise: item.praise,
      excerpts: item.excerpts,
    })),
  });
  return {
    workspaceId: workspace,
    clientId: client,
    scopeType: "organisation",
    scopeId: client,
    locationIds: [locationA, locationB],
    window,
    summary,
    reviews,
    previousReviews: [],
    clusters: [],
  };
}

function fixture(): InsightReview[] {
  const reviews: InsightReview[] = [];
  for (let index = 0; index < 40; index += 1) {
    reviews.push(review({ id: `happy-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
  }
  // Availability: few mentions, low average, and complaints inside happy reviews.
  [1, 2, 4, 5, 5, 5].forEach((stars, index) => {
    reviews.push(review({ id: `avail-${index}`, locationId: locationA, stars, overall: stars >= 4 ? "positive" : "negative", issues: ["product_availability"] }));
  });
  // Rare but severe: two 1-star queue complaints.
  [1, 1].forEach((stars, index) => {
    reviews.push(review({ id: `queue-${index}`, locationId: locationA, stars, overall: "negative", issues: ["queue_time"] }));
  });
  // Location drag: quality is praised at A, panned at B (30 reviews at B).
  for (let index = 0; index < 6; index += 1) {
    reviews.push(review({ id: `qual-a-${index}`, locationId: locationA, stars: 5, praise: ["product_quality"] }));
  }
  for (let index = 0; index < 26; index += 1) {
    reviews.push(review({ id: `qual-b-${index}`, locationId: locationB, stars: 5, praise: ["staff_politeness"] }));
  }
  [2, 2, 3, 3].forEach((stars, index) => {
    reviews.push(review({ id: `qual-b-bad-${index}`, locationId: locationB, stars, overall: "negative", issues: ["product_quality"] }));
  });
  // Micro-topic phrase repeated in quotations.
  for (let index = 0; index < 4; index += 1) {
    reviews.push(review({
      id: `micro-${index}`,
      locationId: locationA,
      stars: 3,
      overall: "mixed",
      issues: ["product_variety"],
      excerpts: [{ topicCode: "product_variety", polarity: "complaint", text: "kidswear selection is very limited" }],
    }));
  }
  return reviews;
}

describe("deep pattern findings", () => {
  const draft = discoverFindings(makeInput(fixture()));

  it("surfaces rating drag for a rare topic with low stars", () => {
    const finding = draft.findings.find((item) => item.category === "rating_drag" && item.topicCodes.includes("product_availability"));
    expect(finding).toBeTruthy();
    expect(finding?.metrics.find((item) => item.key === "topic_average_rating")?.value).toBe(3.67);
  });

  it("keeps praise that only mentions billing off the rising concern", () => {
    const praise = [5, 5, 5, 5, 5, 5, 5].map((stars, index) => review({
      id: `bill-praise-${index}`,
      locationId: locationA,
      stars,
      praise: ["billing_delay"],
      excerpts: [{ topicCode: "billing_delay", polarity: "praise", text: "billing session is very good" }],
    }));
    const complaints = [1, 1, 2, 2, 3].map((stars, index) => review({
      id: `bill-bad-${index}`,
      locationId: locationA,
      stars,
      overall: "negative",
      issues: ["billing_delay"],
      excerpts: [{ topicCode: "billing_delay", polarity: "complaint", text: "my turn was ignored while another customer was billed ahead of me" }],
    }));
    const finding = discoverFindings(makeInput([...fixture(), ...praise, ...complaints])).findings.find(
      (item) => item.category === "rating_drag" && item.topicCodes.includes("billing_delay"),
    );
    expect(finding?.reviewIds.sort()).toEqual(["bill-bad-0", "bill-bad-1", "bill-bad-2", "bill-bad-3", "bill-bad-4"]);
    expect(finding?.explanation).toContain("complain about");
    expect(finding?.explanation).not.toContain("billing session is very good");
  });

  it("finds complaints hiding inside happy reviews", () => {
    const finding = draft.findings.find((item) => item.category === "fan_friction" && item.topicCodes.includes("product_availability"));
    expect(finding?.evidenceCount).toBe(4);
  });

  it("watchlists rare but severe topics as hypotheses", () => {
    const finding = draft.findings.find((item) => item.category === "rare_severe" && item.topicCodes.includes("queue_time"));
    expect(finding).toBeTruthy();
    expect(finding?.hypothesis).toBe(true);
    expect(finding?.confidence).toBe("low");
  });

  it("flags a topic that is weaker at one outlet", () => {
    const finding = draft.findings.find((item) => item.category === "location_drag" && item.topicCodes.includes("product_quality"));
    expect(finding?.locationIds).toEqual([locationB]);
  });

  it("mines micro-topic phrases from customer wording", () => {
    const finding = draft.findings.find((item) => item.category === "micro_topic");
    expect(finding?.title).toContain("kidswear selection");
    expect(finding?.evidenceCount).toBe(4);
  });

  it("keeps every deep finding evidence-backed", () => {
    const deep = draft.findings.filter((item) => ["rating_drag", "fan_friction", "rare_severe", "location_drag", "micro_topic"].includes(item.category));
    expect(deep.length).toBeGreaterThanOrEqual(5);
    for (const finding of deep) {
      expect(finding.reviewIds.length).toBe(finding.evidenceCount);
      expect(finding.reviewIds.length).toBeGreaterThan(0);
    }
  });
});
