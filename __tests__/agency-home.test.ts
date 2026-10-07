import { describe, expect, it } from "vitest";
import { buildAgencyHome } from "@/lib/services/agency-home";

const clients = [
  { id: "c1", name: "ACME Retail" },
  { id: "c2", name: "Gulf Gate Travels" },
];

const locations = [
  { id: "l1", clientId: "c1", isActive: true, title: "ACME Downtown" },
  { id: "l2", clientId: "c1", isActive: false, title: "ACME Mall" },
  { id: "l3", clientId: "c2", isActive: true, title: "Gulf Gate" },
];

const stats = [
  {
    location_id: "l1",
    review_count: 10,
    unanswered: 2,
    approved: 1,
    critical: 3,
    rating_sum: 40,
    published: 6,
  },
  {
    location_id: "l2",
    review_count: 0,
    unanswered: 0,
    approved: 0,
    critical: 0,
    rating_sum: 0,
    published: 0,
  },
];

describe("buildAgencyHome", () => {
  it("rolls client ratings, reply rate, and connection state", () => {
    const home = buildAgencyHome({
      clients,
      locations,
      stats,
      hasConnection: true,
      rangeCounts: [{ location_id: "l1", review_count: 4 }],
      rangeLabel: "Last month",
      clientId: "",
      q: "",
      page: 1,
    });

    const acme = home.rows.find((row) => row.id === "c1");
    const gulf = home.rows.find((row) => row.id === "c2");

    expect(acme).toMatchObject({
      locations: 2,
      rating: 4,
      replyRate: 80,
      unreplied: 2,
      escalations: 3,
      connection: "attention",
      attentionCount: 1,
    });
    expect(gulf).toMatchObject({
      locations: 1,
      rating: null,
      replyRate: null,
      connection: "connected",
    });
    expect(home.kpis).toMatchObject({
      clients: 2,
      locations: 3,
      unreplied: 2,
      waitingApproval: 1,
      connectionProblems: 1,
    });
    expect(home.usage.find((row) => row.id === "c1")?.reviews).toBe(4);
    expect(home.usageHeading).toBe("Usage · last month");
    expect(home.hasPublished).toBe(true);
  });

  it("matches a client from a location title and marks a missing connection as waiting", () => {
    const home = buildAgencyHome({
      clients,
      locations,
      stats,
      hasConnection: false,
      rangeLabel: "All time",
      clientId: "",
      q: "mall",
      page: 1,
    });

    expect(home.rows.map((row) => row.id)).toEqual(["c1"]);
    expect(home.rows[0]?.connection).toBe("waiting");
    expect(home.usage[0]?.reviews).toBe(10);
  });
});
