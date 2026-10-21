import { describe, expect, it } from "vitest";
import { buildRulesExtraction } from "@/lib/intelligence/rules-extraction";

describe("rules extraction", () => {
  it("classifies a praised collection without a model call", () => {
    const result = buildRulesExtraction("Good collection and friendly staff", 5);
    expect(result.covered).toBe(true);
    expect(result.reason).toBe("topic_match");
    expect(result.extraction.facts.quotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicCode: "product_variety", polarity: "praise" }),
        expect.objectContaining({ topicCode: "staff_politeness", polarity: "praise" }),
      ])
    );
    expect(result.extraction.interpretation.overall).toBe("positive");
  });

  it("reads a price complaint and a wash complaint from clauses", () => {
    const high = buildRulesExtraction("High price", 3);
    expect(high.extraction.facts.quotations[0]).toMatchObject({ topicCode: "price", polarity: "complaint" });
    const wash = buildRulesExtraction("I purchased 3 tshirts, all are complaint and very poor quality after 1st wash", 1);
    expect(wash.covered).toBe(true);
    expect(wash.extraction.facts.quotations.some((item) => item.topicCode === "product_quality" && item.polarity === "complaint")).toBe(true);
    expect(wash.extraction.interpretation.severity).toBe("moderate");
  });

  it("does not turn a star rating into a topic complaint", () => {
    const bare = buildRulesExtraction("Billing", 1);
    expect(bare.extraction.facts.quotations.some((item) => item.polarity === "complaint")).toBe(false);
    const variety = buildRulesExtraction("Collections are not that good.", 5);
    expect(variety.extraction.facts.quotations.some((item) => item.topicCode === "product_variety" && item.polarity === "complaint")).toBe(true);
  });

  it("does not count a stated price inside a quality complaint, and does count a high rate", () => {
    const paid = buildRulesExtraction("I purchased 3 tshirts each 899 is the price all are complaint and very poor quality after 1st wash", 1);
    expect(paid.extraction.facts.quotations.some((item) => item.topicCode === "product_quality")).toBe(true);
    expect(paid.extraction.facts.quotations.some((item) => item.topicCode === "price")).toBe(false);
    const rate = buildRulesExtraction("Collections are not that good. but the rate is high.", 1);
    expect(rate.extraction.facts.quotations.some((item) => item.topicCode === "price" && item.polarity === "complaint" && item.excerpt.toLowerCase().includes("rate is high"))).toBe(true);
  });

  it("flips a negated praise phrase", () => {
    const result = buildRulesExtraction("Trial room was not clean", 2);
    expect(result.extraction.facts.quotations.some((item) => item.topicCode === "cleanliness" && item.polarity === "complaint")).toBe(true);
  });

  it("treats a one-word reaction as covered with no topic", () => {
    const result = buildRulesExtraction("Super", 5);
    expect(result.covered).toBe(true);
    expect(result.reason).toBe("short_without_topic");
    expect(result.extraction.facts.quotations).toEqual([]);
  });

  it("sends a long unmatched review to the residue batch", () => {
    const result = buildRulesExtraction(
      "We visited on a Sunday evening with the whole family and spent a long time walking around every floor before heading home",
      4
    );
    expect(result.covered).toBe(false);
    expect(result.reason).toBe("residue");
  });

  it("keeps every excerpt inside the original comment", () => {
    const comment = "Billing counter took forever. Dress collection is superb";
    const result = buildRulesExtraction(comment, 4);
    expect(result.extraction.facts.quotations.length).toBeGreaterThan(0);
    for (const quotation of result.extraction.facts.quotations) {
      expect(comment.includes(quotation.excerpt)).toBe(true);
    }
  });
});
