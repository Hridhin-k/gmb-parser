import { describe, expect, it } from "vitest";
import { parseDateRange } from "@/lib/date-range";
import { buildSummaryDocument, type SummaryDocument } from "@/lib/intelligence/summary-aggregate";
import {
  applyModelProse,
  claimsMatch,
  discoverFindings,
  evidenceExcerpt,
  planInsightWrite,
  presentInsight,
  type InsightClusterRef,
  type InsightInput,
  type InsightReview,
  type StoredInsight,
} from "@/lib/intelligence/insight";
import { summaryWindow } from "@/lib/intelligence/summary-window";

const workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const client = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const locationA = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const locationB = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const outside = "12121212-1212-1212-1212-121212121212";

function review(partial: Partial<InsightReview> & Pick<InsightReview, "id" | "locationId">): InsightReview {
  return {
    workspaceId: workspace,
    createdAt: "2026-08-10T00:00:00.000Z",
    stars: 2,
    overall: "negative",
    issues: [],
    praise: [],
    excerpts: [],
    clusterIds: [],
    severe: false,
    ...partial,
  };
}

function input(args: {
  reviews: InsightReview[];
  previous?: InsightReview[];
  clusters?: InsightClusterRef[];
  summary?: SummaryDocument;
}): InsightInput {
  const window = summaryWindow(parseDateRange({ range: "custom", from: "2026-08-01", to: "2026-08-31" }, "all"), "Asia/Kolkata");
  const summary = args.summary ?? buildSummaryDocument({
    scopeType: "organisation",
    scopeId: client,
    locationIds: [locationA, locationB],
    window,
    reviews: args.reviews.map((item) => ({
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
    previousReviews: (args.previous ?? []).map((item) => ({
      id: item.id,
      locationId: item.locationId,
      stars: item.stars,
      createdAt: "2026-07-10T00:00:00.000Z",
      contentHash: item.id,
      overall: item.overall,
      topics: item.issues,
      issues: item.issues,
      praise: item.praise,
      excerpts: [],
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
    reviews: args.reviews,
    previousReviews: args.previous ?? [],
    clusters: args.clusters ?? [],
  };
}

describe("evidence-backed insights", () => {
  it("does not count a review toward a topic when its quotation is about something else", () => {
    const reviews = [
      review({
        id: "p1",
        locationId: locationA,
        issues: ["price"],
        excerpts: [{ topicCode: "product_quality", polarity: "complaint", text: "very poor quality after 1st wash" }],
      }),
      review({
        id: "p2",
        locationId: locationA,
        issues: ["price"],
        excerpts: [{ topicCode: "price", polarity: "complaint", text: "rate is high." }],
      }),
      review({
        id: "p5",
        locationId: locationB,
        issues: ["price"],
        excerpts: [{ topicCode: "price", polarity: "complaint", text: "High price" }],
      }),
      review({ id: "p3", locationId: locationB, stars: 5, overall: "positive" }),
      review({ id: "p4", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const previous = ["q1", "q2", "q3"].map((id) => review({ id, locationId: locationA, issues: ["price"] }));
    const finding = discoverFindings(input({ reviews, previous })).findings.find((item) => item.topicCodes.includes("price") && item.category === "recurring_issue");
    expect(finding?.reviewIds.sort()).toEqual(["p2", "p5"]);
  });

  it("reports complaint counts even when the same topic is praised and a previous window exists", () => {
    const reviews = [
      review({
        id: "c1",
        locationId: locationA,
        stars: 2,
        issues: ["product_variety"],
        excerpts: [{ topicCode: "product_variety", polarity: "complaint", text: "Limited collections." }],
      }),
      review({
        id: "c2",
        locationId: locationB,
        stars: 1,
        issues: ["product_variety"],
        excerpts: [{ topicCode: "product_variety", polarity: "complaint", text: "selections are very limited" }],
      }),
      ...["c3", "c4", "c5"].map((id) => review({
        id,
        locationId: locationA,
        stars: 5,
        overall: "positive" as const,
        praise: ["product_variety"],
        excerpts: [{ topicCode: "product_variety", polarity: "praise" as const, text: "good collection" }],
      })),
    ];
    const finding = discoverFindings(input({ reviews })).findings.find((item) => item.category === "recurring_issue" && item.topicCodes.includes("product_variety"));
    expect(finding?.reviewIds.sort()).toEqual(["c1", "c2"]);
    expect(finding?.explanation).toContain("2");
    expect(finding?.explanation.toLowerCase()).toContain("praise");
  });

  it("keeps one visit, a separate price complaint, praise in the same review, and rating-only reviews apart", () => {
    const reviews = [
      review({
        id: "variety-staff",
        locationId: locationA,
        stars: 2,
        issues: ["product_variety"],
        praise: ["staff_politeness"],
        excerpts: [
          { topicCode: "product_variety", polarity: "complaint", text: "Kidswear and Menswear selections are very limited." },
          { topicCode: "staff_politeness", polarity: "praise", text: "Staffs were so supportive and pleasing." },
        ],
      }),
      review({
        id: "variety-price",
        locationId: locationA,
        stars: 2,
        issues: ["product_variety", "price"],
        excerpts: [
          { topicCode: "product_variety", polarity: "complaint", text: "Limited collections." },
          { topicCode: "price", polarity: "complaint", text: "Not value for money." },
        ],
      }),
      review({
        id: "variety-quality",
        locationId: locationA,
        stars: 1,
        issues: ["product_variety", "product_quality"],
        excerpts: [
          { topicCode: "product_variety", polarity: "complaint", text: "there were no trendy collections available" },
          { topicCode: "product_quality", polarity: "complaint", text: "Some of the jeans were damaged" },
        ],
      }),
      review({
        id: "billing",
        locationId: locationA,
        stars: 1,
        issues: ["billing_delay", "queue_time", "staff_politeness"],
        excerpts: [
          { topicCode: "staff_politeness", polarity: "complaint", text: "The billing staff showed poor behavior." },
          { topicCode: "queue_time", polarity: "complaint", text: "There was no proper queue management." },
          { topicCode: "billing_delay", polarity: "complaint", text: "my turn was ignored while another customer was billed ahead of me." },
        ],
      }),
      review({
        id: "lipstick",
        locationId: locationA,
        stars: 1,
        issues: ["product_quality"],
        excerpts: [{ topicCode: "product_quality", polarity: "complaint", text: "The lipstick I bought lacks quantity and quality." }],
      }),
      review({ id: "silent-1", locationId: locationA, stars: 2, overall: "negative" }),
      review({ id: "silent-2", locationId: locationA, stars: 1, overall: "negative" }),
      review({ id: "silent-3", locationId: locationA, stars: 2, overall: "negative" }),
    ];
    const findings = discoverFindings(input({ reviews })).findings;
    const variety = findings.find((item) => item.topicCodes.includes("product_variety") && item.explanation.includes("selections are very limited"));
    const price = findings.find((item) => item.topicCodes.includes("price"));
    const billing = findings.find((item) => item.topicCodes.includes("billing_delay"));
    const quality = findings.find((item) => item.topicCodes.includes("product_quality"));
    const silent = findings.find((item) => item.title === "Low-star reviews with no stated complaint");
    expect(variety?.reviewIds.sort()).toEqual(["variety-price", "variety-quality", "variety-staff"]);
    expect(variety?.explanation).toContain("selections are very limited");
    expect(variety?.explanation).toContain("Staff politeness");
    expect(price?.reviewIds).toEqual(["variety-price"]);
    expect(price?.explanation).toContain("Not value for money.");
    expect(price?.title).toContain("in one review");
    expect(billing?.reviewIds).toEqual(["billing"]);
    expect(billing?.explanation).toContain("billed ahead");
    expect(billing?.action).toContain("Investigate");
    expect(quality?.reviewIds.sort()).toEqual(["lipstick", "variety-quality"]);
    expect(quality?.explanation).toMatch(/damaged|lipstick/);
    expect(silent?.topicCodes).toEqual([]);
    expect(silent?.reviewIds.sort()).toEqual(["silent-1", "silent-2", "silent-3"]);
  });

  it("cites the sentence for the finding topic, not the first sentence on the review", () => {
    const excerpts = [
      { topicCode: "product_variety", polarity: "complaint" as const, text: "Collections are not that good." },
      { topicCode: "price", polarity: "complaint" as const, text: "rate is high." },
    ];
    expect(evidenceExcerpt(excerpts, ["price"], "recurring_issue")).toBe("rate is high.");
    expect(evidenceExcerpt(excerpts, ["product_quality"], "recurring_issue")).toBeNull();
  });

  it("finds a complaint concentrated in one outlet and keeps the other outlet out of the evidence", () => {
    const reviews = [
      ...["a1", "a2", "a3", "a4"].map((id) => review({ id, locationId: locationA, issues: ["cleanliness"] })),
      ...["b1", "b2", "b3", "b4"].map((id) => review({ id, locationId: locationB, issues: [], stars: 5, overall: "positive" })),
    ];
    const report = discoverFindings(input({ reviews }));
    const finding = report.findings.find((item) => item.category === "anomaly");
    expect(finding?.topicCodes).toEqual(["cleanliness"]);
    expect(finding?.locationIds).toEqual([locationA]);
    expect(finding?.reviewIds.sort()).toEqual(["a1", "a2", "a3", "a4"]);
    expect(finding?.metrics.find((item) => item.key === "review_count")?.value).toBe(8);
    expect(finding && claimsMatch(finding, input({ reviews }))).toBe(true);
  });

  it("requires a baseline before calling a complaint new, and labels a rise as a count comparison", () => {
    const reviews = [
      review({ id: "c1", locationId: locationA, issues: ["billing_delay"] }),
      review({ id: "c2", locationId: locationA, issues: ["billing_delay"] }),
      review({ id: "c3", locationId: locationB, issues: ["billing_delay"] }),
      review({ id: "d1", locationId: locationA, stars: 5, overall: "positive" }),
      review({ id: "d2", locationId: locationB, stars: 5, overall: "positive" }),
      review({ id: "d3", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const emerged = discoverFindings(input({ reviews, previous: reviews.map((item) => ({ ...item, id: `${item.id}-old`, issues: [] })) }));
    expect(emerged.findings.some((item) => item.category === "emerging_topic")).toBe(true);
    expect(emerged.findings.some((item) => /new operational problem/.test(item.explanation) && item.quality === "supported")).toBe(false);
    const one = discoverFindings(input({
      reviews: [review({ id: "only", locationId: locationA, issues: ["billing_delay"] }), review({ id: "x", locationId: locationB, stars: 5 }), review({ id: "y", locationId: locationB, stars: 5 })],
      previous: [],
    }));
    expect(one.findings.some((item) => item.category === "emerging_topic")).toBe(false);
  });

  it("keeps praise, a stable rating with more complaints, location differences, clusters, and repeat periods distinct", () => {
    const praise = discoverFindings(input({
      reviews: [
        review({ id: "p1", locationId: locationA, stars: 5, overall: "positive", praise: ["staff_politeness"], issues: [] }),
        review({ id: "p2", locationId: locationA, stars: 5, overall: "positive", praise: ["staff_politeness"], issues: [] }),
        review({ id: "p3", locationId: locationB, stars: 4, overall: "positive", issues: [] }),
      ],
    }));
    const driver = praise.findings.find((item) => item.category === "positive_driver");
    expect(driver?.topicCodes).toEqual(["staff_politeness"]);
    expect(driver?.action ?? "").not.toMatch(/will improve|will raise/);

    const driftReviews = [
      ...["n1", "n2", "n3"].map((id) => review({ id, locationId: locationA, issues: ["queue_time"] })),
      ...["n4", "n5"].map((id) => review({ id, locationId: locationB, issues: ["queue_time"] })),
      review({ id: "m1", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const previous = [
      ...["o1", "o2"].map((id) => review({ id, locationId: locationA, issues: ["queue_time"] })),
      review({ id: "o3", locationId: locationB, issues: ["queue_time"] }),
    ];
    const driftInput = input({ reviews: driftReviews, previous });
    driftInput.summary = {
      ...driftInput.summary,
      changes: driftInput.summary.changes
        ? { ...driftInput.summary.changes, averageRatingDelta: 0.05 }
        : null,
    };
    const drift = discoverFindings(driftInput).findings.find((item) => /stayed near the same/.test(item.title));
    expect(drift?.metrics.find((item) => item.key === "average_rating_delta")?.value).toBe(0.05);

    const locations = [
      ...["l1", "l2", "l3", "l4"].map((id) => review({ id, locationId: locationA, issues: ["parking"] })),
      ...["r1", "r2", "r3"].map((id) => review({ id, locationId: locationB, stars: 5, overall: "positive" })),
    ];
    expect(discoverFindings(input({ reviews: locations })).findings.some((item) => item.category === "location_comparison")).toBe(true);

    const clustered = [
      review({ id: "k1", locationId: locationA, issues: [], clusterIds: ["cluster-1"] }),
      review({ id: "k2", locationId: locationB, issues: [], clusterIds: ["cluster-1"] }),
      review({ id: "k3", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const clusterFinding = discoverFindings(input({
      reviews: clustered,
      clusters: [{ id: "cluster-1", title: "Cleanliness · Fitting-room experience", topicKey: "cleanliness+fitting_room", reviewIds: ["k1", "k2"] }],
    })).findings.find((item) => item.clusterIds.includes("cluster-1"));
    expect(clusterFinding?.reviewIds.sort()).toEqual(["k1", "k2"]);

    const again = [
      ...["u1", "u2"].map((id) => review({ id, locationId: locationA, issues: ["exchange"] })),
      ...["v1", "v2"].map((id) => review({ id, locationId: locationB, issues: ["exchange"] })),
    ];
    const prior = [
      ...["u3", "u4"].map((id) => review({ id, locationId: locationA, issues: ["exchange"] })),
      ...["v3", "v4"].map((id) => review({ id, locationId: locationB, issues: ["exchange"] })),
    ];
    expect(discoverFindings(input({ reviews: again, previous: prior })).findings.some((item) => item.category === "recurring_issue")).toBe(true);
  });

  it("returns insufficient data, drops foreign reviews, and rejects invented numbers", () => {
    const thin = discoverFindings(input({
      reviews: [
        review({ id: "t1", locationId: locationA, issues: ["price"] }),
        review({ id: "t2", locationId: locationB, stars: 5 }),
      ],
    }));
    expect(thin.insufficient).toBe(true);
    expect(thin.findings).toEqual([]);

    const foreign = review({ id: "nope", locationId: outside, workspaceId: "99999999-9999-9999-9999-999999999999", issues: ["price"] });
    const scoped = [
      review({ id: "s1", locationId: locationA, issues: ["price"] }),
      review({ id: "s2", locationId: locationA, issues: ["price"] }),
      review({ id: "s3", locationId: locationB, stars: 5, overall: "positive" }),
      review({ id: "s4", locationId: locationB, stars: 5, overall: "positive" }),
    ];
    const mixed = discoverFindings(input({ reviews: [...scoped, foreign] }));
    expect(mixed.findings.every((item) => !item.reviewIds.includes("nope"))).toBe(true);

    const finding = mixed.findings[0];
    expect(finding).toBeTruthy();
    const kept = applyModelProse(finding!, {
      explanation: "This issue is in 40% of reviews and will improve the rating.",
    }, "gemini-3.5-flash-lite");
    expect(kept.explanation).toBe(finding!.explanation);
    expect(kept.model).toBe(finding!.model);
    const accepted = applyModelProse(finding!, { explanation: `Read these ${finding!.evidenceCount} reviews.` }, "gemini-3.5-flash-lite");
    expect(accepted.explanation).toContain(String(finding!.evidenceCount));
    expect(accepted.model).toBe("gemini-3.5-flash-lite");
  });

  it("saves a report, retrieves it, and hides a stale version", () => {
    const reviews = [
      ...["a1", "a2"].map((id) => review({ id, locationId: locationA, issues: ["cleanliness"] })),
      ...["b1", "b2"].map((id) => review({ id, locationId: locationB, stars: 5, overall: "positive" })),
    ];
    const draft = discoverFindings(input({ reviews }));
    const memory = new Map<string, StoredInsight>();
    const created = planInsightWrite([], draft.sourceHash, false, false);
    expect(created.action).toBe("create");
    const stored: StoredInsight = { id: "report-1", sourceHash: draft.sourceHash, version: created.version, status: "ready", findings: draft.findings };
    memory.set(stored.id, stored);
    const again = planInsightWrite([...memory.values()], draft.sourceHash, false, false);
    expect(again.action).toBe("reuse");
    expect(presentInsight(memory.get(again.id!)!)?.findings[0]?.reviewIds.length).toBeGreaterThan(0);
    const forced = planInsightWrite([...memory.values()], draft.sourceHash, true, false);
    expect(forced.action).toBe("create");
    expect(forced.version).toBe(2);
    expect(planInsightWrite([...memory.values()], draft.sourceHash, true, true).action).toBe("processing");
    memory.set(stored.id, { ...stored, status: "stale" });
    expect(presentInsight(memory.get(stored.id)!)).toBeNull();
  });

  it("does not report the catch-all topic Other as a pattern", () => {
    const praise = Array.from({ length: 20 }, (_, index) =>
      review({ id: `p${index}`, locationId: locationA, stars: 5, overall: "positive", praise: ["staff_politeness"] })
    );
    const bucket = Array.from({ length: 6 }, (_, index) =>
      review({ id: `o${index}`, locationId: locationB, stars: 1, overall: "negative", issues: ["other"] })
    );
    const happyBucket = Array.from({ length: 4 }, (_, index) =>
      review({ id: `h${index}`, locationId: locationA, stars: 5, overall: "positive", issues: ["other"] })
    );
    const titles = discoverFindings(input({ reviews: [...praise, ...bucket, ...happyBucket] })).findings.map((item) => item.title);
    expect(titles.some((title) => /^other\b/i.test(title))).toBe(false);
  });
});
