import { describe, expect, it } from "vitest";
import { canOpenPath, scopedHref, scopeMode, shellAlerts, visibleNav } from "@/lib/shell";

describe("visibleNav", () => {
  it("hides management and billing from members", () => {
    expect(visibleNav("member")).toEqual([
      "overview",
      "inbox",
      "escalations",
      "analytics",
      "insights",
      "reports",
      "requests",
      "locations",
    ]);
  });

  it("lets an admin see the portfolio and not billing", () => {
    const items = visibleNav("admin");
    expect(items).toContain("clients");
    expect(items).toContain("team");
    expect(items).not.toContain("usage");
  });

  it("lets the owner see billing", () => {
    expect(visibleNav("owner")).toContain("usage");
  });
});

describe("canOpenPath", () => {
  it("sends members away from team, settings, audit, and all clients", () => {
    expect(canOpenPath("/team", "member")).toBe(false);
    expect(canOpenPath("/settings", "member")).toBe(false);
    expect(canOpenPath("/audit", "member")).toBe(false);
    expect(canOpenPath("/dashboard", "member")).toBe(false);
    expect(canOpenPath("/reviews", "member")).toBe(true);
    expect(canOpenPath("/escalations", "member")).toBe(true);
  });
});

describe("shellAlerts", () => {
  it("hides the settings link from members", () => {
    const summary = { unreplied: 2, escalations: 1, drafts: 0, expiredConnections: 3 };
    expect(shellAlerts(summary, "member").map((item) => item.id)).toEqual(["escalations", "unreplied"]);
    expect(shellAlerts(summary, "owner").map((item) => item.id)).toContain("connections");
  });

  it("names each profile a scoped person covers and keeps a personal notice", () => {
    const summary = {
      unreplied: 4,
      escalations: 1,
      drafts: 2,
      failed: 1,
      expiredConnections: 0,
      notices: [{ id: "n1", title: "Fazyo Thrissur: 1 new review.", href: "/reviews?location=l1" }],
      profiles: [
        { id: "l1", name: "Fazyo Thrissur", unreplied: 3, escalations: 1, drafts: 0, failed: 0 },
        { id: "l2", name: "Fazyo Irinjalakuda", unreplied: 1, escalations: 0, drafts: 2, failed: 1 },
      ],
    };
    const alerts = shellAlerts(summary, "member");
    expect(alerts.map((item) => item.id)).toEqual(["notice:n1", "profile:l1", "profile:l2"]);
    expect(alerts[1]?.href).toBe("/escalations?location=l1");
    expect(alerts[2]?.href).toBe("/reviews?location=l2&filter=failed");
    expect(alerts[1]?.title).toContain("Fazyo Thrissur");
    expect(alerts.some((item) => item.id === "unreplied")).toBe(false);
  });
});

describe("scopedHref", () => {
  it("keeps the overview default of 12 months when opening the inbox", () => {
    expect(scopedHref("/reviews", new URLSearchParams(), "/overview")).toBe("/reviews?range=12m");
  });

  it("carries the client and leaves team URLs alone", () => {
    const current = new URLSearchParams("client=c1&range=3m&q=staff");
    expect(scopedHref("/analytics", current, "/reviews")).toBe("/analytics?client=c1&range=3m");
    expect(scopedHref("/team", current, "/reviews")).toBe("/team");
  });

  it("carries the organisation, group, and outlet onto the next review screen", () => {
    const current = new URLSearchParams("client=c1&group=g1&location=l1&range=12m&rating=2");
    expect(scopedHref("/reviews", current, "/overview")).toBe("/reviews?client=c1&group=g1&location=l1&range=12m");
    expect(scopedHref("/analytics", current, "/overview")).toBe("/analytics?client=c1&group=g1&location=l1&range=12m");
  });

  it("keeps a profile already named on the alert", () => {
    const current = new URLSearchParams("client=c1&location=other&range=12m");
    expect(scopedHref("/reviews?location=l1&filter=unanswered", current, "/overview")).toBe(
      "/reviews?location=l1&filter=unanswered&client=c1&range=12m"
    );
  });

  it("drops the date range on review-request links", () => {
    const current = new URLSearchParams("client=c1&range=12m");
    expect(scopeMode("/requests")).toBe("client");
    expect(scopedHref("/requests", current, "/overview")).toBe("/requests?client=c1");
  });
});
