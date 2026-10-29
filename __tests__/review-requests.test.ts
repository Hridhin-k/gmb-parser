import { describe, expect, it } from "vitest";
import { qrSvg } from "@/lib/request-qr";
import {
  classifyCustomers,
  countsAsDelivered,
  countsAsSent,
  customerKey,
  customerPageModel,
  pageCopy,
  parseCustomerCsv,
  phoneMatchKey,
  providerOutcome,
  renderTemplate,
  requestChannelOptions,
  requestMetricCells,
  type RequestEnv,
} from "@/lib/review-requests";

const emptyEnv: RequestEnv = {
  brevoApiKey: null,
  fromEmail: null,
  whatsappToken: null,
  whatsappPhoneNumberId: null,
  twilioSid: null,
  twilioToken: null,
  twilioFrom: null,
  twilioMessagingService: null,
  brevoWebhookSecret: null,
  whatsappAppSecret: null,
};

describe("request channels", () => {
  it("keeps WhatsApp, SMS, and email unavailable until a provider is configured", () => {
    const options = requestChannelOptions(emptyEnv);
    expect(options.find((item) => item.id === "whatsapp")?.available).toBe(false);
    expect(options.find((item) => item.id === "sms")?.available).toBe(false);
    expect(options.find((item) => item.id === "email")?.available).toBe(false);
    expect(options.find((item) => item.id === "qr")?.available).toBe(true);
  });
});

describe("customer identity", () => {
  it("treats a local number and a country-code number as the same phone", () => {
    expect(phoneMatchKey("+91 98470 11122")).toBe(phoneMatchKey("9847011122"));
    expect(customerKey(null, "+91 98470 11122")).toBe("phone:9847011122");
  });

  it("prefers email when both are present", () => {
    expect(customerKey("A@Example.com", "9847011122")).toBe("email:a@example.com");
  });
});

describe("csv and suppression", () => {
  const csv = [
    "name,phone,store code",
    "Anjali,9847011122,LULU",
    "Anjali,+91 98470 11122,LULU",
    "No contact,,",
    "Other,9000000000,MISSING",
    "Old,9111111111,LULU",
    "Stopped,9222222222,LULU",
  ].join("\n");

  it("dedupes, suppresses the 90-day window, and drops unknown stores", () => {
    const rows = parseCustomerCsv(csv);
    const classified = classifyCustomers(
      rows,
      [{ id: "loc-1", storeCode: "LULU" }],
      [
        { key: "phone:9111111111", phoneKey: "9111111111", email: null, acceptedAt: new Date().toISOString(), optedOut: false },
        { key: "phone:9222222222", phoneKey: "9222222222", email: null, acceptedAt: null, optedOut: true },
      ],
      new Date("2026-10-16T00:00:00Z"),
      90,
      ["loc-1"]
    );
    expect(classified.map((row) => row.outcome)).toEqual([
      "eligible",
      "duplicate",
      "missing_contact",
      "unknown_store",
      "suppressed",
      "opted_out",
    ]);
  });

  it("allows a request once the window has passed", () => {
    const rows = parseCustomerCsv("name,email,store code\nAna,a@b.com,LULU");
    const classified = classifyCustomers(
      rows,
      [{ id: "loc-1", storeCode: "lulu" }],
      [{ key: "email:a@b.com", phoneKey: null, email: "a@b.com", acceptedAt: "2026-01-01T00:00:00Z", optedOut: false }],
      new Date("2026-10-16T00:00:00Z"),
      90,
      ["loc-1"]
    );
    expect(classified[0]?.outcome).toBe("eligible");
  });
});

describe("delivery status", () => {
  it("does not treat a queued provider response as delivered", () => {
    const outcome = providerOutcome(201, "queued");
    expect(outcome.state).toBe("accepted");
    expect(outcome.delivered).toBe(false);
    expect(countsAsSent({ acceptedAt: "2026-10-16T00:00:00Z", isTest: false })).toBe(true);
    expect(countsAsDelivered({ deliveredAt: null, isTest: false })).toBe(false);
  });

  it("counts a delivery only after the provider confirms it", () => {
    expect(providerOutcome(200, "delivered").delivered).toBe(true);
    expect(countsAsDelivered({ deliveredAt: "2026-10-16T00:00:00Z", isTest: false })).toBe(true);
    expect(countsAsSent({ acceptedAt: null, isTest: false })).toBe(false);
  });
});

describe("customer page", () => {
  it("shows Google and private feedback to everyone", () => {
    const unhappy = customerPageModel("en", "Lulu Mall", "https://search.google.com/local/writereview?placeid=abc");
    const noPlace = customerPageModel("en", "Lulu Mall", null);
    expect(unhappy.showGoogle).toBe(true);
    expect(unhappy.showPrivate).toBe(true);
    expect(unhappy.asksForRating).toBe(false);
    expect(noPlace.showGoogle).toBe(true);
    expect(noPlace.showPrivate).toBe(true);
  });

  it("adds an opt-out line when the template omits one", () => {
    const text = renderTemplate("Hello {name}", "en", {
      name: "Ana",
      location: "Lulu",
      link: "https://example.com/r/abc",
      optout: "https://example.com/r/abc#stop",
    });
    expect(text).toContain("https://example.com/r/abc#stop");
    expect(text).toContain("Ana");
  });

  it("provides feedback failure copy for each language", () => {
    expect(pageCopy("en", "Lulu").feedbackFailed.length).toBeGreaterThan(10);
    expect(pageCopy("ml", "Lulu").feedbackFailed.length).toBeGreaterThan(10);
    expect(pageCopy("hi", "Lulu").feedbackFailed.length).toBeGreaterThan(10);
  });
});

describe("metrics", () => {
  it("labels missing receipts and does not invent Google review attribution", () => {
    const cells = requestMetricCells({
      sent: 2,
      delivered: 0,
      opened: 0,
      clicked: 1,
      feedback: 1,
      optedOut: 0,
      deliveryReceipts: false,
      openReceipts: false,
    });
    expect(cells.find((cell) => cell.id === "delivered")?.value).toBe("Not confirmed");
    expect(cells.find((cell) => cell.id === "opened")?.value).toBe("Not confirmed");
    expect(cells.find((cell) => cell.id === "google")?.value).toBe("Not available");
    expect(cells.find((cell) => cell.id === "sent")?.value).toBe("2");
    expect(cells.find((cell) => cell.id === "feedback")?.value).toBe("1");
  });
});

describe("qr", () => {
  it("draws a code for the location page", () => {
    const svg = qrSvg("https://example.com/r/abc");
    expect(svg.startsWith("<svg") || svg.includes("<svg")).toBe(true);
    expect(svg).toContain("<rect");
  });
});
