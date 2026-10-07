import { describe, expect, it } from "vitest";
import {
  emptyAnalysis,
  parseLocationInsightPayload,
} from "@/lib/services/location-insights";

const sample = {
  summary: "This cafe is loved for coffee and blamed for slow weekend waits.",
  sentiment: "mixed",
  themes: ["coffee", "wait times"],
  highlights: ["Baristas remember regulars"],
  risks: ["Saturday queue"],
  branding: {
    voice: "Warm neighbourhood cafe",
    strengths: ["Specialty coffee"],
    gaps: ["Photos look dated"],
  },
  staff: {
    summary: "Named baristas get praise; weekend cover feels rushed.",
    praise: ["Maya is mentioned twice"],
    issues: ["Counter staff skip greetings at peak"],
  },
  customerFeedback: {
    loves: ["Flat white"],
    friction: ["20 minute wait"],
    requests: ["Online ordering"],
  },
  operations: {
    summary: "Weekdays smooth, weekends overloaded.",
    notes: ["Opens later than listed on Sundays"],
  },
  suggestedFeatures: [
    {
      title: "Add a weekend waitlist",
      why: "Customers complain about standing in line",
      basedOn: "Several 3-star reviews mention 20 minute waits",
      effort: "medium",
    },
    {
      title: "Refresh listing photos",
      why: "Brand looks older than the space reviewers describe",
      basedOn: "Praise for interior vs old Google photos implied by comments",
      effort: "quick",
    },
  ],
  replyPlaybook: {
    tone: "Warm and specific, never defensive about waits",
    do: ["Name the drink they mentioned"],
    avoid: ["Promise skip-the-line unless you can"],
  },
};

describe("parseLocationInsightPayload", () => {
  it("parses a full briefing", () => {
    const parsed = parseLocationInsightPayload(JSON.stringify(sample));
    expect(parsed.sentiment).toBe("mixed");
    expect(parsed.analysis.branding.voice).toContain("neighbourhood");
    expect(parsed.analysis.staff.praise[0]).toContain("Maya");
    expect(parsed.analysis.customerFeedback.requests).toEqual(["Online ordering"]);
    expect(parsed.analysis.suggestedFeatures).toHaveLength(2);
    expect(parsed.analysis.suggestedFeatures[0].effort).toBe("medium");
    expect(parsed.analysis.replyPlaybook.avoid[0]).toMatch(/skip-the-line/);
  });

  it("strips markdown fences and unknown sentiment", () => {
    const parsed = parseLocationInsightPayload(
      "```json\n" + JSON.stringify({ ...sample, sentiment: "ecstatic" }) + "\n```"
    );
    expect(parsed.sentiment).toBe("neutral");
  });

  it("drops incomplete feature rows and caps lists", () => {
    const parsed = parseLocationInsightPayload(
      JSON.stringify({
        ...sample,
        suggestedFeatures: [
          { title: "", why: "no title" },
          { title: "Only title" },
          { title: "Valid", why: "Because reviews asked", effort: "huge" },
        ],
      })
    );
    expect(parsed.analysis.suggestedFeatures).toHaveLength(1);
    expect(parsed.analysis.suggestedFeatures[0].effort).toBe("medium");
  });
});

describe("emptyAnalysis", () => {
  it("has no invented features", () => {
    expect(emptyAnalysis().suggestedFeatures).toEqual([]);
    expect(emptyAnalysis().staff.praise).toEqual([]);
  });
});
