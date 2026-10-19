import { describe, expect, it } from "vitest";
import { buildAgencyHome } from "@/lib/services/agency-home";

const clients = [
  { id: "c1", name: "ACME Retail", manager: "ada@example.com", directConnection: null },
  { id: "c2", name: "Gulf Gate Travels", manager: null, directConnection: null },
];

const locations = [
  { id: "l1", clientId: "c1", title: "ACME Downtown", connection: "active" as const },
  { id: "l2", clientId: "c1", title: "ACME Mall", connection: "problem" as const },
  { id: "l3", clientId: "c2", title: "Gulf Gate", connection: "active" as const },
];

const stats = [
  {
    location_id: "l1",
    review_count: 10,
    unanswered: 2,
    approved: 1,
    critical: 3,
    open_escalations: 2,
    client_approvals: 1,
    rating_sum: 40,
    published: 6,
  },
  {
    location_id: "l2",
    review_count: 0,
    unanswered: 0,
    approved: 0,
    critical: 0,
    open_escalations: 0,
    client_approvals: 0,
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
      escalations: 2,
      clientApprovals: 1,
      manager: "ada@example.com",
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
      openEscalations: 2,
      connectionProblems: 1,
    });
    expect(home.usage.find((row) => row.id === "c1")?.reviews).toBe(4);
    expect(home.usage.find((row) => row.id === "c1")?.publishedReplies).toBe(0);
    expect(home.usageHeading).toBe("Usage · last month");
    expect(home.hasPublished).toBe(true);
  });

  it("matches a client from a location title and keeps a problem connection", () => {
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
    expect(home.rows[0]?.connection).toBe("attention");
    expect(home.usage[0]?.reviews).toBe(10);
  });
});
