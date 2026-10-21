import { describe, expect, it } from "vitest";
import {
  deepDivePrompt,
  validateDeepDive,
  type DeepDiveFindingFacts,
} from "@/lib/intelligence/deep-dive";

const finding: DeepDiveFindingFacts = {
  title: "Product availability mentions average 3.43 stars",
  explanation: "23 reviews mention Product availability. Their average rating is 3.43 against the scope average of 4.72.",
  whyItMatters: "Availability drags ratings.",
  category: "rating_drag",
  evidenceCount: 24,
  sampleSize: 12007,
  metrics: [
    { key: "topic_average_rating", value: 3.43, sampleSize: 24, definition: "Sum of stars of reviews mentioning the topic, divided by that count." },
    { key: "low_star_reviews", value: 5, sampleSize: 24, definition: "Reviews among those counted that gave 1 or 2 stars." },
  ],
};

const NOW = "2026-10-21T10:00:00.000Z";

describe("finding deep dive", () => {
  it("keeps a dive whose numbers all come from the finding or the cited set", () => {
    const dive = validateDeepDive(
      {
        summary: "18 of 24 cited reviews describe sizes missing at the counter.",
        observations: ["5 of the cited reviews gave 1 or 2 stars.", "The topic averages 3.43 stars in the cited set."],
        action: "Check size restocking at the cited outlets.",
      },
      finding,
      24,
      "model-x",
      NOW
    );
    expect(dive?.summary).toContain("18 of 24");
    expect(dive?.observations).toHaveLength(2);
    expect(dive?.model).toBe("model-x");
  });

  it("discards a dive that invents a number", () => {
    const dive = validateDeepDive(
      {
        summary: "About 900 reviews complain about stock.",
        observations: ["Sizes are missing."],
        action: "Restock.",
      },
      finding,
      24,
      "model-x",
      NOW
    );
    expect(dive).toBeNull();
  });

  it("discards percentages and banned claims", () => {
    const percent = validateDeepDive(
      {
        summary: "75% of the cited reviews mention sizes.",
        observations: ["Sizes are missing."],
        action: "Restock.",
      },
      finding,
      24,
      "model-x",
      NOW
    );
    expect(percent).toBeNull();
    const banned = validateDeepDive(
      {
        summary: "Restocking will improve the rating.",
        observations: ["Sizes are missing."],
        action: "Restock.",
      },
      finding,
      24,
      "model-x",
      NOW
    );
    expect(banned).toBeNull();
  });

  it("requires a summary and at least one observation", () => {
    expect(validateDeepDive({ summary: "", observations: [], action: "" }, finding, 24, "m", NOW)).toBeNull();
    expect(validateDeepDive({ summary: "Sizes missing.", observations: [], action: "" }, finding, 24, "m", NOW)).toBeNull();
    expect(validateDeepDive(null, finding, 24, "m", NOW)).toBeNull();
  });

  it("prompts with only the cited reviews and the allowed numbers", () => {
    const prompt = deepDivePrompt(finding, [
      { stars: 2, location: "Outlet A", date: "2026-09-01", comment: "No medium sizes at all." },
    ]);
    expect(prompt).toContain("No medium sizes at all.");
    expect(prompt).toContain("3.43");
    expect(prompt).toContain("Never use percentages");
  });
});
