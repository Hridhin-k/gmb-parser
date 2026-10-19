import { describe, expect, it } from "vitest";
import {
  AUTOMATION_DEFAULTS,
  automationVerdict,
  hasQuestionOrComplaint,
  localPreview,
  resolveAutomation,
  resolveTone,
  withinPostingWindow,
} from "@/lib/automation";

const ready = {
  ...AUTOMATION_DEFAULTS,
  enabled: true,
  shadowMode: false,
  holdbackMinutes: 0,
  dailyCap: 10,
};

const now = new Date("2026-10-16T08:00:00.000Z");
const old = new Date("2026-10-15T08:00:00.000Z");

function verdict(settings = ready, extra: Partial<Parameters<typeof automationVerdict>[0]> = {}) {
  return automationVerdict({
    settings,
    stars: 5,
    comment: "Lovely staff and a quick visit.",
    createdAt: old,
    now,
    paused: false,
    publishedToday: 0,
    timeZone: "Asia/Kolkata",
    ...extra,
  });
}

describe("automation rules", () => {
  it("refuses to post a negative review", () => {
    const result = verdict(ready, { stars: 2, comment: "The wait was too long." });
    expect(result.publish).toBe(false);
    expect(result.draft).toBe(false);
    expect(result.reasons[0]).toMatch(/person/);
  });

  it("keeps shadow mode from publishing", () => {
    const result = verdict({ ...ready, shadowMode: true });
    expect(result.draft).toBe(true);
    expect(result.publish).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/Shadow mode/);
  });

  it("stops the run when automation is paused", () => {
    const result = verdict(ready, { paused: true });
    expect(result.draft).toBe(false);
    expect(result.publish).toBe(false);
  });

  it("skips a question and enforces the cap, window, and holdback", () => {
    expect(hasQuestionOrComplaint("Can you open earlier?", 5)).toBe(true);
    expect(verdict(ready, { comment: "Can you open earlier?" }).publish).toBe(false);
    expect(verdict(ready, { publishedToday: 10 }).publish).toBe(false);
    expect(verdict({ ...ready, windowStart: "09:00", windowEnd: "11:00" }, { now: new Date("2026-10-16T02:00:00.000Z") }).publish).toBe(false);
    expect(verdict(ready, { createdAt: now, settings: { ...ready, holdbackMinutes: 60 } }).publish).toBe(false);
  });

  it("posts only when every condition is clear", () => {
    expect(verdict().publish).toBe(true);
    expect(withinPostingWindow(now, null, null, "Asia/Kolkata")).toBe(true);
  });

  it("lets a brand override replace the organization and a clear restore it", () => {
    const inherited = resolveTone([
      { label: "ACME Fashion", fields: { greeting: "Hi" } },
      { label: "the organization", fields: { greeting: "Hello", warmth: "formal" } },
    ]);
    expect(inherited.greeting.overridden).toBe(true);
    expect(inherited.greeting.value).toBe("Hi");
    expect(inherited.warmth.value).toBe("formal");
    expect(inherited.warmth.overridden).toBe(false);
    const cleared = resolveAutomation([
      { label: "ACME Fashion", fields: null },
      { label: "the organization", fields: { dailyCap: 3 } },
    ]);
    expect(cleared.dailyCap.value).toBe(3);
    expect(cleared.dailyCap.overridden).toBe(false);
  });

  it("blocks a preview that promises compensation", () => {
    const preview = localPreview({
      tone: { greeting: "Hi", signoff: "", warmth: "friendly", length: "brief", languages: ["en"], neverSay: [], spellings: [] },
      template: "We will refund {name}.",
      reviewerName: "Anjali",
      locationName: "Lulu Mall",
      comment: "Thanks",
    });
    expect(preview.violations.length).toBeGreaterThan(0);
  });
});
