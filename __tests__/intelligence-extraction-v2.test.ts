import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import { buildRatingOnlyExtraction, validateModelExtraction } from "@/lib/intelligence/extraction";
import {
  buildRulesExtraction,
  detectRequests,
  detectStaffMentions,
  requiresAiReview,
} from "@/lib/intelligence/rules-extraction";
import { buildSummaryDocument } from "@/lib/intelligence/summary-aggregate";
import { discoverFindings, type InsightInput, type InsightReview } from "@/lib/intelligence/insight";
import { summaryWindow } from "@/lib/intelligence/summary-window";
import { validateSynthesis } from "@/lib/intelligence/brief";

describe("extraction v2 rich facts", () => {
  const comment = "Neenu at the billing counter was so helpful. The kidswear selection is very limited though. I wish there was more kidswear collection for Onam.";

  it("keeps aspect phrases, named staff, and verbatim requests", () => {
    const result = validateModelExtraction({
      comment,
      starRating: 4,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "staff_politeness", polarity: "praise", phrase: "helpful billing staff", excerpt: "Neenu at the billing counter was so helpful", confidence: 0.9 },
          { topicCode: "product_variety", polarity: "complaint", phrase: "kidswear selection limited", excerpt: "kidswear selection is very limited", confidence: 0.8 },
        ],
        staff: ["Neenu"],
        requests: ["wish there was more kidswear collection"],
      }),
    });
    expect(result.analysisVersion).toBe("extract-v2");
    expect(result.facts.quotations.find((item) => item.topicCode === "product_variety")?.phrase).toBe("kidswear selection limited");
    expect(result.interpretation.staffMentions).toEqual(["Neenu"]);
    expect(result.interpretation.requests).toEqual(["wish there was more kidswear collection"]);
  });

  it("drops invented staff names and paraphrased requests", () => {
    const result = validateModelExtraction({
      comment,
      starRating: 4,
      modelText: JSON.stringify({
        aspects: [{ topicCode: "staff_politeness", polarity: "praise", excerpt: "Neenu at the billing counter was so helpful", confidence: 0.9 }],
        staff: ["Neenu", "Ghost Person"],
        requests: ["customers want a bigger kids section"],
      }),
    });
    expect(result.interpretation.staffMentions).toEqual(["Neenu"]);
    expect(result.interpretation.requests).toEqual([]);
    expect(result.repaired).toBe(true);
  });

  it("tolerates null rich fields and defaults rating-only reviews to empty", () => {
    const result = validateModelExtraction({
      comment,
      starRating: 5,
      modelText: JSON.stringify({
        aspects: [{ topicCode: "staff_politeness", polarity: "praise", excerpt: "Neenu at the billing counter was so helpful", confidence: 0.9 }],
        staff: null,
        requests: null,
      }),
    });
    expect(result.interpretation.staffMentions).toEqual([]);
    expect(result.interpretation.requests).toEqual([]);
    const ratingOnly = buildRatingOnlyExtraction(5);
    expect(ratingOnly.interpretation.staffMentions).toEqual([]);
    expect(ratingOnly.interpretation.requests).toEqual([]);
    expect(ratingOnly.analysisVersion).toBe("extract-v2");
  });
});

