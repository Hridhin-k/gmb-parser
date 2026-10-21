import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/supabase";
import { AuditService } from "@/lib/services/audit";
import { getDashboardContext } from "@/lib/services/dashboard-metrics";
import { workspaceGrant } from "@/lib/access";
import { ensurePersonalWorkspace, getMemberRole } from "@/lib/services/workspace";
import { deliverMessage } from "@/lib/delivery";
import { renderTextPdf } from "@/lib/report-pdf";
import { ValidationError } from "@/lib/errors";
import { formatInTimezone, legalSafetyTerms } from "@/lib/escalations";
import { average, reviewWindow, share } from "@/lib/metrics";
import { themeLabel } from "@/lib/review-inbox";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { assertScopeTarget } from "@/lib/services/access";
import {
  ALERT_KINDS,
  connectionHits,
  dayKey,
  latestDelivery,
  legalSafetyHits,
  negativeReviewHits,
  nextDelivery,
  parseDeliveryTime,
  ratingDropHits,
  readDeliveryEnv,
  reportWindow,
  REPORT_RETRY_LIMIT,
  REPORT_RETRY_MS,
  REPORT_RUNNING_LOCK_MS,
  reviewBurstHits,
  type AlertHit,
  type AlertInput,
  type AlertKind,
  type DeliveryChannel,
  type ReportFrequency,
  type ReportInput,
  type ReportSectionId,
  type ScheduleSpec,
} from "@/lib/reporting";
import type { DateRange } from "@/lib/date-range";

const LEGAL_TERMS = legalSafetyTerms();

export interface ReportDocument {
  name: string;
  scopeLabel: string;
  periodLabel: string;
  timezone: string;
  sections: ReportSectionId[];
  lines: string[];
}

export interface SavedReport {
  id: string;
  name: string;
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  sections: ReportSectionId[];
  frequency: ReportFrequency;
  deliveryTime: string;
  timezone: ScheduleSpec["timezone"];
  weekday: number | null;
  dayOfMonth: number | null;
  recipients: string[];
  channels: DeliveryChannel[];
  enabled: boolean;
  nextRunAt: string;
}

export interface ReportRunRow {
  id: string;
  reportId: string;
  reportName: string;
  trigger: string;
  status: string;
  attempts: number;
  summary: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deliveries: Array<{ channel: string; recipient: string; status: string; detail: string | null }>;
}

