import { z } from "zod";
import { ESCALATION_TIMEZONES, type EscalationTimezone, legalSafetyMatches } from "@/lib/escalations";
import { ValidationError } from "@/lib/errors";

export const REPORT_SECTIONS = [
  { id: "scorecard", label: "Scorecard" },
  { id: "trends", label: "Trends" },
  { id: "leaderboard", label: "Location leaderboard" },
  { id: "themes", label: "Themes" },
] as const;

export type ReportSectionId = (typeof REPORT_SECTIONS)[number]["id"];

export const REPORT_FREQUENCIES = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
] as const;

export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number]["id"];

export const ALERT_KINDS = [
  {
    id: "negative_reviews",
    label: "Several negative reviews",
    detail: "1–3 star reviews at one location reach the count inside the window.",
  },
  {
    id: "rating_drop",
    label: "Rating drop",
    detail: "The average falls by the chosen points against the previous window. Both windows need the minimum number of reviews.",
  },
  {
    id: "legal_safety",
    label: "Legal or safety keywords",
    detail: "A review mentions lawsuit, injury, police, or the other safety words used for escalations.",
  },
  {
    id: "connection_expired",
    label: "Expired Google connection",
    detail: "A Google connection is expired or revoked. Connections belong to the workspace, not to one location.",
  },
  {
    id: "review_burst",
    label: "Unusual review burst",
    detail: "The review count is at least the chosen multiple of the previous window. A location with no earlier reviews is not treated as unusual.",
  },
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number]["id"];

export const DELIVERY_CHANNELS = ["in_app", "email", "slack", "whatsapp"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface DeliveryEnv {
  resendApiKey: string | null;
  reportFromEmail: string | null;
  slackWebhookUrl: string | null;
  whatsappToken: string | null;
  whatsappPhoneNumberId: string | null;
}

export interface ChannelOption {
  id: DeliveryChannel;
  label: string;
  available: boolean;
  reason: string | null;
}

export function readDeliveryEnv(source: Record<string, string | undefined>): DeliveryEnv {
  const value = (key: string) => {
    const raw = source[key]?.trim();
    return raw ? raw : null;
  };
  return {
    resendApiKey: value("RESEND_API_KEY"),
    reportFromEmail: value("REPORT_FROM_EMAIL"),
    slackWebhookUrl: value("SLACK_WEBHOOK_URL"),
    whatsappToken: value("WHATSAPP_TOKEN"),
    whatsappPhoneNumberId: value("WHATSAPP_PHONE_NUMBER_ID"),
  };
}

export function channelOptions(env: DeliveryEnv): ChannelOption[] {
  const email = Boolean(env.resendApiKey && env.reportFromEmail);
  const slack = Boolean(env.slackWebhookUrl);
  const whatsapp = Boolean(env.whatsappToken && env.whatsappPhoneNumberId);
  return [
    {
      id: "in_app",
      label: "In GRM",
      available: true,
      reason: "Stored on this page. No outside message is sent.",
    },
    {
      id: "email",
      label: "Email",
      available: email,
      reason: email ? null : "No email provider is configured.",
    },
    {
      id: "slack",
      label: "Slack",
      available: slack,
      reason: slack ? "Posts to the configured workspace webhook." : "No Slack webhook is configured.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      available: false,
      reason: whatsapp
        ? "Recipients are email addresses. No phone number is stored for them."
        : "No WhatsApp provider is configured, and recipients have no phone number on file.",
    },
  ];
}

export interface ScheduleSpec {
  frequency: ReportFrequency;
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  timezone: EscalationTimezone;
}

export function parseDeliveryTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isReportTimezone(value: string): value is EscalationTimezone {
  return ESCALATION_TIMEZONES.some((item) => item.id === value);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY.indexOf(parts.weekday ?? ""),
  };
}

function addLocalDays(parts: ZonedParts, days: number): ZonedParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** UTC instant for a wall-clock time in the timezone. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = (ms: number) => {
    const parts = zonedParts(new Date(ms), timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - ms;
  };
  let ms = utcGuess - offsetAt(utcGuess);
  ms = utcGuess - offsetAt(ms);
  return new Date(ms);
}

function matches(day: ZonedParts, spec: ScheduleSpec): boolean {
  if (spec.frequency === "weekly") return day.weekday === spec.weekday;
  if (spec.frequency === "monthly") return day.day === spec.dayOfMonth;
  return true;
}

function instantOn(day: ZonedParts, spec: ScheduleSpec): Date {
  return zonedTimeToUtc(day.year, day.month, day.day, spec.hour, spec.minute, spec.timezone);
}

/** The next delivery strictly after `after`. */
export function nextDelivery(after: Date, spec: ScheduleSpec): Date {
  const start = zonedParts(after, spec.timezone);
  for (let offset = 0; offset < 400; offset += 1) {
    const day = addLocalDays(start, offset);
    if (!matches(day, spec)) continue;
    const instant = instantOn(day, spec);
    if (instant.getTime() > after.getTime()) return instant;
  }
  return new Date(after.getTime() + 86_400_000);
}

