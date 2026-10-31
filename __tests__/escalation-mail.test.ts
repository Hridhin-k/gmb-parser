import { describe, expect, it } from "vitest";
import { resolutionMail, resolutionMailTargets, summarizeMailSends } from "@/lib/escalation-mail";

describe("resolution mail", () => {
  it("emails the resolution address and copies an assignee who asked for email", () => {
    expect(
      resolutionMailTargets({
        contactEmail: "care@example.com",
        assigneeEmail: "store@example.com",
        assigneeWantsEmail: true,
      })
    ).toEqual([
      { email: "care@example.com", role: "resolution_contact" },
      { email: "store@example.com", role: "assignee" },
    ]);
  });

  it("does not copy the assignee twice when they are the resolution address", () => {
    expect(
      resolutionMailTargets({
        contactEmail: "care@example.com",
        assigneeEmail: "Care@example.com",
        assigneeWantsEmail: true,
      })
    ).toEqual([{ email: "care@example.com", role: "resolution_contact" }]);
  });

  it("falls back to the assignee when no resolution address is saved", () => {
    expect(
      resolutionMailTargets({
        contactEmail: null,
        assigneeEmail: "store@example.com",
        assigneeWantsEmail: false,
      })
    ).toEqual([{ email: "store@example.com", role: "assignee" }]);
  });

  it("writes the callback request without claiming the call was placed", () => {
    const message = resolutionMail({
      code: "apology_callback",
      ticketNo: 12,
      reviewerName: "Ada",
      starRating: 1,
      locationName: "Harbour Store",
      comment: "The order was late.",
      note: "Call after 4pm.",
      phone: "+91 98470 00000",
      caseUrl: "https://example.com/escalations/case-1",
    });
    expect(message.subject).toBe("ESC-12 · Apology and callback");
    expect(message.text).toContain("This email does not place the call.");
    expect(message.text).toContain("Call after 4pm.");
    expect(message.text).toContain("https://example.com/escalations/case-1");
  });

  it("reports who received the message", () => {
    expect(
      summarizeMailSends([
        { email: "care@example.com", status: "sent", detail: "Accepted by the email provider." },
        { email: "store@example.com", status: "failed", detail: "Brevo: blocked" },
      ])
    ).toEqual({
      status: "sent",
      recipients: ["care@example.com"],
      detail: "Email sent to care@example.com. store@example.com did not send.",
    });
    expect(summarizeMailSends([])).toMatchObject({ status: "no_recipient", recipients: [] });
  });
});
