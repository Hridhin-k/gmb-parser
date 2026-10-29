import { describe, expect, it } from "vitest";
import { mailConfigured, parseMailSender, readMailEnv } from "@/lib/mail";
import { channelOptions, readDeliveryEnv } from "@/lib/reporting";
import { readRequestEnv, requestChannelOptions } from "@/lib/review-requests";

describe("parseMailSender", () => {
  it("reads bare and named from addresses", () => {
    expect(parseMailSender("reports@example.com")).toEqual({ email: "reports@example.com" });
    expect(parseMailSender("RevuPilot <reports@example.com>")).toEqual({
      email: "reports@example.com",
      name: "RevuPilot",
    });
  });
});

describe("Brevo env wiring", () => {
  it("marks mail configured only when Brevo key and from are set", () => {
    expect(mailConfigured(readMailEnv({}))).toBe(false);
    expect(
      mailConfigured(
        readMailEnv({
          BREVO_API_KEY: "xkeysib-test",
          REPORT_FROM_EMAIL: "reports@example.com",
        })
      )
    ).toBe(true);
  });

  it("enables report and request email channels from BREVO_API_KEY", () => {
    const delivery = readDeliveryEnv({
      BREVO_API_KEY: "xkeysib-test",
      REPORT_FROM_EMAIL: "reports@example.com",
    });
    expect(channelOptions(delivery).find((item) => item.id === "email")?.available).toBe(true);

    const requests = readRequestEnv({
      BREVO_API_KEY: "xkeysib-test",
      REPORT_FROM_EMAIL: "reports@example.com",
    });
    expect(requestChannelOptions(requests).find((item) => item.id === "email")?.available).toBe(true);
  });

  it("ignores legacy RESEND_API_KEY", () => {
    const delivery = readDeliveryEnv({
      RESEND_API_KEY: "re_legacy",
      REPORT_FROM_EMAIL: "reports@example.com",
    });
    expect(channelOptions(delivery).find((item) => item.id === "email")?.available).toBe(false);
  });
});
