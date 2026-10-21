import { describe, expect, it } from "vitest";
import { managementScans, type ScanFinding, type ScanOutlet } from "@/lib/intelligence/management-scans";

function finding(partial: Partial<ScanFinding> & Pick<ScanFinding, "category" | "title" | "evidenceCount">): ScanFinding {
  return {
    explanation: "",
    topicCodes: [],
    locationIds: ["outlet-a"],
    ...partial,
  };
}

const outlets: ScanOutlet[] = [
  { name: "Angamaly", reviews: 850, rating: 4.54, low: 92 },
  { name: "Tripunithura", reviews: 758, rating: 4.84, low: 17 },
  { name: "Kottayam", reviews: 302, rating: 4.82, low: 12 },
  { name: "Kollam", reviews: 945, rating: 4.77, low: 41 },
  { name: "Kalpetta", reviews: 2, rating: 4.5, low: 0 },
];

describe("management scans", () => {
  it("separates the outlet gap from its cause and keeps small complaints from becoming policy", () => {
    const findings: ScanFinding[] = [
      finding({
        category: "rating_drag",
        title: "Product variety complaints average 2.27 stars",
        explanation: "They say: “poor collection” “The store has a very limited collection.” 15 reviews complain about Product variety.",
        evidenceCount: 15,
        topicCodes: ["product_variety"],
        locationIds: ["a", "b", "c", "d", "e", "f"],
        metrics: [{ key: "topic_average_rating", value: 2.27 }, { key: "low_star_reviews", value: 10 }],
      }),
      finding({
        category: "positive_driver",
        title: "Product variety shows up in strong reviews",
        evidenceCount: 675,
        topicCodes: ["product_variety"],
      }),
      finding({
        category: "customer_request",
        title: "Customers are asking: \"Need more collection\"",
        evidenceCount: 3,
      }),
      finding({
        category: "rating_drag",
        title: "Staff politeness complaints average 1 stars",
        explanation: "They say: “The billing staff showed poor behavior and lacked basic customer respect.”",
        evidenceCount: 7,
        topicCodes: ["staff_politeness"],
        locationIds: ["a", "b", "c", "d", "e"],
        metrics: [{ key: "topic_average_rating", value: 1 }, { key: "low_star_reviews", value: 7 }],
      }),
      finding({
        category: "positive_driver",
        title: "Staff politeness shows up in strong reviews",
        evidenceCount: 1029,
        topicCodes: ["staff_politeness"],
      }),
      finding({
        category: "rare_severe",
        title: "Billing delays is rare but severe here",
        explanation: "They say: “my turn was ignored while another customer was billed ahead of me.”",
        evidenceCount: 3,
        topicCodes: ["billing_delay"],
        locationIds: ["a", "b", "c"],
        metrics: [{ key: "topic_average_rating", value: 1 }, { key: "low_star_reviews", value: 3 }],
      }),
      finding({
        category: "rare_severe",
        title: "Exchange policy is rare but severe here",
        explanation: "They say: “they said there was no refund and that they could only provide a voucher”",
        evidenceCount: 2,
        topicCodes: ["exchange"],
        locationIds: ["a", "b"],
        metrics: [{ key: "topic_average_rating", value: 1 }],
      }),
      finding({
        category: "staff_mention",
        title: "Customers name \"Amal\" to thank the staff",
        explanation: "Customers name \"Amal\" to thank the staff. 19 of these reviews were written at one outlet. That is the store to manage.",
        evidenceCount: 20,
        metrics: [{ key: "staff_praise_reviews", value: 20 }, { key: "staff_complaint_reviews", value: 0 }],
      }),
      finding({
        category: "recurring_issue",
        title: "Low-star reviews with no stated complaint",
        explanation: "336 reviews are 1–3 stars and have no complaint quotation.",
        evidenceCount: 25,
      }),
    ];
    const scans = managementScans({ reviews: 6234, lowStars: 402, outlets, findings });
    const anomaly = scans.find((scan) => scan.id === "outlet-anomaly");
    expect(anomaly?.title).toContain("Angamaly");
    expect(anomaly?.evidence.join(" ")).toContain("about 5 times");
    expect(anomaly?.check).toContain("The cause is not");
    expect(anomaly?.action).not.toMatch(/staffing is/);

    const assortment = scans.find((scan) => scan.id === "assortment");
    expect(assortment?.band).toBe("first");
    expect(assortment?.evidence.join(" ")).toContain("poor collection");
    expect(assortment?.evidence.join(" ")).toContain("675");
    expect(assortment?.check).toContain("Need more collection");

    const billing = scans.find((scan) => scan.id === "billing");
    expect(billing?.band).toBe("watch");
    expect(billing?.check).toContain("too few");

    const people = scans.find((scan) => scan.id === "recognition");
    expect(people?.evidence[0]).toContain("Amal");
    expect(people?.check).toContain("spellings");

    const practice = scans.find((scan) => scan.id === "best-practice");
    expect(practice?.evidence.map((line) => line.split(":")[0])).toEqual(["Tripunithura", "Kottayam", "Kollam"]);

    const limit = scans.find((scan) => scan.id === "coverage");
    expect(limit?.evidence.join(" ")).toContain("336");
    expect(scans.findIndex((scan) => scan.id === "outlet-anomaly")).toBeLessThan(scans.findIndex((scan) => scan.id === "coverage"));
  });

  it("skips an outlet comparison when the stores are too small to compare", () => {
    const scans = managementScans({
      reviews: 15,
      lowStars: 1,
      outlets: [{ name: "Only", reviews: 15, rating: 4.8, low: 1 }],
      findings: [],
    });
    expect(scans.map((scan) => scan.id)).not.toContain("outlet-anomaly");
  });
});
