import { describe, expect, it } from "vitest";
import { pendingExtractions, storedModelNeedsReread, summaryWindowMonths, summaryWindowStart } from "@/lib/intelligence/backfill-plan";

describe("pendingExtractions", () => {
  const reviews = [
    { id: "old", fingerprint: "h1", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "new", fingerprint: "h2", createdAt: "2026-10-19T00:00:00.000Z" },
    { id: "mid", fingerprint: "h3", createdAt: "2026-06-01T00:00:00.000Z" },
    { id: "done", fingerprint: "h4", createdAt: "2026-10-20T00:00:00.000Z" },
    { id: "undated", fingerprint: "h5", createdAt: null },
  ];

  it("returns only reviews without a matching stored extraction, newest first", () => {
    const ready = new Set(["done|h4"]);
    expect(pendingExtractions(reviews, ready, 0).map((row) => row.id)).toEqual(["new", "mid", "old", "undated"]);
  });

  it("treats a changed fingerprint as pending again", () => {
    const ready = new Set(["new|stale-hash"]);
    expect(pendingExtractions(reviews, ready, 0).map((row) => row.id)).toContain("new");
  });

  it("bounds the run to the newest pending reviews", () => {
    expect(pendingExtractions(reviews, new Set(), 2).map((row) => row.id)).toEqual(["done", "new"]);
  });

  it("limits Fazyo’s update to the last six months and leaves other clients whole", () => {
    expect(summaryWindowMonths("Fazyo")).toBe(6);
    expect(summaryWindowMonths("  fazyo ")).toBe(6);
    expect(summaryWindowMonths("Fazyo (FAZ-TCR)")).toBeNull();
    expect(summaryWindowMonths("The Better Agency ®")).toBeNull();
    expect(summaryWindowStart(6, new Date("2026-10-21T16:00:00.000Z")).toISOString()).toBe("2026-04-21T16:00:00.000Z");
  });

  it("sends an older Gemini reading again and keeps rules and the current model", () => {
    expect(storedModelNeedsReread("gemini-3.5-flash-lite", "gemini-3.8-flash")).toBe(true);
    expect(storedModelNeedsReread("gemini-3.8-flash", "gemini-3.8-flash")).toBe(false);
    expect(storedModelNeedsReread("rules", "gemini-3.8-flash")).toBe(false);
    expect(storedModelNeedsReread("none", "gemini-3.8-flash")).toBe(false);
    expect(storedModelNeedsReread(undefined, "gemini-3.8-flash")).toBe(false);
  });
});
