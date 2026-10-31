import { RESOLUTION_ACTIONS, ticketKey, type ResolutionCode } from "@/lib/escalations";

export type EscalationMailStatus = "sent" | "failed" | "unavailable" | "no_recipient";

export interface EscalationMailOutcome {
  status: EscalationMailStatus;
  recipients: string[];
  detail: string;
}

export interface ResolutionMailTarget {
  email: string;
  role: "resolution_contact" | "assignee";
}

const INSTRUCTION: Record<ResolutionCode, string> = {
  apology_callback: "Please call the reviewer and apologise. This email does not place the call.",
  replacement_arranged:
    "A replacement was recorded as the resolution. Follow up so the reviewer receives it. This email does not ship anything.",
  store_visit_scheduled:
    "A store visit was recorded as the resolution. Confirm the visit with the reviewer. This email does not book a calendar event.",
};

function cleanEmail(value: string | null | undefined): string | null {
  const email = value?.trim() ?? "";
  if (!email.includes("@")) return null;
  return email;
}

/**
 * The organisation resolution address always receives the message.
 * The assignee is copied when they asked for email. If no resolution address is saved,
 * the assignee is emailed so the request still leaves GRM.
 */
export function resolutionMailTargets(input: {
  contactEmail: string | null;
  assigneeEmail: string | null;
  assigneeWantsEmail: boolean;
}): ResolutionMailTarget[] {
  const targets: ResolutionMailTarget[] = [];
  const seen = new Set<string>();
  const add = (value: string | null, role: ResolutionMailTarget["role"]) => {
    const email = cleanEmail(value);
    if (!email) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ email, role });
  };
  add(input.contactEmail, "resolution_contact");
  if (input.assigneeWantsEmail || targets.length === 0) add(input.assigneeEmail, "assignee");
  return targets;
}

export function resolutionMail(input: {
  code: ResolutionCode;
  ticketNo: number | null;
  reviewerName: string;
  starRating: number;
  locationName: string;
  comment: string | null;
  note: string;
  phone: string | null;
  caseUrl: string;
}): { subject: string; text: string } {
  const label = RESOLUTION_ACTIONS.find((action) => action.id === input.code)?.label ?? "Resolution";
  const key = ticketKey(input.ticketNo);
  const comment = (input.comment ?? "").trim().slice(0, 1000);
  const note = input.note.trim();
  const lines = [
    `${key} was resolved as “${label}”.`,
    INSTRUCTION[input.code],
    "",
    `Reviewer: ${input.reviewerName} · ${input.starRating} stars`,
    `Location: ${input.locationName}`,
    comment ? `Review: ${comment}` : "Review: rating only, no written comment.",
  ];
  if (note) lines.push(`Note: ${note}`);
  if (input.phone) lines.push(`Resolution phone: ${input.phone}`);
  lines.push("", `Open the case: ${input.caseUrl}`);
  return {
    subject: `${key} · ${label}`,
    text: lines.join("\n"),
  };
}

export function reminderMail(input: {
  ticketNo: number | null;
  hours: string;
  reviewerName: string;
  locationName: string;
  caseUrl: string;
}): { subject: string; text: string } {
  const key = ticketKey(input.ticketNo);
  const hours = input.hours.trim() || "the scheduled";
  return {
    subject: `${key} · Reminder at ${hours} hours`,
    text: [
      `${key} is still open. This is the ${hours}-hour reminder.`,
      "",
      `Reviewer: ${input.reviewerName}`,
      `Location: ${input.locationName}`,
      "",
      `Open the case: ${input.caseUrl}`,
    ].join("\n"),
  };
}

export function summarizeMailSends(
  results: Array<{ email: string; status: "sent" | "failed" | "unavailable"; detail: string }>
): EscalationMailOutcome {
  if (results.length === 0) {
    return {
      status: "no_recipient",
      recipients: [],
      detail: "No resolution email is saved, and this case has no assignee email.",
    };
  }
  const sent = results.filter((item) => item.status === "sent");
  const failed = results.filter((item) => item.status === "failed");
  if (sent.length > 0) {
    const sentList = sent.map((item) => item.email).join(", ");
    const failedList = failed.map((item) => item.email).join(", ");
    return {
      status: "sent",
      recipients: sent.map((item) => item.email),
      detail: failedList ? `Email sent to ${sentList}. ${failedList} did not send.` : `Email sent to ${sentList}.`,
    };
  }
  if (failed.length > 0) {
    return {
      status: "failed",
      recipients: [],
      detail: failed[0]?.detail || "The email did not send.",
    };
  }
  return {
    status: "unavailable",
    recipients: [],
    detail: results[0]?.detail || "Email is not configured.",
  };
}

export function casePageUrl(escalationId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const path = `/escalations/${escalationId}`;
  return base ? `${base}${path}` : path;
}