/** The latest delivery at or before `now`, if one exists in the lookback. */
export function latestDelivery(now: Date, spec: ScheduleSpec): Date | null {
  const start = zonedParts(now, spec.timezone);
  for (let offset = 0; offset < 62; offset += 1) {
    const day = addLocalDays(start, -offset);
    if (!matches(day, spec)) continue;
    const instant = instantOn(day, spec);
    if (instant.getTime() <= now.getTime()) return instant;
  }
  return null;
}

/** The window a delivery covers: the previous slot up to this slot, end exclusive. */
export function reportWindow(slot: Date, spec: ScheduleSpec): { start: Date; end: Date } {
  const parts = zonedParts(slot, spec.timezone);
  if (spec.frequency === "monthly") {
    const month = parts.month === 1 ? 12 : parts.month - 1;
    const year = parts.month === 1 ? parts.year - 1 : parts.year;
    return {
      start: zonedTimeToUtc(year, month, spec.dayOfMonth ?? 1, spec.hour, spec.minute, spec.timezone),
      end: slot,
    };
  }
  const days = spec.frequency === "weekly" ? 7 : 1;
  const prev = addLocalDays(parts, -days);
  return { start: instantOn(prev, spec), end: slot };
}

export function dayKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export interface AlertHit {
  dedupeKey: string;
  locationId: string | null;
  summary: string;
  evidence: Record<string, string | number | null>;
}

export function negativeReviewHits(input: {
  rows: Array<{ locationId: string; locationName: string; lowStars: number }>;
  threshold: number;
  windowKey: string;
}): AlertHit[] {
  return input.rows
    .filter((row) => row.lowStars >= input.threshold)
    .map((row) => ({
      dedupeKey: `${row.locationId}:${input.windowKey}`,
      locationId: row.locationId,
      summary: `${row.locationName} has ${row.lowStars} reviews rated 1–3 stars in this window (threshold ${input.threshold}).`,
      evidence: { lowStars: row.lowStars, threshold: input.threshold, window: input.windowKey },
    }));
}

export function ratingDropHits(input: {
  rows: Array<{
    locationId: string;
    locationName: string;
    currentAvg: number | null;
    currentCount: number;
    previousAvg: number | null;
    previousCount: number;
  }>;
  dropPoints: number;
  minReviews: number;
  windowKey: string;
}): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const row of input.rows) {
    if (row.currentCount < input.minReviews || row.previousCount < input.minReviews) continue;
    if (row.currentAvg === null || row.previousAvg === null) continue;
    const drop = row.previousAvg - row.currentAvg;
    if (drop + 1e-9 < input.dropPoints) continue;
    hits.push({
      dedupeKey: `${row.locationId}:${input.windowKey}`,
      locationId: row.locationId,
      summary: `${row.locationName} average fell from ${row.previousAvg.toFixed(2)} to ${row.currentAvg.toFixed(2)} (${row.currentCount} reviews, previous window ${row.previousCount}).`,
      evidence: {
        currentAvg: Number(row.currentAvg.toFixed(2)),
        previousAvg: Number(row.previousAvg.toFixed(2)),
        currentCount: row.currentCount,
        previousCount: row.previousCount,
        dropPoints: input.dropPoints,
        window: input.windowKey,
      },
    });
  }
  return hits;
}

export function reviewBurstHits(input: {
  rows: Array<{
    locationId: string;
    locationName: string;
    currentCount: number;
    previousCount: number;
  }>;
  multiplier: number;
  minReviews: number;
  windowKey: string;
}): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const row of input.rows) {
    if (row.previousCount <= 0) continue;
    if (row.currentCount < input.minReviews) continue;
    if (row.currentCount + 1e-9 < row.previousCount * input.multiplier) continue;
    hits.push({
      dedupeKey: `${row.locationId}:${input.windowKey}`,
      locationId: row.locationId,
      summary: `${row.locationName} has ${row.currentCount} reviews in this window, against ${row.previousCount} in the previous window.`,
      evidence: {
        currentCount: row.currentCount,
        previousCount: row.previousCount,
        multiplier: input.multiplier,
        window: input.windowKey,
      },
    });
  }
  return hits;
}

export function legalSafetyHits(input: {
  reviews: Array<{
    reviewId: string;
    locationId: string;
    locationName: string;
    comment: string | null;
    starRating: number;
  }>;
}): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const review of input.reviews) {
    const matched = legalSafetyMatches(review.comment);
    if (matched.length === 0) continue;
    hits.push({
      dedupeKey: review.reviewId,
      locationId: review.locationId,
      summary: `${review.locationName} has a ${review.starRating}-star review that mentions ${matched.join(", ")}.`,
      evidence: { reviewId: review.reviewId, starRating: review.starRating, matched: matched.join(", ") },
    });
  }
  return hits;
}

