import { describe, expect, it } from "vitest";
import { extractionPrompt } from "@/lib/intelligence/extract-prompt";
import {
  ExtractionRejected,
  bindAssignments,
  buildRatingOnlyExtraction,
  excerptComplainsAboutPrice,
  extractFromReview,
  shouldReuseExtraction,
  validateModelExtraction,
} from "@/lib/intelligence/extraction";

const positive = "The staff were polite and the fitting room was easy to use.";
const negative = "The billing queue was slow and the floor was dirty.";
const mixed = "Staff were polite, but the queue was far too long.";

describe("review extraction", () => {
  it("keeps praise, complaints, and several topics, and ignores a repeated phrase", () => {
    const polite = validateModelExtraction({
      comment: positive,
      starRating: 5,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "staff_politeness", polarity: "praise", excerpt: "staff were polite", confidence: 0.9 },
          { topicCode: "fitting_room", polarity: "praise", excerpt: "fitting room was easy to use", confidence: 0.6 },
        ],
      }),
    });
    expect(polite.interpretation.textSentiment).toBe("positive");
    expect(polite.interpretation.overall).toBe("positive");
    expect(polite.facts.quotations.map((item) => item.topicCode)).toEqual(["staff_politeness", "fitting_room"]);
    expect(polite.facts.quotations[0]?.rank).toBe("primary");
    expect(polite.facts.quotations[1]?.rank).toBe("secondary");

    const complaint = validateModelExtraction({
      comment: negative,
      starRating: 2,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "billing queue", polarity: "complaint", excerpt: "billing queue", confidence: 0.8 },
          { topicCode: "hygiene", polarity: "complaint", excerpt: "dirty", confidence: 0.7 },
        ],
        severity: "moderate",
      }),
    });
    expect(complaint.facts.quotations.map((item) => item.topicCode)).toEqual(["billing_delay", "cleanliness"]);
    expect(complaint.interpretation.textSentiment).toBe("negative");
    expect(complaint.facts.rating.band).toBe("low");

    const both = validateModelExtraction({
      comment: mixed,
      starRating: 3,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "staff_politeness", polarity: "praise", excerpt: "Staff were polite", confidence: 0.8 },
          { topicCode: "queue", polarity: "complaint", excerpt: "the queue was far too long", confidence: 0.8 },
          { topicCode: "queue_time", polarity: "complaint", excerpt: "the queue was far too long", confidence: 0.2 },
        ],
      }),
    });
    expect(both.interpretation.textSentiment).toBe("mixed");
    expect(both.interpretation.overall).toBe("mixed");
    expect(both.facts.quotations).toHaveLength(2);
    expect(both.repaired).toBe(true);
  });

  it("keeps a low rating distinct from positive text", () => {
    const result = validateModelExtraction({
      comment: "The staff were kind.",
      starRating: 1,
      modelText: JSON.stringify({
        textSentiment: "negative",
        aspects: [{ topicCode: "staff_politeness", polarity: "praise", excerpt: "staff were kind", confidence: 0.8 }],
      }),
    });
    expect(result.facts.rating.band).toBe("low");
    expect(result.interpretation.textSentiment).toBe("positive");
    expect(result.interpretation.overall).toBe("mixed");
  });

  it("does not invent a theme for a rating-only review or for sarcasm without a quotation", () => {
    const ratingOnly = extractFromReview({ comment: null, starRating: 5, modelText: "{\"aspects\":[{\"topicCode\":\"staff_politeness\",\"polarity\":\"praise\",\"excerpt\":\"great\"}]}" });
    expect(ratingOnly.facts.quotations).toEqual([]);
    expect(ratingOnly.interpretation.textSentiment).toBe("unknown");
    expect(ratingOnly.interpretation.overall).toBe("unknown");
    expect(ratingOnly.facts.rating.band).toBe("high");
    expect(buildRatingOnlyExtraction(4).facts.language).toBe("none");

    const sarcastic = validateModelExtraction({
      comment: "Yeah, wonderful.",
      starRating: 1,
      modelText: JSON.stringify({
        textSentiment: "positive",
        uncertain: true,
        aspects: [{ topicCode: "staff_politeness", polarity: "praise", excerpt: "not in the review", confidence: 0.9 }],
      }),
    });
    expect(sarcastic.facts.quotations).toEqual([]);
    expect(sarcastic.interpretation.textSentiment).toBe("unknown");
    expect(sarcastic.interpretation.uncertain).toBe(true);
    expect(sarcastic.repaired).toBe(true);
  });

  it("accepts a quotation in another language and drops an excerpt that is not in the review", () => {
    const comment = "സ്റ്റാഫ് വളരെ മര്യാദയുള്ളവരായിരുന്നു";
    const result = validateModelExtraction({
      comment,
      starRating: 5,
      modelText: JSON.stringify({
        aspects: [{ topicCode: "staff_politeness", polarity: "praise", excerpt: "മര്യാദ", confidence: 0.7 }],
      }),
    });
    expect(result.facts.language).toBe("ml");
    expect(result.facts.quotations).toHaveLength(1);

    const unknown = validateModelExtraction({
      comment: "☺☺☺",
      starRating: 4,
      modelText: JSON.stringify({
        aspects: [{ topicCode: "price", polarity: "complaint", excerpt: "expensive", confidence: 0.9 }],
      }),
    });
    expect(unknown.facts.language).toBe("other");
    expect(unknown.facts.quotations).toEqual([]);
    expect(unknown.interpretation.textSentiment).toBe("unknown");
  });

  it("drops a stated price and keeps a complaint that the rate is high", () => {
    const paid = "I purchased 3 tshirts each 899 is the price all are complaint and very poor quality after 1st wash";
    const stated = validateModelExtraction({
      comment: paid,
      starRating: 1,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "product_quality", polarity: "complaint", excerpt: "very poor quality after 1st wash", confidence: 1 },
          { topicCode: "price", polarity: "complaint", excerpt: "each 899 is the price", confidence: 0.9 },
        ],
      }),
    });
    expect(stated.repaired).toBe(true);
    expect(stated.facts.quotations.map((item) => item.topicCode)).toEqual(["product_quality"]);

    const rated = "Collections are not that good. but the rate is high.";
    const complaint = validateModelExtraction({
      comment: rated,
      starRating: 1,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "product_variety", polarity: "complaint", excerpt: "Collections are not that good.", confidence: 0.9 },
          { topicCode: "price", polarity: "complaint", excerpt: "rate is high.", confidence: 0.9 },
        ],
      }),
    });
    expect(complaint.facts.quotations.map((item) => item.topicCode).sort()).toEqual(["price", "product_variety"]);
    expect(excerptComplainsAboutPrice("High price")).toBe(true);
    expect(excerptComplainsAboutPrice("Not value for money.")).toBe(true);
    expect(excerptComplainsAboutPrice("each 899 is the price")).toBe(false);
  });

  it("rejects malformed JSON and repairs an unknown topic without storing the raw text", () => {
    expect(() => validateModelExtraction({ comment: positive, starRating: 5, modelText: "not json" })).toThrow(ExtractionRejected);
    const repaired = validateModelExtraction({
      comment: positive,
      starRating: 5,
      modelText: JSON.stringify({
        essay: "The model wrote a paragraph that must not be trusted.",
        aspects: [
          { topicCode: "made_up", polarity: "praise", excerpt: "staff were polite" },
          { topicCode: "staff_politeness", polarity: "praise", excerpt: "staff were polite", confidence: 4 },
        ],
        entities: [{ kind: "staff_role", label: "owner@example.com", excerpt: "staff were polite" }],
      }),
    });
    expect(repaired.facts.quotations).toHaveLength(1);
    expect(repaired.interpretation.entities).toEqual([]);
    expect(JSON.stringify(repaired)).not.toContain("must not be trusted");
    expect(repaired.facts.quotations[0]?.confidence).toBe(0.5);
  });

  it("treats null model fields as absent instead of rejecting the review", () => {
    const result = validateModelExtraction({
      comment: positive,
      starRating: 5,
      modelText: JSON.stringify({
        aspects: [
          { topicCode: "staff_politeness", polarity: "praise", excerpt: "staff were polite", confidence: null, uncertain: null },
        ],
        severity: null,
        urgency: null,
        escalation: null,
        entities: null,
        actionable: null,
        uncertain: null,
        note: null,
        textSentiment: null,
      }),
    });
    expect(result.facts.quotations).toHaveLength(1);
    expect(result.facts.quotations[0]?.confidence).toBe(0.5);
    expect(result.interpretation.note).toBe("");
  });

  it("binds every assignment to the source review and analysis version", () => {
    const extraction = validateModelExtraction({
      comment: negative,
      starRating: 2,
      modelText: JSON.stringify({
        aspects: [{ topicCode: "billing queue", polarity: "complaint", excerpt: "billing queue", confidence: 0.4 }],
      }),
    });
    const rows = bindAssignments({
      workspaceId: "ws-a",
      reviewId: "rev-a",
      comment: negative,
      extraction,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: "ws-a",
      reviewId: "rev-a",
      analysisVersion: "extract-v2",
      topicCode: "billing_delay",
      excerpt: "billing queue",
    });
    expect(negative.includes(rows[0]!.excerpt)).toBe(true);
    expect(() =>
      bindAssignments({
        workspaceId: "ws-b",
        reviewId: "rev-b",
        comment: "A different tenant review",
        extraction,
      })
    ).toThrow(/not in this review/);
  });

  it("reuses a current record only when the content hash and versions match", () => {
    expect(
      shouldReuseExtraction(
        {
          contentHash: "abc",
          analysisVersion: "extract-v2",
          taxonomyVersion: "taxonomy-v2",
          promptVersion: "extract-v2",
          status: "ready",
          isCurrent: true,
        },
        "abc"
      )
    ).toBe(true);
    expect(
      shouldReuseExtraction(
        {
          contentHash: "abc",
          analysisVersion: "rules-v1",
          taxonomyVersion: "taxonomy-v1",
          promptVersion: "rules-v1",
          status: "ready",
          isCurrent: true,
        },
        "abc"
      )
    ).toBe(false);
  });

  it("does not put a reviewer name in the extraction prompt", () => {
    const prompt = extractionPrompt({ comment: positive, starRating: 5, language: "en" });
    expect(prompt).toContain("staff_politeness");
    expect(prompt).not.toContain("displayName");
    expect(prompt).toContain(positive);
  });
});
