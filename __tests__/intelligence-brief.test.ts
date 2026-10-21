import { describe, expect, it } from "vitest";
import {
  briefAllowedNumbers,
  briefClaimsClean,
  briefNumbersAllowed,
  deterministicBrief,
  reconcileBriefLists,
} from "@/lib/intelligence/brief";
import type { SummaryDocument } from "@/lib/intelligence/summary-aggregate";

function documentFixture(): SummaryDocument {
  return {
    analysisVersion: "summary-v1",
    taxonomyVersion: "taxonomy-v2",
    schemaVersion: "intelligence-schema-v1",
    promptVersion: "summary-v1",
    model: "none",
    scopeType: "organisation",
    scopeId: "client-1",
    range: { kind: "all", start: null, end: null, timezone: "Asia/Kolkata", label: "All time", comparison: null },
    coverage: { reviewCount: 12007, extractedCount: 4994, unextractedCount: 7013, locationCount: 10 },
    metrics: { averageRating: 4.716, negativeShare: 0.08, ratingDenominator: 12007 },
    sentiment: { denominator: 4994, positive: 4600, negative: 210, mixed: 90, neutral: 94, unknown: 0 },
    topics: [{ code: "product_variety", label: "Product variety", reviews: 252, share: 0.021 }],
    issues: [{ code: "parking", label: "Parking", reviews: 14, share: 0.0012 }],
    praise: [
      { code: "staff_politeness", label: "Staff politeness", reviews: 300 },
      { code: "product_variety", label: "Product variety", reviews: 202 },
    ],
    months: [{ month: "2026-09", count: 410 }],
    changes: null,
    locations: [{ locationId: "loc-1", reviewCount: 5000, averageRating: 4.8 }],
    clusters: { clusterCount: 0, memberReviewCount: 0 },
    evidence: [{ reviewId: "r1", excerpt: "Staff were polite", topicCode: "staff_politeness", polarity: "praise" }],
    metricKeys: ["review_count", "average_rating", "negative_share"],
    sourceHash: "hash",
  } as SummaryDocument;
}

describe("insight report brief", () => {
  it("builds a deterministic brief from counted summary facts", () => {
    const brief = deterministicBrief(documentFixture());
    expect(brief.model).toBe("none");
    expect(brief.summary).toContain("12007 reviews counted");
    expect(brief.summary).toContain("4.72");
    expect(brief.summary).toContain("staff politeness (300 reviews)");
    expect(brief.highlights[0]).toContain("Staff politeness");
    expect(brief.highlights[0]).toContain("praised in");
    expect(brief.risks[0]).toContain("Parking");
    expect(brief.risks[0]).toContain("complaints in");
  });

  it("keeps complaint counts when the same topic is also praised", () => {
    const { highlights, risks } = reconcileBriefLists(
      [
        "Staff politeness: 2197 reviews",
        "Product variety: 1409 reviews",
        "Price: 354 reviews",
        "Other: 276 reviews",
      ],
      [
        "Product variety: 44 reviews",
        "Staff politeness: 24 reviews",
        "Product quality: 18 reviews",
        "Product availability: 13 reviews",
      ]
    );
    expect(highlights.map((line) => line.toLowerCase())).toEqual([
      "staff politeness — praised in 2,197 reviews",
      "product variety — praised in 1,409 reviews",
      "price — praised in 354 reviews",
    ]);
    expect(risks).toEqual([
      "Product variety — complaints in 44 reviews",
      "Staff politeness — complaints in 24 reviews",
      "Product quality — complaints in 18 reviews",
      "Product availability — complaints in 13 reviews",
    ]);
  });

  it("allows only numbers present in the summary, with rounded forms", () => {
    const allowed = briefAllowedNumbers(documentFixture());
    expect(briefNumbersAllowed(["12,007 reviews at 4.72 average, 8% low-star"], allowed)).toBe(true);
    expect(briefNumbersAllowed(["Staff politeness appears in 300 reviews"], allowed)).toBe(true);
    expect(briefNumbersAllowed(["Parking complaints jumped to 900 reviews"], allowed)).toBe(false);
    expect(briefNumbersAllowed(["Average rating is 3.10"], allowed)).toBe(false);
  });

  it("counts outlets as outlets with reviews, not the scope size", () => {
    // Fixture: 10 outlets in scope, only 1 location with reviews.
    const allowed = briefAllowedNumbers(documentFixture());
    expect(briefNumbersAllowed(["reviews across 1 outlets"], allowed)).toBe(true);
    expect(briefNumbersAllowed(["reviews across 10 outlets"], allowed)).toBe(false);
  });

  it("ignores zero-review locations in the outlet count", () => {
    // The org projection lists every location, including empty ones:
    // 7 locations listed, only 3 with reviews.
    const doc = {
      ...documentFixture(),
      locations: [
        { locationId: "loc-1", reviewCount: 5000, averageRating: 4.8 },
        { locationId: "loc-2", reviewCount: 4000, averageRating: 4.7 },
        { locationId: "loc-3", reviewCount: 3007, averageRating: 4.6 },
        { locationId: "loc-4", reviewCount: 0, averageRating: null },
        { locationId: "loc-5", reviewCount: 0, averageRating: null },
        { locationId: "loc-6", reviewCount: 0, averageRating: null },
        { locationId: "loc-7", reviewCount: 0, averageRating: null },
      ],
    } as SummaryDocument;
    const allowed = briefAllowedNumbers(doc);
    expect(briefNumbersAllowed(["reviews across 3 outlets"], allowed)).toBe(true);
    expect(briefNumbersAllowed(["reviews across 7 outlets"], allowed)).toBe(false);
  });

  it("rejects banned claims in brief wording", () => {
    expect(briefClaimsClean("A steady pattern across locations.")).toBe(true);
    expect(briefClaimsClean("This will improve the rating.")).toBe(false);
    expect(briefClaimsClean("The change is statistically significant.")).toBe(false);
  });
});
