import { describe, expect, it } from "vitest";
import { renderTextPdf } from "@/lib/report-pdf";
import {
  channelOptions,
  connectionHits,
  latestDelivery,
  legalSafetyHits,
  negativeReviewHits,
  nextDelivery,
  ratingDropHits,
  reportWindow,
  reviewBurstHits,
  type ScheduleSpec,
} from "@/lib/reporting";

const daily: ScheduleSpec = {
  frequency: "daily",
  hour: 9,
  minute: 0,
  weekday: null,
  dayOfMonth: null,
  timezone: "Asia/Kolkata",
};

describe("report schedules", () => {
  it("uses the workspace timezone for the next delivery", () => {
    const before = nextDelivery(new Date("2026-10-16T03:00:00.000Z"), daily);
    const after = nextDelivery(new Date("2026-10-16T04:00:00.000Z"), daily);
    expect(before.toISOString()).toBe("2026-10-16T03:30:00.000Z");
    expect(after.toISOString()).toBe("2026-10-17T03:30:00.000Z");
  });

  it("covers the previous slot and stops at this one", () => {
    const slot = new Date("2026-10-16T03:30:00.000Z");
    const window = reportWindow(slot, daily);
    expect(window.end.toISOString()).toBe(slot.toISOString());
    expect(window.start.toISOString()).toBe("2026-10-15T03:30:00.000Z");
    expect(latestDelivery(new Date("2026-10-16T04:00:00.000Z"), daily)?.toISOString()).toBe(slot.toISOString());
  });

  it("keeps a winter US Eastern delivery at 14:00 UTC", () => {
    const next = nextDelivery(new Date("2026-01-15T13:00:00.000Z"), {
      ...daily,
      timezone: "America/New_York",
    });
    expect(next.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
});

describe("alert rules", () => {
  it("records one key per location and window for negative reviews", () => {
    const hits = negativeReviewHits({
      rows: [
        { locationId: "loc", locationName: "East Fort", lowStars: 3 },
        { locationId: "other", locationName: "gympod", lowStars: 1 },
      ],
      threshold: 3,
      windowKey: "2026-10-15",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.dedupeKey).toBe("loc:2026-10-15");
  });

  it("ignores a rating drop when either window is too small", () => {
    expect(
      ratingDropHits({
        rows: [
          {
            locationId: "loc",
            locationName: "East Fort",
            currentAvg: 3,
            currentCount: 2,
            previousAvg: 5,
            previousCount: 10,
          },
        ],
        dropPoints: 0.5,
        minReviews: 5,
        windowKey: "2026-10-01",
      })
    ).toEqual([]);
  });

  it("does not call a first-time location an unusual burst", () => {
    expect(
      reviewBurstHits({
        rows: [{ locationId: "loc", locationName: "East Fort", currentCount: 12, previousCount: 0 }],
        multiplier: 2,
        minReviews: 5,
        windowKey: "2026-10-01",
      })
    ).toEqual([]);
  });

  it("matches legal or safety words and an expired connection once", () => {
    const legal = legalSafetyHits({
      reviews: [
        {
          reviewId: "rev",
          locationId: "loc",
          locationName: "East Fort",
          comment: "I will speak to a lawyer.",
          starRating: 1,
        },
      ],
    });
    expect(legal[0]?.dedupeKey).toBe("rev");
    const connections = connectionHits({
      connections: [{ id: "c1", email: "owner@example.com", status: "active", updatedAt: "2026-10-01T00:00:00.000Z" }],
    });
    expect(connections).toEqual([]);
  });
});

describe("delivery channels", () => {
  it("leaves email, Slack, and WhatsApp unavailable until they are configured", () => {
    const options = channelOptions({
      brevoApiKey: null,
      reportFromEmail: null,
      slackWebhookUrl: null,
      whatsappToken: null,
      whatsappPhoneNumberId: null,
    });
    expect(options.find((item) => item.id === "in_app")?.available).toBe(true);
    expect(options.filter((item) => item.id !== "in_app").every((item) => item.available === false)).toBe(true);
  });

  it("writes a PDF that names the report", () => {
    const bytes = renderTextPdf("Weekly scorecard", ["Reviews: 5", "Average rating: 5.00"]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Weekly scorecard");
    expect(text).toContain("Reviews: 5");
  });
});