export function connectionHits(input: {
  connections: Array<{ id: string; email: string; status: string; updatedAt: string }>;
}): AlertHit[] {
  return input.connections
    .filter((connection) => connection.status === "expired" || connection.status === "revoked")
    .map((connection) => ({
      dedupeKey: `${connection.id}:${connection.status}:${connection.updatedAt}`,
      locationId: null,
      summary: `${connection.email} is ${connection.status}. This is a workspace connection.`,
      evidence: { connectionId: connection.id, status: connection.status, updatedAt: connection.updatedAt },
    }));
}

export interface ReportInput {
  name: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  sections: ReportSectionId[];
  frequency: ReportFrequency;
  deliveryTime: string;
  timezone: EscalationTimezone;
  weekday: number | null;
  dayOfMonth: number | null;
  recipients: string[];
  channels: DeliveryChannel[];
  enabled: boolean;
}

export interface AlertInput {
  name: string;
  kind: AlertKind;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  enabled: boolean;
  recipients: string[];
  channels: DeliveryChannel[];
  threshold: number;
  windowDays: number;
  minReviews: number;
  dropPoints: number;
  multiplier: number;
}

export function normalizeRecipients(emails: string[], allowed: string[]): string[] {
  const known = new Set(allowed.map((email) => email.toLowerCase()));
  const picked = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (picked.some((email) => !known.has(email))) {
    throw new ValidationError("Recipients have to be people in this workspace.");
  }
  return picked;
}

export function assertChannels(channels: DeliveryChannel[], env: DeliveryEnv): DeliveryChannel[] {
  const unique = [...new Set(channels)];
  if (!unique.includes("in_app")) unique.unshift("in_app");
  const options = channelOptions(env);
  for (const channel of unique) {
    const option = options.find((item) => item.id === channel);
    if (!option?.available) {
      throw new ValidationError(option?.reason ?? "Choose a channel that is available.");
    }
  }
  return unique;
}

export const REPORT_RETRY_LIMIT = 3;
export const REPORT_RETRY_MS = 15 * 60 * 1000;
export const REPORT_RUNNING_LOCK_MS = 10 * 60 * 1000;

const timezoneIds = ESCALATION_TIMEZONES.map((item) => item.id) as [EscalationTimezone, ...EscalationTimezone[]];

export const reportBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scope: z.enum(["workspace", "client", "group", "location"]),
    scopeId: z.string().uuid().nullable(),
    sections: z.array(z.enum(["scorecard", "trends", "leaderboard", "themes"])).min(1),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    deliveryTime: z.string().trim(),
    timezone: z.enum(timezoneIds),
    weekday: z.number().int().min(0).max(6).nullable(),
    dayOfMonth: z.number().int().min(1).max(28).nullable(),
    recipients: z.array(z.string().trim().max(320)).max(50),
    channels: z.array(z.enum(["in_app", "email", "slack", "whatsapp"])).min(1),
    enabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.scope !== "workspace" && !value.scopeId) {
      context.addIssue({ code: "custom", message: "Choose a brand, group, or location.", path: ["scopeId"] });
    }
    if (value.frequency === "weekly" && value.weekday === null) {
      context.addIssue({ code: "custom", message: "Choose a weekday.", path: ["weekday"] });
    }
    if (value.frequency === "monthly" && value.dayOfMonth === null) {
      context.addIssue({ code: "custom", message: "Choose a day of the month from 1 to 28.", path: ["dayOfMonth"] });
    }
    if (!parseDeliveryTime(value.deliveryTime)) {
      context.addIssue({ code: "custom", message: "Choose a delivery time.", path: ["deliveryTime"] });
    }
  });

export const alertBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["negative_reviews", "rating_drop", "legal_safety", "connection_expired", "review_burst"]),
    scope: z.enum(["workspace", "client", "group", "location"]),
    scopeId: z.string().uuid().nullable(),
    enabled: z.boolean(),
    recipients: z.array(z.string().trim().max(320)).max(50),
    channels: z.array(z.enum(["in_app", "email", "slack", "whatsapp"])).min(1),
    threshold: z.number().int().min(1).max(100),
    windowDays: z.number().int().min(1).max(90),
    minReviews: z.number().int().min(1).max(1000),
    dropPoints: z.number().min(0.1).max(5),
    multiplier: z.number().min(1.5).max(20),
  })
  .superRefine((value, context) => {
    if (value.scope !== "workspace" && !value.scopeId) {
      context.addIssue({ code: "custom", message: "Choose a brand, group, or location.", path: ["scopeId"] });
    }
  });

export function scopeFromBody(scope: "workspace" | "client" | "group" | "location", scopeId: string | null) {
  return {
    clientId: scope === "client" ? scopeId : null,
    groupId: scope === "group" ? scopeId : null,
    locationId: scope === "location" ? scopeId : null,
  };
}
