import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { AppError } from "@/lib/errors";
import {
  DEFAULT_ESCALATION_POLICY,
  ESCALATION_TIMEZONES,
  escalationReasons,
  shouldSkipTrigger,
  type EscalationLevel,
  type EscalationPolicy,
  type EscalationTimezone,
  type ResolutionCode,
} from "@/lib/escalations";
import type { Json } from "@/lib/types/supabase";
import { escalationTiming, scopedGroupIds } from "@/lib/services/hierarchy";

const REMINDER_ATTEMPT_LIMIT = 5;

function triggerKey(reviewId: string, stars: number, comment: string | null, reasons: string[]): string {
  return createHash("sha256")
    .update([reviewId, String(stars), (comment ?? "").trim().slice(0, 400), ...reasons].join("|"))
    .digest("hex")
    .slice(0, 32);
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

function mapPolicy(row: {
  max_stars: number;
  flag_profanity: boolean;
  flag_legal_safety: boolean;
  extra_keywords: string[];
  reminder_hours: number[];
  due_hours: number;
  timezone: string;
} | null): EscalationPolicy {
  if (!row) return DEFAULT_ESCALATION_POLICY;
  const timezone = ESCALATION_TIMEZONES.some((item) => item.id === row.timezone)
    ? (row.timezone as EscalationTimezone)
    : DEFAULT_ESCALATION_POLICY.timezone;
  return {
    maxStars: row.max_stars,
    flagProfanity: row.flag_profanity,
    flagLegalSafety: row.flag_legal_safety,
    extraKeywords: row.extra_keywords ?? [],
    reminderHours: row.reminder_hours?.length ? row.reminder_hours : DEFAULT_ESCALATION_POLICY.reminderHours,
    dueHours: row.due_hours,
    timezone,
  };
}

export interface EscalationQueueItem {
  id: string;
  status: string;
  level: string;
  assignedTo: string | null;
  openedAt: string;
  dueAt: string;
  resolvedAt: string | null;
  resolutionCode: string | null;
  resolutionNote: string | null;
  triggerReasons: string[];
  reviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string | null;
  theme: string | null;
  replyStatus: string;
  locationName: string;
  locationId: string;
  clientId: string | null;
  events: Array<{ action: string; createdAt: string; metadata: Json }>;
}

export class EscalationService {
  static async policy(workspaceId: string): Promise<EscalationPolicy> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_escalation_policies")
      .select("max_stars, flag_profanity, flag_legal_safety, extra_keywords, reminder_hours, due_hours, timezone")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new AppError("Could not load escalation rules.", "DB_ERROR", 500);
    return mapPolicy(data);
  }

  static async savePolicy(workspaceId: string, userId: string, policy: EscalationPolicy): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin.from("grm_escalation_policies").upsert({
      workspace_id: workspaceId,
      max_stars: policy.maxStars,
      flag_profanity: policy.flagProfanity,
      flag_legal_safety: policy.flagLegalSafety,
      extra_keywords: policy.extraKeywords,
      reminder_hours: policy.reminderHours,
      due_hours: policy.dueHours,
      timezone: policy.timezone,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new AppError("Could not save escalation rules.", "DB_ERROR", 500);
    await AuditService.log({
      workspaceId,
      userId,
      action: "escalation.policy_updated",
      entityType: "grm_escalation_policies",
      entityId: workspaceId,
      metadata: { dueHours: policy.dueHours, maxStars: policy.maxStars, reminderHours: policy.reminderHours },
    });
  }

  /** Creates one open escalation per matching review. The same trigger key is ignored. */
  static async ensure(workspaceId: string): Promise<{ created: number }> {
    const admin = createAdminClient();
    const policy = await this.policy(workspaceId);
    const { data: reviews, error } = await admin
      .from("grm_reviews")
      .select("id, star_rating, comment, review_create_time, location_id, complaint_theme")
      .eq("workspace_id", workspaceId)
      .order("review_create_time", { ascending: false })
      .limit(300);
    if (error) throw new AppError("Could not read reviews for escalation.", "DB_ERROR", 500);

    const matches = (reviews ?? [])
      .map((review) => ({
        review,
        reasons: escalationReasons(
          { starRating: review.star_rating, comment: review.comment },
          policy
        ),
      }))
      .filter((item) => item.reasons.length > 0);
    if (matches.length === 0) return { created: 0 };

    const ids = matches.map((item) => item.review.id);
      const { data: existing, error: existingError } = await admin
      .from("grm_escalations")
      .select("id, review_id, trigger_key, status")
      .eq("workspace_id", workspaceId)
      .in("review_id", ids);
    if (existingError) throw new AppError("Could not read existing escalations.", "DB_ERROR", 500);

    const open = new Set(
      (existing ?? []).filter((row) => row.status !== "resolved").map((row) => row.review_id)
    );
    const keys = new Set((existing ?? []).map((row) => `${row.review_id}:${row.trigger_key}`));
    const byReview = new Map((existing ?? []).map((row) => [row.review_id, row]));

    const timing = await escalationTiming(
      workspaceId,
      matches.map((item) => item.review.location_id),
      policy.dueHours
    );
    let created = 0;
    for (const item of matches) {
      const key = triggerKey(item.review.id, item.review.star_rating, item.review.comment, item.reasons);
      if (
        shouldSkipTrigger({
          hasOpen: open.has(item.review.id),
          knownKey: keys.has(`${item.review.id}:${key}`),
        })
      ) {
        continue;
      }
      const openedAt = item.review.review_create_time;
      const prior = byReview.get(item.review.id);
      if (prior?.status === "resolved") {
        const reopened = await admin
          .from("grm_escalations")
          .update({
            status: "needs_human",
            assignee_user_id: null,
            opened_at: openedAt,
            due_at: addHours(openedAt, timing.get(item.review.location_id)?.hours ?? policy.dueHours),
            ...(timing.get(item.review.location_id)?.level
              ? { level: timing.get(item.review.location_id)!.level as EscalationLevel }
              : {}),
            resolved_at: null,
            resolved_by: null,
            resolution_code: null,
            internal_note: null,
            trigger_reasons: item.reasons,
            trigger_key: key,
            theme: item.review.complaint_theme,
            updated_at: new Date().toISOString(),
          })
          .eq("id", prior.id)
          .select("id")
          .maybeSingle();
        if (reopened.error || !reopened.data) continue;
        await admin.from("grm_escalation_events").insert({
          workspace_id: workspaceId,
          escalation_id: prior.id,
          kind: "reopened",
          body: "Reopened because the review changed.",
          metadata: { reasons: item.reasons },
        });
        open.add(item.review.id);
        continue;
      }
      const { data: inserted, error: insertError } = await admin
        .from("grm_escalations")
        .insert({
          workspace_id: workspaceId,
          review_id: item.review.id,
          location_id: item.review.location_id,
          theme: item.review.complaint_theme,
          opened_at: openedAt,
          due_at: addHours(openedAt, timing.get(item.review.location_id)?.hours ?? policy.dueHours),
          ...(timing.get(item.review.location_id)?.level
            ? { level: timing.get(item.review.location_id)!.level as EscalationLevel }
            : {}),
          trigger_reasons: item.reasons,
          trigger_key: key,
        })
        .select("id")
        .maybeSingle();
      if (insertError) {
        if (insertError.code === "23505") continue;
        throw new AppError("Could not open an escalation.", "DB_ERROR", 500);
      }
      if (!inserted) continue;
      open.add(item.review.id);
      keys.add(`${item.review.id}:${key}`);
      created += 1;
      await admin.from("grm_escalation_events").insert({
        workspace_id: workspaceId,
        escalation_id: inserted.id,
        kind: "opened",
        body: "Opened from the complaint rules.",
        metadata: { reasons: item.reasons },
      });
      const reminders = [...new Set(policy.reminderHours)]
        .filter((hour) => hour > 0 && hour < policy.dueHours)
        .map((hour) => ({
          workspace_id: workspaceId,
          escalation_id: inserted.id,
          kind: String(hour),
          due_at: addHours(openedAt, hour),
        }));
      if (reminders.length > 0) {
        await admin.from("grm_escalation_reminders").insert(reminders);
      }
    }
    return { created };
  }

  /**
   * Records a due reminder once. A second run sees sent_at and does nothing.
   * sent_at means the reminder is stored in GRM. No email or message is sent.
   */
  static async processReminders(workspaceId: string): Promise<{ recorded: number }> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data: due, error } = await admin
      .from("grm_escalation_reminders")
      .select("id, escalation_id, kind, attempts")
      .eq("workspace_id", workspaceId)
      .is("sent_at", null)
      .lte("due_at", now)
      .lt("attempts", REMINDER_ATTEMPT_LIMIT)
      .limit(100);
    if (error) throw new AppError("Could not read due reminders.", "DB_ERROR", 500);

    const owner = await admin
      .from("grm_workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    let recorded = 0;
    for (const reminder of due ?? []) {
      const claimed = await admin
        .from("grm_escalation_reminders")
        .update({
          sent_at: now,
          attempts: reminder.attempts + 1,
          last_error: null,
        })
        .eq("id", reminder.id)
        .is("sent_at", null)
        .select("id");
      if (claimed.error || !claimed.data?.length) continue;

      const event = await admin.from("grm_escalation_events").insert({
        workspace_id: workspaceId,
        escalation_id: reminder.escalation_id,
        kind: "reminder_recorded",
        body: "Reminder recorded in GRM. No email or message was sent.",
        metadata: { kind: reminder.kind, channel: "in_app" },
      });
      if (event.error) {
        await admin
          .from("grm_escalation_reminders")
          .update({
            sent_at: null,
            last_error: "Could not record the reminder.",
          })
          .eq("id", reminder.id);
        continue;
      }
      recorded += 1;
      if (owner.data?.user_id) {
        await AuditService.log({
          workspaceId,
          userId: owner.data.user_id,
          action: "escalation.reminder",
          entityType: "grm_escalations",
          entityId: reminder.escalation_id,
          metadata: { source: "scheduler", kind: reminder.kind, channel: "in_app" },
        });
      }
    }
    return { recorded };
  }

  /** Opens matching complaints, records due reminders, and reports whether automation is paused. */
  static async runScheduled(workspaceId: string): Promise<{
    created: number;
    reminders: number;
    autoreplies: "paused" | "no_autoreply_worker";
  }> {
    const created = await this.ensure(workspaceId);
    const [reminders, pauses] = await Promise.all([
      this.processReminders(workspaceId),
      this.pausedTargets(workspaceId),
    ]);
    const paused = pauses.workspace || pauses.locationIds.length > 0 || pauses.clientIds.length > 0;
    return {
      created: created.created,
      reminders: reminders.recorded,
      autoreplies: paused ? "paused" : "no_autoreply_worker",
    };
  }

  static async scopes(workspaceId: string): Promise<{
    clients: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string; clientId: string | null }>;
  }> {
    const admin = createAdminClient();
    const [clients, locations] = await Promise.all([
      admin.from("grm_clients").select("id, name").eq("workspace_id", workspaceId).order("name"),
      admin
        .from("grm_google_locations")
        .select("id, location_title, client_id")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("location_title"),
    ]);
    if (clients.error || locations.error) throw new AppError("Could not load pause scopes.", "DB_ERROR", 500);
    return {
      clients: clients.data ?? [],
      locations: (locations.data ?? []).map((row) => ({
        id: row.id,
        name: row.location_title,
        clientId: row.client_id,
      })),
    };
  }

  /** Scheduled work skips paused scopes. There is no automatic reply sender. */
  static async pausedTargets(workspaceId: string): Promise<{
    workspace: boolean;
    locationIds: string[];
    clientIds: string[];
  }> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_autoreply_pauses")
      .select("scope, client_id, location_id")
      .eq("workspace_id", workspaceId)
      .is("cleared_at", null);
    if (error) throw new AppError("Could not read autoreply pauses.", "DB_ERROR", 500);
    const rows = data ?? [];
    return {
      workspace: rows.some((row) => row.scope === "workspace"),
      locationIds: rows.flatMap((row) => (row.location_id ? [row.location_id] : [])),
      clientIds: rows.flatMap((row) => (row.client_id ? [row.client_id] : [])),
    };
  }

  static async queue(input: {
    workspaceId: string;
    bucket: "needs_human" | "in_progress" | "past_sla" | "resolved";
    clientId: string | null;
    locationId: string | null;
    groupId: string | null;
    since: string | null;
    until: string | null;
    page: number;
    pageSize: number;
  }): Promise<{ items: EscalationQueueItem[]; total: number }> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    let reviewIds: string[] | null = null;
    if (input.clientId || input.locationId || input.groupId) {
      let locations = admin.from("grm_google_locations").select("id").eq("workspace_id", input.workspaceId);
      if (input.clientId) locations = locations.eq("client_id", input.clientId);
      if (input.locationId) locations = locations.eq("id", input.locationId);
      if (input.groupId) {
        const ids = await scopedGroupIds(input.workspaceId, input.groupId);
        locations = locations.in("group_id", ids);
      }
      const locationRows = await locations;
      if (locationRows.error) throw new AppError("Could not load locations.", "DB_ERROR", 500);
      const ids = (locationRows.data ?? []).map((row) => row.id);
      if (ids.length === 0) return { items: [], total: 0 };
      const reviewRows = await admin.from("grm_reviews").select("id").eq("workspace_id", input.workspaceId).in("location_id", ids);
      if (reviewRows.error) throw new AppError("Could not load reviews.", "DB_ERROR", 500);
      reviewIds = (reviewRows.data ?? []).map((row) => row.id);
      if (reviewIds.length === 0) return { items: [], total: 0 };
    }
    let query = admin
      .from("grm_escalations")
      .select(
        "id, status, level, assignee_user_id, opened_at, due_at, resolved_at, resolution_code, internal_note, trigger_reasons, review_id",
        { count: "exact" }
      )
      .eq("workspace_id", input.workspaceId);

    if (input.bucket === "resolved") query = query.eq("status", "resolved");
    else if (input.bucket === "past_sla") query = query.neq("status", "resolved").lt("due_at", now);
    else if (input.bucket === "in_progress") {
      query = query.eq("status", "in_progress").gte("due_at", now);
    } else query = query.eq("status", "needs_human").gte("due_at", now);
    if (reviewIds) query = query.in("review_id", reviewIds);
    if (input.since) query = query.gte("opened_at", input.since);
    if (input.until) query = query.lte("opened_at", input.until);

    const from = (input.page - 1) * input.pageSize;
    const { data, error, count } = await query
      .order("due_at", { ascending: input.bucket !== "resolved" })
      .range(from, from + input.pageSize - 1);
    if (error) throw new AppError("Could not load the escalation queue.", "DB_ERROR", 500);

    const rows = data ?? [];
    const pageReviewIds = rows.map((row) => row.review_id);
    const escalationIds = rows.map((row) => row.id);
    const [reviews, events] = await Promise.all([
      pageReviewIds.length
        ? admin
            .from("grm_reviews")
            .select("id, reviewer_display_name, star_rating, comment, complaint_theme, reply_status, location_id")
            .in("id", pageReviewIds)
        : Promise.resolve({ data: [], error: null }),
      escalationIds.length
        ? admin
            .from("grm_escalation_events")
            .select("escalation_id, kind, created_at, metadata")
            .in("escalation_id", escalationIds)
            .order("created_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reviews.error || events.error) throw new AppError("Could not load escalation details.", "DB_ERROR", 500);

    const locationIds = [...new Set((reviews.data ?? []).map((review) => review.location_id))];
    const locations = locationIds.length
      ? await admin.from("grm_google_locations").select("id, location_title, client_id").in("id", locationIds)
      : { data: [], error: null };
    if (locations.error) throw new AppError("Could not load locations.", "DB_ERROR", 500);

    const reviewMap = new Map((reviews.data ?? []).map((review) => [review.id, review]));
    const locationMap = new Map((locations.data ?? []).map((location) => [location.id, location]));

    const items: EscalationQueueItem[] = [];
    for (const row of rows) {
      const review = reviewMap.get(row.review_id);
      if (!review) continue;
      const location = locationMap.get(review.location_id);
      items.push({
        id: row.id,
        status: row.status,
        level: row.level,
        assignedTo: row.assignee_user_id,
        openedAt: row.opened_at,
        dueAt: row.due_at,
        resolvedAt: row.resolved_at,
        resolutionCode: row.resolution_code,
        resolutionNote: row.internal_note,
        triggerReasons: row.trigger_reasons,
        reviewId: review.id,
        reviewerName: review.reviewer_display_name,
        starRating: review.star_rating,
        comment: review.comment,
        theme: review.complaint_theme,
        replyStatus: review.reply_status,
        locationName: location?.location_title ?? "Location",
        locationId: review.location_id,
        clientId: location?.client_id ?? null,
        events: (events.data ?? [])
          .filter((event) => event.escalation_id === row.id)
          .map((event) => ({
            action: event.kind,
            createdAt: event.created_at,
            metadata: event.metadata,
          })),
      });
    }
    return { items, total: count ?? items.length };
  }

  static async counts(
    workspaceId: string,
    scope?: { since: string | null; until: string | null; clientId: string | null; locationId: string | null; groupId?: string | null }
  ): Promise<Record<"needs_human" | "in_progress" | "past_sla" | "resolved", number>> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    let reviewIds: string[] | null = null;
    if (scope?.clientId || scope?.locationId || scope?.groupId) {
      let locations = admin.from("grm_google_locations").select("id").eq("workspace_id", workspaceId);
      if (scope.clientId) locations = locations.eq("client_id", scope.clientId);
      if (scope.locationId) locations = locations.eq("id", scope.locationId);
      if (scope.groupId) {
        const ids = await scopedGroupIds(workspaceId, scope.groupId);
        locations = locations.in("group_id", ids);
      }
      const locationRows = await locations;
      if (locationRows.error) throw new AppError("Could not count escalations.", "DB_ERROR", 500);
      const ids = (locationRows.data ?? []).map((row) => row.id);
      if (ids.length === 0) return { needs_human: 0, in_progress: 0, past_sla: 0, resolved: 0 };
      const reviewRows = await admin.from("grm_reviews").select("id").in("location_id", ids);
      if (reviewRows.error) throw new AppError("Could not count escalations.", "DB_ERROR", 500);
      reviewIds = (reviewRows.data ?? []).map((row) => row.id);
      if (reviewIds.length === 0) return { needs_human: 0, in_progress: 0, past_sla: 0, resolved: 0 };
    }
    const head = (status?: string, past?: boolean, open?: boolean) => {
      let query = admin
        .from("grm_escalations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      if (reviewIds) query = query.in("review_id", reviewIds);
      if (status) query = query.eq("status", status);
      if (open) query = query.neq("status", "resolved");
      if (past === true) query = query.lt("due_at", now);
      if (past === false) query = query.gte("due_at", now);
      if (scope?.since) query = query.gte("opened_at", scope.since);
      if (scope?.until) query = query.lte("opened_at", scope.until);
      return query;
    };
    const [needs, progress, past, resolved] = await Promise.all([
      head("needs_human", false),
      head("in_progress", false),
      head(undefined, true, true),
      head("resolved"),
    ]);
    const value = (result: { count: number | null; error: { message: string } | null }) => {
      if (result.error) throw new AppError("Could not count escalations.", "DB_ERROR", 500);
      return result.count ?? 0;
    };
    return {
      needs_human: value(needs),
      in_progress: value(progress),
      past_sla: value(past),
      resolved: value(resolved),
    };
  }

  static async assign(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    assigneeId: string | null;
  }): Promise<void> {
    const admin = createAdminClient();
    if (input.assigneeId) {
      const member = await admin
        .from("grm_workspace_members")
        .select("user_id")
        .eq("workspace_id", input.workspaceId)
        .eq("user_id", input.assigneeId)
        .maybeSingle();
      if (!member.data) throw new AppError("That person is not in this workspace.", "VALIDATION_ERROR", 400);
    }
    const nextStatus = input.assigneeId ? "in_progress" : "needs_human";
    const { data, error } = await admin
      .from("grm_escalations")
      .update({
        assignee_user_id: input.assigneeId,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "resolved")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new AppError("Could not assign this escalation.", "DB_ERROR", 400);
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "assigned",
      body: "Assignment changed.",
      metadata: { assigneeId: input.assigneeId },
    });
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.assigned",
      entityType: "grm_escalations",
      entityId: input.escalationId,
      metadata: { assigneeId: input.assigneeId },
    });
  }

  static async changeLevel(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    level: EscalationLevel;
  }): Promise<void> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_escalations")
      .update({ level: input.level, updated_at: new Date().toISOString() })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "resolved")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new AppError("Could not change the escalation level.", "DB_ERROR", 400);
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "level_changed",
      body: "Escalation level changed.",
      metadata: { level: input.level },
    });
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.level_changed",
      entityType: "grm_escalations",
      entityId: input.escalationId,
      metadata: { level: input.level },
    });
  }

  static async resolve(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    code: ResolutionCode;
    note: string;
  }): Promise<void> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("grm_escalations")
      .update({
        status: "resolved",
        resolved_at: now,
        resolved_by: input.actorId,
        resolution_code: input.code,
        internal_note: input.note || null,
        updated_at: now,
      })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "resolved")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new AppError("Could not resolve this escalation.", "DB_ERROR", 400);
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "resolved",
      body: "Resolution recorded. This does not confirm a callback, replacement, or visit.",
      metadata: { code: input.code },
    });
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.resolved",
      entityType: "grm_escalations",
      entityId: input.escalationId,
      metadata: { code: input.code },
    });
  }

  /** Opens one escalation for a review a person flagged. An open row is reused. */
  static async openManual(input: {
    workspaceId: string;
    reviewId: string;
    actorId: string;
  }): Promise<{ id: string; created: boolean }> {
    const admin = createAdminClient();
    const review = await admin
      .from("grm_reviews")
      .select("id, location_id, complaint_theme")
      .eq("id", input.reviewId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (review.error || !review.data) {
      throw new AppError("That review is not in this organization.", "NOT_FOUND", 404);
    }

    const existing = await admin
      .from("grm_escalations")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("review_id", input.reviewId)
      .neq("status", "resolved")
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new AppError("Could not read escalations.", "DB_ERROR", 500);
    if (existing.data) return { id: existing.data.id, created: false };

    const policy = await this.policy(input.workspaceId);
    const now = new Date().toISOString();
    const { data: inserted, error } = await admin
      .from("grm_escalations")
      .insert({
        workspace_id: input.workspaceId,
        review_id: input.reviewId,
        location_id: review.data.location_id,
        theme: review.data.complaint_theme,
        status: "needs_human",
        level: "store",
        opened_at: now,
        due_at: addHours(now, policy.dueHours),
        trigger_reasons: ["manager_requested"],
        trigger_key: `manual:${input.reviewId}`,
      })
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") {
      const again = await admin
        .from("grm_escalations")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .eq("review_id", input.reviewId)
        .neq("status", "resolved")
        .limit(1)
        .maybeSingle();
      if (again.data) return { id: again.data.id, created: false };
    }
    if (error || !inserted) throw new AppError("Could not open an escalation.", "DB_ERROR", 500);

    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: inserted.id,
      actor_id: input.actorId,
      kind: "opened",
      body: "Opened because someone asked a manager to handle it.",
      metadata: { reasons: ["manager_requested"] },
    });
    const reminders = [...new Set(policy.reminderHours)]
      .filter((hour) => hour > 0 && hour < policy.dueHours)
      .map((hour) => ({
        workspace_id: input.workspaceId,
        escalation_id: inserted.id,
        kind: String(hour),
        due_at: addHours(now, hour),
      }));
    if (reminders.length > 0) await admin.from("grm_escalation_reminders").insert(reminders);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.opened",
      entityType: "grm_escalations",
      entityId: inserted.id,
      metadata: { reviewId: input.reviewId, source: "manual" },
    });
    return { id: inserted.id, created: true };
  }

  /** Records a next step on an open escalation. It does not resolve the escalation. */
  static async markNextStep(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    code: ResolutionCode;
  }): Promise<void> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_escalations")
      .update({ resolution_code: input.code, updated_at: new Date().toISOString() })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "resolved")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new AppError("Could not record that next step.", "DB_ERROR", 400);
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "next_step",
      body: "Next step recorded. This does not mean the call, replacement, or visit happened.",
      metadata: { code: input.code },
    });
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.next_step",
      entityType: "grm_escalations",
      entityId: input.escalationId,
      metadata: { code: input.code },
    });
  }

  static async setPause(input: {
    workspaceId: string;
    userId: string;
    scope: "workspace" | "client" | "location";
    clientId: string | null;
    locationId: string | null;
    paused: boolean;
  }): Promise<void> {
    const admin = createAdminClient();
    let lookup = admin
      .from("grm_autoreply_pauses")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("scope", input.scope)
      .is("cleared_at", null);
    if (input.scope === "client") lookup = lookup.eq("client_id", input.clientId ?? "");
    if (input.scope === "location") lookup = lookup.eq("location_id", input.locationId ?? "");
    const current = await lookup.maybeSingle();
    if (current.error) throw new AppError("Could not read the pause.", "DB_ERROR", 500);

    if (!input.paused) {
      if (!current.data) return;
      const { error } = await admin
        .from("grm_autoreply_pauses")
        .update({ cleared_at: new Date().toISOString() })
        .eq("id", current.data.id);
      if (error) throw new AppError("Could not resume automatic replies.", "DB_ERROR", 500);
      await AuditService.log({
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: "autoreply.resumed",
        entityType: "grm_autoreply_pauses",
        entityId: current.data.id,
        metadata: { scope: input.scope },
      });
      return;
    }

    if (current.data) return;
    const { data, error } = await admin
      .from("grm_autoreply_pauses")
      .insert({
        workspace_id: input.workspaceId,
        scope: input.scope,
        client_id: input.clientId,
        location_id: input.locationId,
        paused_by: input.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new AppError("Could not pause automatic replies.", "DB_ERROR", 500);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "autoreply.paused",
      entityType: "grm_autoreply_pauses",
      entityId: data.id,
      metadata: { scope: input.scope, clientId: input.clientId, locationId: input.locationId },
    });
  }
}