describe("rules v2 detection and AI routing", () => {
  it("detects staff named with an honorific or role, and requests", () => {
    expect(detectStaffMentions("Mr. Vipin helped us pick shirts.")).toContain("Vipin");
    expect(detectStaffMentions("Good collection and nice store.")).toEqual([]);
    expect(detectRequests("Good store. I wish there was more parking space near the entrance.").length).toBe(1);
    const rules = buildRulesExtraction("Mr. Vipin helped us. Great staff.", 5);
    expect(rules.extraction.interpretation.staffMentions).toContain("Vipin");
    expect(rules.extraction.facts.quotations.every((item) => typeof item.phrase === "string" || item.phrase === undefined)).toBe(true);
  });

  it("routes named, long, mixed, or mid-rated reviews to the model", () => {
    const named = "Mr. Vipin helped us. Great staff and good collection.";
    expect(requiresAiReview(named, 5, buildRulesExtraction(named, 5))).toBe(true);

    const long = `The store has a wide range of collections for the whole family and the staff were patient while we tried many outfits across two floors during our visit last weekend with kids.`;
    expect(requiresAiReview(long, 5, buildRulesExtraction(long, 5))).toBe(true);

    const mid = "Okay store, average collection.";
    expect(requiresAiReview(mid, 3, buildRulesExtraction(mid, 3))).toBe(true);

    const keyword = "Good collection.";
    expect(requiresAiReview(keyword, 5, buildRulesExtraction(keyword, 5))).toBe(true);
    const neutralLong = "We stopped in on a Saturday afternoon and walked around the ground floor for a while before leaving.";
    expect(requiresAiReview(neutralLong, 4, buildRulesExtraction(neutralLong, 4))).toBe(true);
    const barePraise = "Loved it.";
    expect(requiresAiReview(barePraise, 5, buildRulesExtraction(barePraise, 5))).toBe(false);
    expect(requiresAiReview(null, 5, buildRulesExtraction(null, 5))).toBe(false);
  });

  it("routes every negative review to the model, even short clear ones", () => {
    const oneStar = "Worst quality, torn after one wash.";
    expect(requiresAiReview(oneStar, 1, buildRulesExtraction(oneStar, 1))).toBe(true);
    const twoStar = "Trial room was not clean";
    expect(requiresAiReview(twoStar, 2, buildRulesExtraction(twoStar, 2))).toBe(true);
    // Negative words under a high star rating are still a negative read.
    const mismatch = "Staff were rude and unhelpful.";
    expect(requiresAiReview(mismatch, 5, buildRulesExtraction(mismatch, 5))).toBe(true);
    // A rating-only negative review has no text for the model to read.
    expect(requiresAiReview(null, 1, buildRulesExtraction(null, 1))).toBe(false);
    const happyShort = "Good collection and friendly staff";
    expect(requiresAiReview(happyShort, 5, buildRulesExtraction(happyShort, 5))).toBe(true);
  });
});

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