export interface AlertRuleRow {
  id: string;
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

export interface AlertEventRow {
  id: string;
  ruleName: string;
  summary: string;
  triggeredAt: string;
  deliveries: Array<{ channel: string; recipient: string; status: string; detail: string | null }>;
}

function specFrom(input: {
  frequency: ReportFrequency;
  deliveryTime: string;
  timezone: ScheduleSpec["timezone"];
  weekday: number | null;
  dayOfMonth: number | null;
}): ScheduleSpec {
  const time = parseDeliveryTime(input.deliveryTime);
  if (!time) throw new ValidationError("Choose a delivery time.");
  return {
    frequency: input.frequency,
    hour: time.hour,
    minute: time.minute,
    weekday: input.weekday,
    dayOfMonth: input.dayOfMonth,
    timezone: input.timezone,
  };
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function rating(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

async function scopeLabel(
  workspaceId: string,
  scope: { clientId: string | null; groupId: string | null; locationId: string | null }
): Promise<string> {
  const admin = createAdminClient();
  if (scope.locationId) {
    const { data } = await admin
      .from("grm_google_locations")
      .select("location_title")
      .eq("id", scope.locationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return data?.location_title ?? "Location";
  }
  if (scope.groupId) {
    const { data } = await admin
      .from("grm_groups")
      .select("name")
      .eq("id", scope.groupId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return data?.name ?? "Removed group";
  }
  if (scope.clientId) {
    const { data } = await admin
      .from("grm_clients")
      .select("name")
      .eq("id", scope.clientId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return data?.name ?? "Brand";
  }
  return "All brands";
}

export async function buildReportDocument(
  workspaceId: string,
  input: {
    name: string;
    sections: ReportSectionId[];
    clientId: string | null;
    groupId: string | null;
    locationId: string | null;
    start: Date;
    end: Date;
    timezone: string;
  }
): Promise<ReportDocument> {
  const range: DateRange = {
    key: "custom",
    from: "",
    to: "",
    start: input.start,
    end: input.end,
    label: "",
  };
  const [context, label] = await Promise.all([
    getDashboardContext(workspaceId, range, {
      clientId: input.clientId,
      groupId: input.groupId,
      locationId: input.locationId,
    }),
    scopeLabel(workspaceId, input),
  ]);
  const current = reviewWindow(context.facts);
  const previous = context.previous ? reviewWindow(context.previous) : null;
  const periodLabel = `${formatInTimezone(input.start.toISOString(), input.timezone)} – ${formatInTimezone(input.end.toISOString(), input.timezone)}`;
  const lines: string[] = [
    `Scope: ${label}`,
    `Period: ${periodLabel} (${input.timezone}). End time is not included.`,
  ];

  if (input.sections.includes("scorecard")) {
    lines.push(
      "",
      "Scorecard",
      `Reviews: ${context.facts.reviews.toLocaleString("en-US")}`,
      `Average rating: ${rating(current.avgRating)}`,
      `Negative share (1–3 stars): ${percent(current.negativeShare)}`,
      `Reply rate: ${percent(current.replyRate)}`,
      `Open escalations opened in this period: ${context.facts.openEscalations.toLocaleString("en-US")}`,
      `Overdue among those: ${context.facts.overdueEscalations.toLocaleString("en-US")}`
    );
    if (previous) {
      lines.push(
        `Previous window: ${context.previous?.reviews.toLocaleString("en-US") ?? "0"} reviews, average ${rating(previous.avgRating)}.`
      );
    }
  }

  if (input.sections.includes("trends")) {
    lines.push("", "Trends");
    if (context.facts.months.length === 0) lines.push("No months in this period.");
    for (const month of context.facts.months) {
      lines.push(
        `${month.month.slice(0, 7)}: ${month.reviews} reviews, average ${month.reviews ? (month.ratingSum / month.reviews).toFixed(2) : "—"}`
      );
    }
  }

  if (input.sections.includes("leaderboard")) {
    lines.push("", "Location leaderboard");
    const names = new Map(context.locations.map((location) => [location.id, location.name]));
    const rows = context.facts.locations.filter((row) => row.reviews > 0);
    if (rows.length === 0) lines.push("No location has reviews in this period.");
    rows
      .slice()
      .sort((a, b) => b.reviews - a.reviews || b.ratingSum / b.reviews - a.ratingSum / a.reviews)
      .slice(0, 20)
      .forEach((row, index) => {
        lines.push(
          `${index + 1}. ${names.get(row.locationId) ?? "Location"}: ${rating(average(row.ratingSum, row.reviews))}, ${row.reviews} reviews, reply rate ${percent(share(row.replied, row.reviews))}`
        );
      });
  }

  if (input.sections.includes("themes")) {
    lines.push("", "Themes (1–3 star reviews)");
    const counts = new Map<string, number>();
    for (const row of context.facts.themeMonths) counts.set(row.theme, (counts.get(row.theme) ?? 0) + row.count);
    if (counts.size === 0) lines.push("No 1–3 star reviews in this period.");
    for (const [theme, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`${themeLabel(theme) ?? theme}: ${count}`);
    }
  }

  return { name: input.name, scopeLabel: label, periodLabel, timezone: input.timezone, sections: input.sections, lines };
}

async function assertScope(
  workspaceId: string,
  scope: { clientId: string | null; groupId: string | null; locationId: string | null }
): Promise<void> {
  const chosen = [scope.clientId, scope.groupId, scope.locationId].filter(Boolean);
  if (chosen.length > 1) throw new ValidationError("Choose the workspace, one brand, one group, or one location.");
  const admin = createAdminClient();
  if (scope.clientId) {
    const { data } = await admin
      .from("grm_clients")
      .select("id")
      .eq("id", scope.clientId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) throw new ValidationError("That brand is not in this workspace.");
  }
  if (scope.groupId) {
    const { data } = await admin
      .from("grm_groups")
      .select("id")
      .eq("id", scope.groupId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) throw new ValidationError("That group is not in this workspace.");
  }
  if (scope.locationId) {
    const { data } = await admin
      .from("grm_google_locations")
      .select("id")
      .eq("id", scope.locationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) throw new ValidationError("That location is not in this workspace.");
  }
}

function asChannels(value: string[]): DeliveryChannel[] {
  return value.filter((item): item is DeliveryChannel => item === "in_app" || item === "email" || item === "slack" || item === "whatsapp");
}

function asSections(value: string[]): ReportSectionId[] {
  const allowed: ReportSectionId[] = ["scorecard", "trends", "leaderboard", "themes"];
  return value.filter((item): item is ReportSectionId => allowed.includes(item as ReportSectionId));
}

export class ReportService {
  static async list(workspaceId: string): Promise<{ reports: SavedReport[]; runs: ReportRunRow[] }> {
    const admin = createAdminClient();
    const [reports, runs, deliveries] = await Promise.all([
      admin
        .from("grm_report_schedules")
        .select("id, name, client_id, group_id, location_id, sections, frequency, delivery_time, timezone, weekday, day_of_month, recipient_emails, channels, enabled, next_run_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      admin
        .from("grm_report_runs")
        .select("id, schedule_id, trigger, status, attempts, summary, error, started_at, finished_at")
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false })
        .limit(20),
      admin
        .from("grm_report_deliveries")
        .select("run_id, channel, recipient, status, detail")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (reports.error) throw new Error(reports.error.message);
    if (runs.error) throw new Error(runs.error.message);
    if (deliveries.error) throw new Error(deliveries.error.message);
    const names = new Map((reports.data ?? []).map((report) => [report.id, report.name]));
    const deliveriesByRun = new Map<string, ReportRunRow["deliveries"]>();
    for (const delivery of deliveries.data ?? []) {
      const list = deliveriesByRun.get(delivery.run_id) ?? [];
      list.push({
        channel: delivery.channel,
        recipient: delivery.recipient,
        status: delivery.status,
        detail: delivery.detail,
      });
      deliveriesByRun.set(delivery.run_id, list);
    }
    return {
      reports: (reports.data ?? []).map((report) => ({
        id: report.id,
        name: report.name,
        clientId: report.client_id,
        groupId: report.group_id,
        locationId: report.location_id,
        sections: asSections(report.sections),
        frequency: report.frequency as ReportFrequency,
        deliveryTime: report.delivery_time,
        timezone: report.timezone as ScheduleSpec["timezone"],
        weekday: report.weekday,
        dayOfMonth: report.day_of_month,
        recipients: report.recipient_emails,
        channels: asChannels(report.channels),
        enabled: report.enabled,
        nextRunAt: report.next_run_at,
      })),
      runs: (runs.data ?? []).map((run) => ({
        id: run.id,
        reportId: run.schedule_id ?? "",
        reportName: (run.schedule_id && names.get(run.schedule_id)) || "Report",
        trigger: run.trigger,
        status: run.status,
        attempts: run.attempts,
        summary: run.summary,
        error: run.error,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        deliveries: deliveriesByRun.get(run.id) ?? [],
      })),
    };
  }

  static async save(
    workspaceId: string,
    userId: string,
    reportId: string | null,
    input: ReportInput
  ): Promise<string> {
    await assertScope(workspaceId, input);
    const spec = specFrom(input);
    const admin = createAdminClient();
    const nextRunAt = nextDelivery(new Date(), spec).toISOString();
    const row = {
      name: input.name,
      workspace_id: workspaceId,
      client_id: input.clientId,
      group_id: input.groupId,
      location_id: input.locationId,
      sections: input.sections,
      frequency: input.frequency,
      delivery_time: input.deliveryTime,
      timezone: input.timezone,
      weekday: input.weekday,
      day_of_month: input.dayOfMonth,
      recipient_emails: input.recipients,
      recipients: input.recipients.join(", "),
      channels: input.channels,
      channel: input.channels.find((item) => item !== "in_app") ?? "in_app",
      enabled: input.enabled,
      next_run_at: nextRunAt,
      scope_label: input.locationId ? "One location" : input.groupId ? "One group" : input.clientId ? "One brand" : "All locations",
      include_scorecard: input.sections.includes("scorecard"),
      include_leaderboard: input.sections.includes("leaderboard"),
      include_themes: input.sections.includes("themes"),
      created_by: userId,
    };
    if (reportId) {
      const { data: existing } = await admin
        .from("grm_report_schedules")
        .select("id")
        .eq("id", reportId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!existing) throw new ValidationError("That report is not in this workspace.");
      const { error } = await admin.from("grm_report_schedules").update(row).eq("id", reportId);
      if (error) throw new Error(error.message);
      await AuditService.log({ workspaceId, userId, action: "report.saved", entityType: "report", entityId: reportId });
      return reportId;
    }
    const { data, error } = await admin.from("grm_report_schedules").insert(row).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "Could not save the report.");
    await AuditService.log({ workspaceId, userId, action: "report.saved", entityType: "report", entityId: data.id });
    return data.id;
  }

  static async remove(workspaceId: string, userId: string, reportId: string): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin.from("grm_report_schedules").delete().eq("id", reportId).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    await AuditService.log({
      workspaceId,
      userId,
      action: "report.deleted",
      entityType: "report",
      entityId: reportId,
    });
  }

  static async load(workspaceId: string, reportId: string): Promise<SavedReport | null> {
    const listed = await this.list(workspaceId);
    return listed.reports.find((report) => report.id === reportId) ?? null;
  }

  static async preview(workspaceId: string, reportId: string, now = new Date()): Promise<ReportDocument> {
    const report = await this.load(workspaceId, reportId);
    if (!report) throw new ValidationError("That report is not in this workspace.");
    const spec = specFrom(report);
    const slot = latestDelivery(now, spec) ?? nextDelivery(now, spec);
    const window = reportWindow(slot, spec);
    return buildReportDocument(workspaceId, { ...report, start: window.start, end: window.end, timezone: spec.timezone });
  }

  static async pdf(workspaceId: string, reportId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const doc = await this.preview(workspaceId, reportId);
    return {
      filename: `${doc.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "report"}.pdf`,
      bytes: renderTextPdf(doc.name, doc.lines),
    };
  }

  static async sendTest(workspaceId: string, userId: string, reportId: string): Promise<void> {
    const report = await this.load(workspaceId, reportId);
    if (!report) throw new ValidationError("That report is not in this workspace.");
    const spec = specFrom(report);
    const slot = latestDelivery(new Date(), spec) ?? nextDelivery(new Date(), spec);
    const window = reportWindow(slot, spec);
    const doc = await buildReportDocument(workspaceId, {
      ...report,
      start: window.start,
      end: window.end,
      timezone: spec.timezone,
    });
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_report_runs")
      .insert({
        workspace_id: workspaceId,
        schedule_id: report.id,
        trigger: "test",
        slot: null,
        status: "running",
        attempts: 1,
        period_start: window.start.toISOString(),
        period_end: window.end.toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not start the test.");
    await finishRun(data.id, workspaceId, report, doc, false);
    await AuditService.log({
      workspaceId,
      userId,
      action: "report.tested",
      entityType: "report",
      entityId: reportId,
    });
  }

  static async runDue(now = new Date()): Promise<{ delivered: number; failed: number }> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_report_schedules")
      .select("id, workspace_id, frequency, delivery_time, timezone, weekday, day_of_month, recipient_emails, channels, next_run_at, enabled")
      .eq("enabled", true)
      .lte("next_run_at", now.toISOString());
    if (error) throw new Error(error.message);
    let delivered = 0;
    let failed = 0;
    for (const schedule of data ?? []) {
      try {
        const outcome = await runSchedule(schedule, now);
        if (outcome === "delivered") delivered += 1;
        if (outcome === "failed") failed += 1;
      } catch (err) {
        failed += 1;
        console.error("[reports] schedule failed", schedule.id, err instanceof Error ? err.message : "Unknown");
      }
    }
    return { delivered, failed };
  }
}

async function runSchedule(
  schedule: {
    id: string;
    workspace_id: string;
    frequency: string;
    delivery_time: string;
    timezone: string;
    weekday: number | null;
    day_of_month: number | null;
    recipient_emails: string[];
    channels: string[];
    next_run_at: string;
  },
  now: Date
): Promise<"delivered" | "failed" | "skipped" | "waiting"> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("grm_report_runs")
    .select("id, status, attempts, finished_at, started_at")
    .eq("schedule_id", schedule.id)
    .eq("slot", schedule.next_run_at)
    .maybeSingle();

  if (existing?.status === "delivered" || existing?.status === "skipped") {
    await advanceSchedule(schedule);
    return "skipped";
  }
  if (existing?.status === "running") {
    const started = Date.parse(existing.started_at);
    if (now.getTime() - started < REPORT_RUNNING_LOCK_MS) return "waiting";
  }
  if (existing?.status === "failed") {
    if (existing.attempts >= REPORT_RETRY_LIMIT) {
      await admin.from("grm_report_runs").update({ status: "skipped", finished_at: now.toISOString() }).eq("id", existing.id);
      await advanceSchedule(schedule);
      return "skipped";
    }
    const finished = existing.finished_at ? Date.parse(existing.finished_at) : 0;
    if (now.getTime() - finished < REPORT_RETRY_MS) return "waiting";
  }

  const report = await ReportService.load(schedule.workspace_id, schedule.id);
  if (!report) return "skipped";
  const spec = specFrom({
    frequency: schedule.frequency as ReportFrequency,
    deliveryTime: schedule.delivery_time,
    timezone: report.timezone,
    weekday: schedule.weekday,
    dayOfMonth: schedule.day_of_month,
  });
  const slot = new Date(schedule.next_run_at);
  const window = reportWindow(slot, spec);
  const doc = await buildReportDocument(schedule.workspace_id, {
    ...report,
    start: window.start,
    end: window.end,
    timezone: spec.timezone,
  });

  let runId = existing?.id ?? null;
  if (!runId) {
    const { data, error } = await admin
      .from("grm_report_runs")
      .insert({
        workspace_id: schedule.workspace_id,
        schedule_id: schedule.id,
        trigger: "schedule",
        slot: schedule.next_run_at,
        status: "running",
        attempts: 1,
        period_start: window.start.toISOString(),
        period_end: window.end.toISOString(),
      })
      .select("id")
      .single();
    if (error?.code === "23505") return "waiting";
    if (error || !data) throw new Error(error?.message ?? "Could not claim the report run.");
    runId = data.id;
  } else {
    await admin
      .from("grm_report_runs")
      .update({ status: "running", attempts: (existing?.attempts ?? 1) + 1, started_at: now.toISOString() })
      .eq("id", runId);
  }

  const failed = await finishRun(runId, schedule.workspace_id, report, doc, true);
  if (!failed) await advanceSchedule(schedule);
  return failed ? "failed" : "delivered";
}

async function advanceSchedule(schedule: {
  id: string;
  frequency: string;
  delivery_time: string;
  timezone: string;
  weekday: number | null;
  day_of_month: number | null;
  next_run_at: string;
}): Promise<void> {
  const reportTimezone = schedule.timezone;
  if (reportTimezone !== "Asia/Kolkata" && reportTimezone !== "UTC" && reportTimezone !== "Asia/Dubai" && reportTimezone !== "America/New_York") {
    return;
  }
  const spec = specFrom({
    frequency: schedule.frequency as ReportFrequency,
    deliveryTime: schedule.delivery_time,
    timezone: reportTimezone,
    weekday: schedule.weekday,
    dayOfMonth: schedule.day_of_month,
  });
  const next = nextDelivery(new Date(schedule.next_run_at), spec).toISOString();
  await createAdminClient().from("grm_report_schedules").update({ next_run_at: next }).eq("id", schedule.id);
}

async function finishRun(
  runId: string,
  workspaceId: string,
  report: SavedReport,
  doc: ReportDocument,
  retryFailures: boolean
): Promise<boolean> {
  const admin = createAdminClient();
  const env = readDeliveryEnv(process.env);
  const pdf = renderTextPdf(doc.name, doc.lines);
  const body = doc.lines.join("\n");
  const { data: prior } = await admin.from("grm_report_deliveries").select("channel, recipient, status").eq("run_id", runId);
  const done = new Set(
    (prior ?? [])
      .filter((row) => row.status === "sent" || row.status === "recorded" || row.status === "unavailable")
      .map((row) => `${row.channel}:${row.recipient}`)
  );
  const recipients = report.recipients.length > 0 ? report.recipients : ["workspace"];
  let failed = false;
  for (const channel of report.channels) {
    const targets = channel === "slack" ? ["slack-webhook"] : recipients;
    for (const recipient of targets) {
      const key = `${channel}:${recipient}`;
      if (done.has(key)) continue;
      const result = await deliverMessage({
        env,
        channel,
        recipient,
        subject: report.name,
        body,
        pdf: channel === "email" ? pdf : undefined,
      });
      if (result.status === "failed") failed = true;
      await admin.from("grm_report_deliveries").upsert(
        {
          run_id: runId,
          workspace_id: workspaceId,
          channel,
          recipient,
          status: result.status,
          detail: result.detail,
        },
        { onConflict: "run_id,channel,recipient" }
      );
    }
  }
  await admin
    .from("grm_report_runs")
    .update({
      status: failed && retryFailures ? "failed" : "delivered",
      summary: body.slice(0, 4000),
      snapshot: { lines: doc.lines } as Json,
      error: failed ? "A delivery failed. The run will be tried again." : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  return failed && retryFailures;
}

interface LocationWindowRow {
  location_id: string;
  location_title: string;
  reviews: number;
  rating_sum: number;
  low_stars: number;
}

export class AlertService {
  static async list(workspaceId: string): Promise<{ rules: AlertRuleRow[]; events: AlertEventRow[] }> {
    const admin = createAdminClient();
    const [rules, events, deliveries] = await Promise.all([
      admin
        .from("grm_alert_rules")
        .select("id, name, kind, client_id, group_id, location_id, enabled, recipient_emails, channels, threshold, window_days, min_reviews, drop_points, multiplier")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      admin
        .from("grm_alert_events")
        .select("id, rule_id, summary, triggered_at")
        .eq("workspace_id", workspaceId)
        .order("triggered_at", { ascending: false })
        .limit(20),
      admin
        .from("grm_alert_deliveries")
        .select("event_id, channel, recipient, status, detail")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (rules.error) throw new Error(rules.error.message);
    if (events.error) throw new Error(events.error.message);
    if (deliveries.error) throw new Error(deliveries.error.message);
    const names = new Map((rules.data ?? []).map((rule) => [rule.id, rule.name]));
    const deliveriesByEvent = new Map<string, AlertEventRow["deliveries"]>();
    for (const delivery of deliveries.data ?? []) {
      const list = deliveriesByEvent.get(delivery.event_id) ?? [];
      list.push({
        channel: delivery.channel,
        recipient: delivery.recipient,
        status: delivery.status,
        detail: delivery.detail,
      });
      deliveriesByEvent.set(delivery.event_id, list);
    }
    return {
      rules: (rules.data ?? []).map((rule) => ({
        id: rule.id,
        name: rule.name,
        kind: rule.kind as AlertKind,
        clientId: rule.client_id,
        groupId: rule.group_id,
        locationId: rule.location_id,
        enabled: rule.enabled,
        recipients: rule.recipient_emails,
        channels: asChannels(rule.channels),
        threshold: rule.threshold,
        windowDays: rule.window_days,
        minReviews: rule.min_reviews,
        dropPoints: Number(rule.drop_points),
        multiplier: Number(rule.multiplier),
      })),
      events: (events.data ?? []).map((event) => ({
        id: event.id,
        ruleName: names.get(event.rule_id) ?? "Rule",
        summary: event.summary,
        triggeredAt: event.triggered_at,
        deliveries: deliveriesByEvent.get(event.id) ?? [],
      })),
    };
  }

  static async save(workspaceId: string, userId: string, ruleId: string | null, input: AlertInput): Promise<string> {
    if (!ALERT_KINDS.some((kind) => kind.id === input.kind)) throw new ValidationError("Choose an alert type.");
    await assertScope(workspaceId, input);
    const admin = createAdminClient();
    const row = {
      name: input.name,
      kind: input.kind,
      client_id: input.clientId,
      group_id: input.groupId,
      location_id: input.locationId,
      enabled: input.enabled,
      recipient_emails: input.recipients,
      channels: input.channels,
      channel: input.channels.find((item) => item !== "in_app") ?? "in_app",
      scope_label: input.locationId ? "One location" : input.groupId ? "One group" : input.clientId ? "One brand" : "All locations",
      notify_label: input.recipients.join(", ") || "In GRM",
      threshold: input.threshold,
      window_days: input.windowDays,
      min_reviews: input.minReviews,
      drop_points: input.dropPoints,
      multiplier: input.multiplier,
    };
    if (ruleId) {
      const { error } = await admin.from("grm_alert_rules").update(row).eq("id", ruleId).eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      await AuditService.log({ workspaceId, userId, action: "alert_rule.saved", entityType: "alert_rule", entityId: ruleId });
      return ruleId;
    }
    const { data, error } = await admin
      .from("grm_alert_rules")
      .insert({ ...row, workspace_id: workspaceId, created_by: userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save the alert.");
    await AuditService.log({ workspaceId, userId, action: "alert_rule.saved", entityType: "alert_rule", entityId: data.id });
    return data.id;
  }

  static async remove(workspaceId: string, userId: string, ruleId: string): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin.from("grm_alert_rules").delete().eq("id", ruleId).eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    await AuditService.log({ workspaceId, userId, action: "alert_rule.deleted", entityType: "alert_rule", entityId: ruleId });
  }

  static async evaluateWorkspace(workspaceId: string, now = new Date()): Promise<number> {
    const admin = createAdminClient();
    const { data: rules, error } = await admin
      .from("grm_alert_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    const { data: policy } = await admin.from("grm_escalation_policies").select("timezone").eq("workspace_id", workspaceId).maybeSingle();
    const timezone =
      policy?.timezone === "UTC" || policy?.timezone === "Asia/Dubai" || policy?.timezone === "America/New_York"
        ? policy.timezone
        : "Asia/Kolkata";
    let created = 0;
    for (const rule of rules ?? []) {
      const hits = await hitsForRule(workspaceId, rule, timezone, now);
      for (const hit of hits) {
        const inserted = await recordHit(
          workspaceId,
          { id: rule.id, recipients: rule.recipient_emails, channels: rule.channels },
          hit
        );
        if (inserted) created += 1;
      }
    }
    return created;
  }
}

async function locationWindow(
  workspaceId: string,
  scope: { client_id: string | null; group_id: string | null; location_id: string | null },
  start: Date,
  end: Date
): Promise<LocationWindowRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grm_alert_location_window", {
    p_workspace_id: workspaceId,
    p_client_id: scope.client_id,
    p_group_id: scope.group_id,
    p_location_id: scope.location_id,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.location_id !== "string") return [];
    return [
      {
        location_id: row.location_id,
        location_title: typeof row.location_title === "string" ? row.location_title : "Location",
        reviews: Number(row.reviews) || 0,
        rating_sum: Number(row.rating_sum) || 0,
        low_stars: Number(row.low_stars) || 0,
      },
    ];
  });
}

async function hitsForRule(
  workspaceId: string,
  rule: {
    kind: string;
    client_id: string | null;
    group_id: string | null;
    location_id: string | null;
    threshold: number;
    window_days: number;
    min_reviews: number;
    drop_points: number;
    multiplier: number;
  },
  timezone: string,
  now: Date
): Promise<AlertHit[]> {
  const scope = { client_id: rule.client_id, group_id: rule.group_id, location_id: rule.location_id };
  const end = now;
  const start = new Date(now.getTime() - rule.window_days * 86_400_000);
  const window = dayKey(start, timezone);

  if (rule.kind === "connection_expired") {
    const { data, error } = await createAdminClient()
      .from("grm_google_connections")
      .select("id, google_email, status, updated_at")
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return connectionHits({
      connections: (data ?? []).map((connection) => ({
        id: connection.id,
        email: connection.google_email,
        status: connection.status,
        updatedAt: connection.updated_at,
      })),
    });
  }

  if (rule.kind === "legal_safety") {
    const { data, error } = await createAdminClient().rpc("grm_alert_keyword_reviews", {
      p_workspace_id: workspaceId,
      p_client_id: scope.client_id,
      p_group_id: scope.group_id,
      p_location_id: scope.location_id,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_keywords: LEGAL_TERMS,
    });
    if (error) throw new Error(error.message);
    const reviews = Array.isArray(data) ? data : [];
    return legalSafetyHits({
      reviews: reviews.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.review_id !== "string" || typeof row.location_id !== "string") return [];
        return [
          {
            reviewId: row.review_id,
            locationId: row.location_id,
            locationName: typeof row.location_title === "string" ? row.location_title : "Location",
            comment: typeof row.comment === "string" ? row.comment : null,
            starRating: Number(row.star_rating) || 0,
          },
        ];
      }),
    });
  }

  const current = await locationWindow(workspaceId, scope, start, end);
  if (rule.kind === "negative_reviews") {
    return negativeReviewHits({
      rows: current.map((row) => ({
        locationId: row.location_id,
        locationName: row.location_title,
        lowStars: row.low_stars,
      })),
      threshold: rule.threshold,
      windowKey: window,
    });
  }

  const span = end.getTime() - start.getTime();
  const previous = await locationWindow(workspaceId, scope, new Date(start.getTime() - span), start);
  const previousById = new Map(previous.map((row) => [row.location_id, row]));
  if (rule.kind === "rating_drop") {
    return ratingDropHits({
      rows: current.map((row) => {
        const prior = previousById.get(row.location_id);
        return {
          locationId: row.location_id,
          locationName: row.location_title,
          currentAvg: row.reviews > 0 ? row.rating_sum / row.reviews : null,
          currentCount: row.reviews,
          previousAvg: prior && prior.reviews > 0 ? prior.rating_sum / prior.reviews : null,
          previousCount: prior?.reviews ?? 0,
        };
      }),
      dropPoints: Number(rule.drop_points),
      minReviews: rule.min_reviews,
      windowKey: window,
    });
  }

  return reviewBurstHits({
    rows: current.map((row) => ({
      locationId: row.location_id,
      locationName: row.location_title,
      currentCount: row.reviews,
      previousCount: previousById.get(row.location_id)?.reviews ?? 0,
    })),
    multiplier: Number(rule.multiplier),
    minReviews: rule.min_reviews,
    windowKey: window,
  });
}

async function recordHit(
  workspaceId: string,
  rule: { id: string; recipients: string[]; channels: string[] },
  hit: AlertHit
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("grm_alert_events")
    .insert({
      workspace_id: workspaceId,
      rule_id: rule.id,
      fingerprint: `${rule.id}:${hit.dedupeKey}`,
      dedupe_key: hit.dedupeKey,
      location_id: hit.locationId,
      summary: hit.summary,
      evidence: hit.evidence as Json,
      delivery: "recorded",
    })
    .select("id")
    .single();
  if (error?.code === "23505") return false;
  if (error || !data) throw new Error(error?.message ?? "Could not record the alert.");
  const env = readDeliveryEnv(process.env);
  const recipients = rule.recipients.length > 0 ? rule.recipients : ["workspace"];
  const channels = asChannels(rule.channels);
  for (const channel of channels) {
    const targets = channel === "slack" ? ["slack-webhook"] : recipients;
    for (const recipient of targets) {
      const result = await deliverMessage({
        env,
        channel,
        recipient,
        subject: "Alert",
        body: hit.summary,
      });
      await admin.from("grm_alert_deliveries").insert({
        event_id: data.id,
        workspace_id: workspaceId,
        channel,
        recipient,
        status: result.status,
        detail: result.detail,
      });
    }
  }
  return true;
}

export async function listReportScopes(workspaceId: string): Promise<{
  clients: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
}> {
  const admin = createAdminClient();
  const [clients, groups, locations] = await Promise.all([
    admin
      .from("grm_clients")
      .select("id, name, notes")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("name"),
    admin.from("grm_groups").select("id, name").eq("workspace_id", workspaceId).order("name"),
    admin.from("grm_google_locations").select("id, location_title").eq("workspace_id", workspaceId).order("location_title"),
  ]);
  if (clients.error) throw new Error(clients.error.message);
  if (groups.error) throw new Error(groups.error.message);
  if (locations.error) throw new Error(locations.error.message);
  return {
    clients: (clients.data ?? [])
      .filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER)
      .map((client) => ({ id: client.id, name: client.name })),
    groups: (groups.data ?? []).map((group) => ({ id: group.id, name: group.name })),
    locations: (locations.data ?? []).map((location) => ({ id: location.id, name: location.location_title })),
  };
}

export async function guardReport(
  userId: string,
  workspaceId: string,
  report: { clientId: string | null; groupId: string | null; locationId: string | null }
): Promise<void> {
  await assertScopeTarget({
    userId,
    workspaceId,
    clientId: report.clientId,
    groupId: report.groupId,
    locationId: report.locationId,
  });
}

export async function actingUser(user: { id: string }): Promise<{ workspaceId: string; userId: string; manager: boolean }> {
  const membership = await ensurePersonalWorkspace(user);
  const role = await getMemberRole(user.id, membership.workspace_id);
  return { workspaceId: membership.workspace_id, userId: user.id, manager: workspaceGrant(role, "edit_rules") };
}

export async function runReportingJobs(now = new Date()): Promise<{ reportsDelivered: number; alertsOpened: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("grm_workspaces").select("id");
  if (error) throw new Error(error.message);
  const reports = await ReportService.runDue(now);
  let alertsOpened = 0;
  for (const workspace of data ?? []) {
    try {
      alertsOpened += await AlertService.evaluateWorkspace(workspace.id, now);
    } catch (err) {
      console.error("[alerts] workspace failed", workspace.id, err instanceof Error ? err.message : "Unknown");
    }
  }
  return { reportsDelivered: reports.delivered, alertsOpened };
}