describe("v2 findings", () => {
  function fixture(): InsightReview[] {
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 40; index += 1) {
      reviews.push(review({ id: `happy-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    // One named staff member praised repeatedly.
    for (let index = 0; index < 4; index += 1) {
      reviews.push(review({ id: `staff-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"], staffMentions: ["Neenu"] }));
    }
    // The same customer request in two reviews.
    for (let index = 0; index < 2; index += 1) {
      reviews.push(review({
        id: `req-${index}`,
        locationId: locationA,
        stars: 4,
        issues: ["product_variety"],
        requests: ["wish there was more kidswear collection"],
      }));
    }
    // Aspect phrases in the customer's own wording.
    for (let index = 0; index < 3; index += 1) {
      reviews.push(review({
        id: `aspect-${index}`,
        locationId: locationA,
        stars: 3,
        overall: "mixed",
        issues: ["product_variety"],
        aspects: [{ phrase: "Kidswear selection limited", topicCode: "product_variety", polarity: "complaint" }],
      }));
    }
    return reviews;
  }

  const input = makeInput(fixture());
  const draft = discoverFindings(input);

  it("ranks a complained-about staff member ahead of a more-mentioned colleague and keeps their outlet", () => {
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 20; index += 1) {
      reviews.push(review({ id: `base-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    for (let index = 0; index < 8; index += 1) {
      reviews.push(review({ id: `praise-${index}`, locationId: locationA, stars: 5, staffMentions: ["Sanjana"] }));
    }
    for (let index = 0; index < 3; index += 1) {
      reviews.push(review({ id: `blame-${index}`, locationId: locationB, stars: 1, overall: "negative", staffMentions: ["Ravi"] }));
    }
    const staff = discoverFindings(makeInput(reviews)).findings.filter((item) => item.category === "staff_mention");
    expect(staff.map((item) => item.title)).toEqual([
      expect.stringContaining("Ravi"),
      expect.stringContaining("Sanjana"),
    ]);
    expect(staff[0]?.locationIds).toEqual([locationB]);
    expect(staff[0]?.explanation).toContain("one outlet");
    expect(staff[0]?.title).toContain("visit goes badly");
    expect(staff[1]?.locationIds).toEqual([locationA]);
  });

  it("reads a named person from the sentence, not from the star or a second spelling", () => {
    const reviews: InsightReview[] = [
      review({
        id: "amal-1",
        locationId: locationA,
        stars: 5,
        staffMentions: ["Amal"],
        excerpts: [{ topicCode: "staff_politeness", polarity: "praise", text: "Amal bro was really very helpful and he found exactly what we needed without rushing" }],
      }),
      review({
        id: "amal-2",
        locationId: locationA,
        stars: 5,
        staffMentions: ["Amal Joseph"],
        excerpts: [{ topicCode: "staff_politeness", polarity: "praise", text: "Amal Joseph is a friendly and active sales man" }],
      }),
      review({
        id: "amal-3",
        locationId: locationA,
        stars: 1,
        staffMentions: ["Mr. Amal"],
        excerpts: [{ topicCode: "staff_politeness", polarity: "praise", text: "Amal understood exactly what I was looking for and helped me choose the perfect dress" }],
      }),
      review({
        id: "amal-4",
        locationId: locationB,
        stars: 5,
        staffMentions: ["Amal"],
        excerpts: [{ topicCode: "other", polarity: "praise", text: "Nice presentation mr. Amal" }],
      }),
    ];
    const finding = discoverFindings(makeInput(reviews)).findings.find((item) => item.category === "staff_mention");
    expect(finding?.evidenceCount).toBe(4);
    expect(finding?.title).toContain("Amal");
    expect(finding?.title).toContain("thank");
    expect(finding?.explanation).toContain("finding what the customer came for");
    expect(finding?.explanation).toContain("not rushing them");
    expect(finding?.explanation).toContain("sentence still thanks");
    expect(finding?.explanation).toContain("Amal Joseph");
    expect(finding?.explanation).toContain("not a second workplace");
    expect(finding?.action).toContain("Recognise");
    expect(finding?.metrics.find((item) => item.key === "staff_complaint_reviews")?.value).toBe(0);
    expect(finding?.locationIds.sort()).toEqual([locationA, locationB].sort());
  });

  it("names staff members customers keep mentioning", () => {
    const finding = draft.findings.find((item) => item.category === "staff_mention");
    expect(finding?.title).toContain("Neenu");
    expect(finding?.evidenceCount).toBe(4);
    expect(finding?.metrics.find((item) => item.key === "staff_praise_reviews")?.value).toBe(4);
  });

  it("surfaces repeated customer requests in their own words", () => {
    const finding = draft.findings.find((item) => item.category === "customer_request");
    expect(finding?.title).toContain("kidswear collection");
    expect(finding?.evidenceCount).toBe(2);
  });

  it("prefers extraction aspect phrases for micro-topics", () => {
    const finding = draft.findings.find((item) => item.category === "micro_topic" && item.title.includes("kidswear selection limited"));
    expect(finding?.evidenceCount).toBe(3);
  });

  it("keeps filler phrases out of micro-topics so specific subjects surface", () => {
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 30; index += 1) {
      reviews.push(review({ id: `base-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    for (let index = 0; index < 10; index += 1) {
      reviews.push(review({
        id: `filler-${index}`,
        locationId: locationA,
        stars: 5,
        praise: ["product_variety"],
        aspects: [{ phrase: "good collection", topicCode: "product_variety", polarity: "praise" }],
      }));
    }
    for (let index = 0; index < 3; index += 1) {
      reviews.push(review({
        id: `specific-${index}`,
        locationId: locationA,
        stars: 3,
        overall: "mixed",
        issues: ["product_variety"],
        aspects: [{ phrase: "kidswear selection limited", topicCode: "product_variety", polarity: "complaint" }],
      }));
    }
    const micro = discoverFindings(makeInput(reviews)).findings.filter((item) => item.category === "micro_topic");
    expect(micro.some((item) => item.title.includes("kidswear selection limited"))).toBe(true);
    expect(micro.some((item) => item.title.includes("good collection"))).toBe(false);
  });

  it("groups request variants into one ask", () => {
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 30; index += 1) {
      reviews.push(review({ id: `base-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    reviews.push(review({ id: "ask-1", locationId: locationA, stars: 4, requests: ["need more collection"] }));
    reviews.push(review({ id: "ask-2", locationId: locationA, stars: 4, requests: ["Need more collections for kids wear"] }));
    const finding = discoverFindings(makeInput(reviews)).findings.find((item) => item.category === "customer_request");
    expect(finding?.evidenceCount).toBe(2);
  });

  it("ranks complaints as recurring issues when the window has no comparison", () => {
    const window = summaryWindow(parseDateRange({ range: "all" }, "all"), "Asia/Kolkata");
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 30; index += 1) {
      reviews.push(review({ id: `base-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    for (let index = 0; index < 8; index += 1) {
      reviews.push(review({ id: `issue-${index}`, locationId: locationA, stars: 2, overall: "negative", issues: ["product_variety"] }));
    }
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
    const allTime: InsightInput = {
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
    const finding = discoverFindings(allTime).findings.find(
      (item) => item.category === "recurring_issue" && item.topicCodes.includes("product_variety")
    );
    expect(finding?.evidenceCount).toBe(8);
    expect(finding?.title).toContain("complaints in this window");
  });

  function allTimeInput(reviews: InsightReview[]): InsightInput {
    const window = summaryWindow(parseDateRange({ range: "all" }, "all"), "Asia/Kolkata");
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

  it("detects emerging topics from the window's own halves when there is no comparison", () => {
    const reviews: InsightReview[] = [];
    for (let index = 0; index < 30; index += 1) {
      reviews.push(review({
        id: `early-${index}`,
        locationId: locationA,
        stars: 5,
        praise: ["staff_politeness"],
        createdAt: `2024-0${1 + (index % 6)}-15T00:00:00.000Z`,
      }));
    }
    for (let index = 0; index < 4; index += 1) {
      reviews.push(review({
        id: `late-${index}`,
        locationId: locationA,
        stars: 2,
        overall: "negative",
        issues: ["queue_time"],
        createdAt: "2026-08-15T00:00:00.000Z",
      }));
    }
    const draft = discoverFindings(allTimeInput(reviews));
    const emerging = draft.findings.find((item) => item.category === "emerging_topic" && item.topicCodes.includes("queue_time"));
    expect(emerging?.title).toContain("recent half");
    expect(emerging?.evidenceCount).toBe(4);
  });

  it("compares complaint rates between outlets, not just raw counts", () => {
    const reviews: InsightReview[] = [];
    // Outlet A: 100 reviews, 12 parking complaints (12%).
    for (let index = 0; index < 88; index += 1) {
      reviews.push(review({ id: `a-happy-${index}`, locationId: locationA, stars: 5, praise: ["staff_politeness"] }));
    }
    for (let index = 0; index < 12; index += 1) {
      reviews.push(review({ id: `a-park-${index}`, locationId: locationA, stars: 2, overall: "negative", issues: ["parking"] }));
    }
    // Outlet B: 300 reviews, 2 parking complaints (0.7%).
    for (let index = 0; index < 298; index += 1) {
      reviews.push(review({ id: `b-happy-${index}`, locationId: locationB, stars: 5, praise: ["staff_politeness"] }));
    }
    for (let index = 0; index < 2; index += 1) {
      reviews.push(review({ id: `b-park-${index}`, locationId: locationB, stars: 2, overall: "negative", issues: ["parking"] }));
    }
    const finding = discoverFindings(makeInput(reviews)).findings.find(
      (item) => item.category === "location_comparison" && item.topicCodes.includes("parking")
    );
    expect(finding?.locationIds).toEqual([locationA]);
    expect(finding?.title).toContain("concentrated at one outlet");
  });

  it("validates synthesis against cited findings only", () => {
    const staff = draft.findings.find((item) => item.category === "staff_mention");
    expect(staff).toBeTruthy();
    const good = validateSynthesis(
      [{ title: "Neenu is a named strength", summary: `${staff!.evidenceCount} reviews name Neenu.`, action: "Recognise her.", keys: [staff!.key] }],
      draft.findings,
      input.summary
    );
    expect(good).toHaveLength(1);
    const invented = validateSynthesis(
      [{ title: "Big problem", summary: "9999 reviews complain about parking.", action: "Fix it.", keys: [staff!.key] }],
      draft.findings,
      input.summary
    );
    expect(invented).toHaveLength(0);
    const unknownKey = validateSynthesis(
      [{ title: "X", summary: "Something happened.", action: "", keys: ["no-such-key"] }],
      draft.findings,
      input.summary
    );
    expect(unknownKey).toHaveLength(0);
  });
});
