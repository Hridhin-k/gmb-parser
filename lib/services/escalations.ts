import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuditService } from "@/lib/services/audit";
import { deliverMessage } from "@/lib/delivery";
import { readDeliveryEnv } from "@/lib/reporting";
import { AppError, ValidationError } from "@/lib/errors";
import {
  AUTOMATIC_ASSIGNMENT_REASONS,
  DEFAULT_ESCALATION_POLICY,
  ESCALATION_TIMEZONES,
  canReassignEscalation,
  escalationReasons,
  nextEscalationLevel,
  planAssignment,
  planLevelOwner,
  reassignmentError,
  shouldSkipTrigger,
  type AssignmentLocation,
  type AssignmentMember,
  type EscalationLevel,
  type EscalationPolicy,
  type EscalationTimezone,
  type ResolutionCode,
} from "@/lib/escalations";
import type { Json } from "@/lib/types/supabase";
import { escalationTiming, scopedGroupIds } from "@/lib/services/hierarchy";
import { logger } from "@/lib/logger";
import { normalizeResolutionContact, type ResolutionContact } from "@/lib/resolution-contact";

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

function assignmentNotice(
  reason: string,
  ownership: "manager" | "fallback",
  assigneeRole: string | null,
  assigned: boolean
): string {
  if (!assigned) return "No manager or admin could take this case.";
  if (reason === "location_manager") return "Assigned to the manager for this location.";
  if (reason === "group_manager") return "Assigned to the manager for this group.";
  if (reason === "organisation_manager") return "Assigned to the manager for this organisation.";
  if (ownership === "fallback" && assigneeRole === "owner") {
    return "No manager or admin is available. Assigned to the owner.";
  }
  return "No manager is available for this location. Assigned to an admin.";
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

function missingContactColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /resolution_phone|resolution_email/.test(error.message ?? "");
}

export class EscalationContactStore {
  static async read(workspaceId: string): Promise<ResolutionContact> {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("grm_escalation_policies")
      .select("resolution_phone, resolution_email")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (missingContactColumn(error)) return { phone: null, email: null };
    if (error) throw new AppError("Could not load the resolution contact.", "DB_ERROR", 500);
    return {
      phone: data?.resolution_phone ?? null,
      email: data?.resolution_email ?? null,
    };
  }

  static async save(
    workspaceId: string,
    userId: string,
    input: { phone: string; email: string }
  ): Promise<ResolutionContact> {
    const contact = normalizeResolutionContact(input);
    const admin = createAdminClient();
    const { error } = await admin.from("grm_escalation_policies").upsert(
      {
        workspace_id: workspaceId,
        resolution_phone: contact.phone,
        resolution_email: contact.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );
    if (missingContactColumn(error)) {
      throw new AppError("Resolution contact is not stored yet. Apply the latest database migration.", "DB_ERROR", 500);
    }
    if (error) throw new AppError("Could not save the resolution contact.", "DB_ERROR", 500);
    await AuditService.log({
      workspaceId,
      userId,
      action: "escalation.contact_updated",
      entityType: "grm_escalation_policies",
      entityId: workspaceId,
      metadata: { hasPhone: Boolean(contact.phone), hasEmail: Boolean(contact.email) },
    });
    return contact;
  }
}

export interface EscalationQueueItem {
  id: string;
  status: string;
  level: string;
  assignedTo: string | null;
  responsibleUserId: string | null;
  ownership: string;
  assignmentReason: string | null;
  updatedAt: string;
  clientName: string | null;
  groupName: string | null;
  openedAt: string;
  dueAt: string;
  resolvedAt: string | null;
  resolutionCode: string | null;
  resolutionNote: string | null;
  triggerReasons: string[];
  reviewId: string;
  ticketNo: number | null;
  reviewerName: string;
  starRating: number;
  comment: string | null;
  theme: string | null;
  replyStatus: string;
  replyId: string | null;
  replyContent: string;
  locationName: string;
  locationId: string;
  clientId: string | null;
  groupId?: string | null;
  parentGroupId?: string | null;
  events: Array<{ action: string; createdAt: string; metadata: Json; body?: string; actorId?: string | null }>;
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

  static async savePolicy(
    workspaceId: string,
    userId: string,
    policy: EscalationPolicy
  ): Promise<{ created: number }> {
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
    // Open cases for matching synced reviews now — saving alone used to leave the queue empty.
    return this.ensure(workspaceId);
  }

  /** True when the assignment columns from 20261019003 are present. */
  static async assignmentColumnsReady(): Promise<boolean> {
    const admin = createAdminClient();
    const probe = await admin.from("grm_escalations").select("assignment_decided_at").limit(1);
    return !probe.error;
  }

  /** Creates one open escalation per matching review. The same trigger key is ignored. */
  static async ensure(workspaceId: string): Promise<{ created: number }> {
    const admin = createAdminClient();
    const policy = await this.policy(workspaceId);
    const reviewSelect =
      "id, star_rating, comment, review_create_time, location_id, complaint_theme" as const;
    // Prefer low-star rows, then recent commented rows for keyword / safety checks.
    // A plain latest-300 scan misses older complaints when other clients dominate the feed.
    const [byStars, recentCommented] = await Promise.all([
      admin
        .from("grm_reviews")
        .select(reviewSelect)
        .eq("workspace_id", workspaceId)
        .lte("star_rating", policy.maxStars)
        .order("review_create_time", { ascending: false })
        .limit(500),
      admin
        .from("grm_reviews")
        .select(reviewSelect)
        .eq("workspace_id", workspaceId)
        .not("comment", "is", null)
        .order("review_create_time", { ascending: false })
        .limit(250),
    ]);
    if (byStars.error || recentCommented.error) {
      throw new AppError("Could not read reviews for escalation.", "DB_ERROR", 500);
    }
    const reviews = [
      ...new Map(
        [...(byStars.data ?? []), ...(recentCommented.data ?? [])].map((row) => [row.id, row])
      ).values(),
    ];

    const matches = reviews
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
    const existing: Array<{ id: string; review_id: string; trigger_key: string; status: string }> = [];
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      const page = await admin
        .from("grm_escalations")
        .select("id, review_id, trigger_key, status")
        .eq("workspace_id", workspaceId)
        .in("review_id", chunk);
      if (page.error) throw new AppError("Could not read existing escalations.", "DB_ERROR", 500);
      existing.push(...(page.data ?? []));
    }

    const open = new Set(
      existing.filter((row) => row.status !== "resolved").map((row) => row.review_id)
    );
    const keys = new Set(existing.map((row) => `${row.review_id}:${row.trigger_key}`));
    const byReview = new Map(existing.map((row) => [row.review_id, row]));

    const [timing, assignmentReady] = await Promise.all([
      escalationTiming(
        workspaceId,
        matches.map((item) => item.review.location_id),
        policy.dueHours
      ),
      EscalationService.assignmentColumnsReady(),
    ]);
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
            ...(assignmentReady ? { assignment_decided_at: null, sla_advanced_at: null } : {}),
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
          metadata: { reasons: item.reasons, source: "rules", model: null },
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
        metadata: { reasons: item.reasons, source: "rules", model: null },
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
    await this.settleOpenAssignments(workspaceId);
    return { created };
  }

  /**
   * Assigns open cases that have no owner yet, and corrects automatic fallbacks
   * when a manager or an admin should have the case. Manual reassignments are left alone.
   */
  static async settleOpenAssignments(workspaceId: string, focusId?: string): Promise<number> {
    const admin = createAdminClient();
    const [pending, automatic] = await Promise.all([
      admin
        .from("grm_escalations")
        .select("id, location_id, assignee_user_id")
        .eq("workspace_id", workspaceId)
        .is("assignment_decided_at", null)
        .neq("status", "resolved")
        .limit(50),
      admin
        .from("grm_escalations")
        .select("id, location_id, assignee_user_id")
        .eq("workspace_id", workspaceId)
        .eq("ownership", "fallback")
        .in("assignment_reason", [...AUTOMATIC_ASSIGNMENT_REASONS])
        .neq("status", "resolved")
        .limit(80),
    ]);
    if (pending.error) {
      if (/assignment_decided_at/i.test(pending.error.message)) return 0;
      throw new AppError("Could not load unassigned escalations.", "DB_ERROR", 500);
    }
    if (automatic.error && !/assignment_reason|ownership/i.test(automatic.error.message)) {
      throw new AppError("Could not load automatic assignments.", "DB_ERROR", 500);
    }
    const rows = new Map<string, { id: string; location_id: string; assignee_user_id: string | null }>();
    for (const row of [...(pending.data ?? []), ...(automatic.error ? [] : automatic.data ?? [])]) {
      rows.set(row.id, row);
    }
    if (focusId && !rows.has(focusId)) {
      const focus = await admin
        .from("grm_escalations")
        .select("id, location_id, assignee_user_id, status, ownership, assignment_reason, assignment_decided_at")
        .eq("workspace_id", workspaceId)
        .eq("id", focusId)
        .maybeSingle();
      const open = focus.data && focus.data.status !== "resolved";
      const undecided = open && !focus.data?.assignment_decided_at;
      const automaticFallback =
        open &&
        focus.data?.ownership === "fallback" &&
        AUTOMATIC_ASSIGNMENT_REASONS.includes(focus.data.assignment_reason as (typeof AUTOMATIC_ASSIGNMENT_REASONS)[number]);
      if (focus.data && (undecided || automaticFallback)) {
        rows.set(focus.data.id, {
          id: focus.data.id,
          location_id: focus.data.location_id,
          assignee_user_id: focus.data.assignee_user_id,
        });
      }
    }
    if (rows.size === 0) return 0;
    const context = await this.assignmentContext(workspaceId, [...rows.values()].map((row) => row.location_id));
    let settled = 0;
    for (const row of rows.values()) {
      const applied = await this.applyAssignmentPlan(
        workspaceId,
        row.id,
        context.locations.get(row.location_id) ?? null,
        context.members,
        row.assignee_user_id
      );
      if (applied) settled += 1;
    }
    return settled;
  }

  private static async assignmentContext(workspaceId: string, locationIds: string[]): Promise<{
    locations: Map<string, AssignmentLocation & { managerUserId: string | null }>;
    members: Array<AssignmentMember & { alertEmail: boolean; alertInApp: boolean }>;
  }> {
    const admin = createAdminClient();
    const unique = [...new Set(locationIds)];
    const [locations, groups, members] = await Promise.all([
      unique.length
        ? admin
            .from("grm_google_locations")
            .select("id, client_id, group_id, manager_user_id")
            .eq("workspace_id", workspaceId)
            .in("id", unique)
        : Promise.resolve({ data: [], error: null }),
      admin.from("grm_groups").select("id, parent_id").eq("workspace_id", workspaceId),
      admin
        .from("grm_workspace_members")
        .select("user_id, role, access_enabled, scope_client_id, scope_group_id, scope_location_id, alert_email, alert_in_app")
        .eq("workspace_id", workspaceId),
    ]);
    if (locations.error || groups.error || members.error) {
      throw new AppError("Could not load assignment rules.", "DB_ERROR", 500);
    }
    const parentByGroup = new Map((groups.data ?? []).map((group) => [group.id, group.parent_id]));
    return {
      locations: new Map(
        (locations.data ?? []).map((location) => [
          location.id,
          {
            workspaceId,
            clientId: location.client_id,
            groupId: location.group_id,
            parentGroupId: location.group_id ? parentByGroup.get(location.group_id) ?? null : null,
            locationId: location.id,
            managerUserId: location.manager_user_id,
          },
        ])
      ),
      members: (members.data ?? []).map((member) => ({
        userId: member.user_id,
        role: member.role,
        enabled: member.access_enabled !== false,
        scope: {
          clientId: member.scope_client_id,
          groupId: member.scope_group_id,
          locationId: member.scope_location_id,
        },
        alertEmail: member.alert_email,
        alertInApp: member.alert_in_app,
      })),
    };
  }

  /**
   * Writes the owner. A case that already matches this plan is left alone.
   * A manual reassignment (any reason outside the automatic list) is left alone.
   */
  private static async applyAssignmentPlan(
    workspaceId: string,
    escalationId: string,
    location: (AssignmentLocation & { managerUserId: string | null }) | null,
    members: Array<AssignmentMember & { alertEmail: boolean; alertInApp: boolean }>,
    currentAssigneeId: string | null = null
  ): Promise<boolean> {
    const admin = createAdminClient();
    const plan = location
      ? planAssignment({ locationManagerId: location.managerUserId, members, location })
      : {
          responsibleUserId: null,
          assigneeId: null,
          ownership: "fallback" as const,
          reason: "manager_missing" as const,
        };
    if (currentAssigneeId && currentAssigneeId === plan.assigneeId) return false;
    const now = new Date().toISOString();
    const assignee = members.find((member) => member.userId === plan.assigneeId);
    let claim = admin
      .from("grm_escalations")
      .update({
        responsible_user_id: plan.responsibleUserId,
        assignee_user_id: plan.assigneeId,
        ownership: plan.ownership,
        status: plan.assigneeId ? "in_progress" : "needs_human",
        assignment_reason: plan.reason,
        assignment_decided_at: now,
        updated_at: now,
      })
      .eq("id", escalationId)
      .eq("workspace_id", workspaceId)
      .neq("status", "resolved");
    claim = currentAssigneeId
      ? claim.eq("ownership", "fallback").in("assignment_reason", [...AUTOMATIC_ASSIGNMENT_REASONS]).eq("assignee_user_id", currentAssigneeId)
      : claim.is("assignment_decided_at", null);
    const { data, error } = await claim.select("id").maybeSingle();
    if (error || !data) return false;
    const assignedBody = assignmentNotice(plan.reason, plan.ownership, assignee?.role ?? null, Boolean(plan.assigneeId));
    await admin.from("grm_escalation_events").insert({
      workspace_id: workspaceId,
      escalation_id: escalationId,
      kind: "assigned",
      body: assignedBody,
      metadata: {
        assigneeId: plan.assigneeId,
        previousAssigneeId: currentAssigneeId,
        responsibleUserId: plan.responsibleUserId,
        ownership: plan.ownership,
        reason: plan.reason,
        source: "rules",
      },
    });
    if (plan.ownership === "fallback") {
      await admin.from("grm_escalation_events").insert({
        workspace_id: workspaceId,
        escalation_id: escalationId,
        kind: "fallback",
        body: plan.assigneeId
          ? assignee?.role === "owner"
            ? "No manager or admin can take this case. The owner has it until someone reassigns it."
            : "No manager covers this location. An admin has it until the owner or an admin reassigns it."
          : "No manager or admin can take this case.",
        metadata: { reason: plan.reason, assigneeId: plan.assigneeId, responsibleUserId: plan.responsibleUserId },
      });
    }
    const owner = assignee;
    if (owner) await this.notifyOwner(workspaceId, escalationId, owner, plan.ownership === "fallback");
    const actor = members.find((member) => member.role === "owner") ?? owner;
    if (actor) {
      await AuditService.log({
        workspaceId,
        userId: actor.userId,
        action: plan.ownership === "fallback" ? "escalation.fallback" : "escalation.assigned",
        entityType: "grm_escalations",
        entityId: escalationId,
        metadata: { assigneeId: plan.assigneeId, reason: plan.reason, source: "rules" },
      });
    }
    return true;
  }

  private static async notifyOwner(
    workspaceId: string,
    escalationId: string,
    member: { userId: string; alertEmail: boolean; alertInApp: boolean },
    fallback: boolean
  ): Promise<void> {
    const admin = createAdminClient();
    const user = await admin.auth.admin.getUserById(member.userId).catch(() => null);
    const email = user?.data.user?.email ?? null;
    const subject = "Escalation assigned to you";
    const body = fallback
      ? "A complaint had no available manager. You have it until an owner or admin reassigns it."
      : "A complaint was assigned to you because you manage this location, group, or organisation.";
    let emailStatus = "not_requested";
    if (member.alertEmail && email) {
      const result = await deliverMessage({
        env: readDeliveryEnv(process.env),
        channel: "email",
        recipient: email,
        subject,
        body,
      });
      emailStatus = result.status;
    }
    if (member.alertInApp) {
      const { data: escalation } = await admin
        .from("grm_escalations")
        .select("location_id")
        .eq("id", escalationId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (escalation?.location_id) {
        const { notifyProfileEvent } = await import("@/lib/services/notifications");
        await notifyProfileEvent({
          workspaceId,
          locationId: escalation.location_id,
          kind: "escalation_assigned",
          detail: body,
          href: `/escalations/${escalationId}`,
          dedupeKey: `escalation_assigned:${escalationId}:${member.userId}`,
          userIds: [member.userId],
        });
      }
    }
    await admin.from("grm_escalation_events").insert({
      workspace_id: workspaceId,
      escalation_id: escalationId,
      kind: "notified",
      body: member.alertInApp
        ? "In-app notice recorded. Email is sent only when that member asked for email and the provider is configured."
        : "Assignment recorded. This member turned in-app alerts off.",
      metadata: { userId: member.userId, email: emailStatus, inApp: member.alertInApp },
    });
  }

  /**
   * Records a due reminder once. A second run sees sent_at and does nothing.
   * The assignee gets a bell notice when in-app alerts are on. No email is sent.
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

    const escalationIds = [...new Set((due ?? []).map((reminder) => reminder.escalation_id))];
    const [owner, cases] = await Promise.all([
      admin
        .from("grm_workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle(),
      escalationIds.length
        ? admin
            .from("grm_escalations")
            .select("id, assignee_user_id, location_id")
            .eq("workspace_id", workspaceId)
            .in("id", escalationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const caseById = new Map((cases.data ?? []).map((row) => [row.id, row]));

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
        body: "Reminder recorded. The assignee sees it in the bell when in-app alerts are on. No email was sent.",
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
      const assigned = caseById.get(reminder.escalation_id);
      if (assigned?.location_id) {
        const { notifyProfileEvent } = await import("@/lib/services/notifications");
        await notifyProfileEvent({
          workspaceId,
          locationId: assigned.location_id,
          kind: "sla_reminder",
          detail: "A complaint is due for a reminder.",
          href: `/escalations/${assigned.id}`,
          dedupeKey: `sla_reminder:${reminder.id}`,
          ...(assigned.assignee_user_id ? { userIds: [assigned.assignee_user_id] } : {}),
        });
      }
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

  /**
   * Moves an overdue case one level, once. The claim matches the current level and an empty sla_advanced_at,
   * so a retry does not take the next step.
   */
  static async advanceOverdue(workspaceId: string): Promise<{ advanced: number }> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const due = await admin
      .from("grm_escalations")
      .select("id, level, due_at, status, assignee_user_id, location_id")
      .eq("workspace_id", workspaceId)
      .neq("status", "resolved")
      .lt("due_at", now)
      .is("sla_advanced_at", null)
      .limit(50);
    if (due.error) {
      if (/sla_advanced_at/i.test(due.error.message)) return { advanced: 0 };
      throw new AppError("Could not read overdue escalations.", "DB_ERROR", 500);
    }
    const rows = due.data ?? [];
    if (rows.length === 0) return { advanced: 0 };
    const context = await this.assignmentContext(workspaceId, rows.map((row) => row.location_id));
    let advanced = 0;
    for (const row of rows) {
      const level = (row.level === "regional" || row.level === "leadership" ? row.level : "store") as EscalationLevel;
      const next = nextEscalationLevel(level);
      const location = context.locations.get(row.location_id) ?? null;
      const assigneeId = next && location
        ? planLevelOwner(next, context.members, location, row.assignee_user_id)
        : row.assignee_user_id;
      const claimed = await admin
        .from("grm_escalations")
        .update({
          level: next ?? level,
          assignee_user_id: assigneeId,
          sla_advanced_at: now,
          updated_at: now,
          ...(assigneeId ? { status: "in_progress" as const } : {}),
        })
        .eq("id", row.id)
        .eq("workspace_id", workspaceId)
        .eq("level", row.level)
        .eq("due_at", row.due_at)
        .is("sla_advanced_at", null)
        .neq("status", "resolved")
        .select("id");
      if (claimed.error || !claimed.data?.length) continue;
      advanced += 1;
      await admin.from("grm_escalation_events").insert({
        workspace_id: workspaceId,
        escalation_id: row.id,
        kind: next ? "level_changed" : "overdue_noted",
        body: next
          ? `Moved from ${level} to ${next} because the SLA passed. The due time is unchanged.`
          : "Still overdue at leadership. The level did not change.",
        metadata: {
          from: level,
          to: next ?? level,
          previousAssigneeId: row.assignee_user_id,
          assigneeId,
          automatic: true,
        },
      });
      const owner = context.members.find((member) => member.userId === assigneeId);
      if (owner && owner.userId !== row.assignee_user_id) {
        await this.notifyOwner(workspaceId, row.id, owner, false);
      }
    }
    return { advanced };
  }

  /** Opens matching complaints, records due reminders, and moves each overdue case one level. */
  static async runScheduled(workspaceId: string): Promise<{
    created: number;
    reminders: number;
    advanced: number;
    autoreplies: "paused" | "no_autoreply_worker";
  }> {
    const created = await this.ensure(workspaceId);
    const [reminders, advanced, pauses] = await Promise.all([
      this.processReminders(workspaceId),
      this.advanceOverdue(workspaceId),
      this.pausedTargets(workspaceId),
    ]);
    const paused = pauses.workspace || pauses.locationIds.length > 0 || pauses.clientIds.length > 0;
    return {
      created: created.created,
      reminders: reminders.recorded,
      advanced: advanced.advanced,
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
    query: string | null;
    sort: "due" | "opened";
    page: number;
    pageSize: number;
  }): Promise<{ items: EscalationQueueItem[]; total: number }> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    // Scope through location_id on escalations — never materialise every review id into .in().
    let scopedLocationIds: string[] | null = null;
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
      scopedLocationIds = (locationRows.data ?? []).map((row) => row.id);
      if (scopedLocationIds.length === 0) return { items: [], total: 0 };
    }
    let searchReviewIds: string[] | null = null;
    let ticketNo: number | null = null;
    const needle = input.query?.replace(/[%_,]/g, " ").trim().slice(0, 80) ?? "";
    const ticketMatch = needle.match(/^(?:esc-)?(\d+)$/i);
    if (ticketMatch) ticketNo = Number(ticketMatch[1]);
    if (needle && ticketNo === null) {
      const pattern = `%${needle}%`;
      let textQuery = admin
        .from("grm_reviews")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .or(`reviewer_display_name.ilike.${pattern},comment.ilike.${pattern}`)
        .limit(200);
      let placeQuery = admin
        .from("grm_google_locations")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .ilike("location_title", pattern)
        .limit(50);
      if (scopedLocationIds) {
        textQuery = textQuery.in("location_id", scopedLocationIds);
        placeQuery = placeQuery.in("id", scopedLocationIds);
      }
      const [byText, byLocation] = await Promise.all([textQuery, placeQuery]);
      if (byText.error || byLocation.error) throw new AppError("Could not search escalations.", "DB_ERROR", 500);
      const placeIds = (byLocation.data ?? []).map((row) => row.id);
      const byPlace = placeIds.length
        ? await admin
            .from("grm_reviews")
            .select("id")
            .eq("workspace_id", input.workspaceId)
            .in("location_id", placeIds)
            .limit(200)
        : { data: [], error: null };
      if (byPlace.error) throw new AppError("Could not search escalations.", "DB_ERROR", 500);
      searchReviewIds = [
        ...new Set([
          ...(byText.data ?? []).map((row) => row.id),
          ...(byPlace.data ?? []).map((row) => row.id),
        ]),
      ];
      if (searchReviewIds.length === 0) return { items: [], total: 0 };
    }
    const assignmentReady = await EscalationService.assignmentColumnsReady();
    let query = admin
      .from("grm_escalations")
      .select(
        "id, status, level, assignee_user_id, updated_at, opened_at, due_at, resolved_at, resolution_code, internal_note, trigger_reasons, review_id, ticket_no",
        { count: "exact" }
      )
      .eq("workspace_id", input.workspaceId);

    if (input.bucket === "resolved") query = query.eq("status", "resolved");
    else if (input.bucket === "past_sla") query = query.neq("status", "resolved").lt("due_at", now);
    else if (input.bucket === "in_progress") {
      query = query.eq("status", "in_progress").gte("due_at", now);
    } else query = query.eq("status", "needs_human").gte("due_at", now);
    if (scopedLocationIds) query = query.in("location_id", scopedLocationIds);
    if (ticketNo !== null) query = query.eq("ticket_no", ticketNo);
    if (searchReviewIds) query = query.in("review_id", searchReviewIds);
    if (input.since) query = query.gte("opened_at", input.since);
    if (input.until) query = query.lte("opened_at", input.until);

    const from = (input.page - 1) * input.pageSize;
    const orderColumn = input.sort === "opened" ? "opened_at" : "due_at";
    const { data, error, count } = await query
      .order(orderColumn, { ascending: input.bucket !== "resolved" })
      .range(from, from + input.pageSize - 1);
    if (error) {
      logger.error("escalations.queue_failed", {
        workspaceId: input.workspaceId,
        bucket: input.bucket,
        message: error.message,
        code: error.code,
      });
      throw new AppError("Could not load the escalation queue.", "DB_ERROR", 500);
    }

    const rows = data ?? [];
    const owners = new Map<string, { responsibleUserId: string | null; ownership: string; assignmentReason: string | null }>();
    if (assignmentReady && rows.length > 0) {
      const extra = await admin
        .from("grm_escalations")
        .select("id, responsible_user_id, ownership, assignment_reason")
        .in("id", rows.map((row) => row.id));
      for (const row of extra.data ?? []) {
        owners.set(row.id, {
          responsibleUserId: row.responsible_user_id,
          ownership: row.ownership === "manager" ? "manager" : "fallback",
          assignmentReason: row.assignment_reason,
        });
      }
    }
    const pageReviewIds = rows.map((row) => row.review_id);
    const escalationIds = rows.map((row) => row.id);
    const [reviews, events, replies] = await Promise.all([
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
      pageReviewIds.length
        ? admin
            .from("grm_review_replies")
            .select("id, review_id, content, status, created_at")
            .eq("workspace_id", input.workspaceId)
            .in("review_id", pageReviewIds)
            .in("status", ["draft", "approved", "failed"])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reviews.error || events.error || replies.error) throw new AppError("Could not load escalation details.", "DB_ERROR", 500);
    const latestReply = new Map<string, { id: string; content: string }>();
    for (const reply of replies.data ?? []) {
      if (!latestReply.has(reply.review_id)) latestReply.set(reply.review_id, { id: reply.id, content: reply.content });
    }

    const locationIds = [...new Set((reviews.data ?? []).map((review) => review.location_id))];
    const locations = locationIds.length
      ? await admin.from("grm_google_locations").select("id, location_title, client_id, group_id").in("id", locationIds)
      : { data: [], error: null };
    if (locations.error) throw new AppError("Could not load locations.", "DB_ERROR", 500);
    const clientIds = [...new Set((locations.data ?? []).flatMap((location) => (location.client_id ? [location.client_id] : [])))];
    const groupIds = [...new Set((locations.data ?? []).flatMap((location) => (location.group_id ? [location.group_id] : [])))];
    const [clients, groups] = await Promise.all([
      clientIds.length
        ? admin.from("grm_clients").select("id, name").eq("workspace_id", input.workspaceId).in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      groupIds.length
        ? admin.from("grm_groups").select("id, name").eq("workspace_id", input.workspaceId).in("id", groupIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (clients.error || groups.error) throw new AppError("Could not load escalation context.", "DB_ERROR", 500);

    const reviewMap = new Map((reviews.data ?? []).map((review) => [review.id, review]));
    const locationMap = new Map((locations.data ?? []).map((location) => [location.id, location]));
    const clientNames = new Map((clients.data ?? []).map((client) => [client.id, client.name]));
    const groupNames = new Map((groups.data ?? []).map((group) => [group.id, group.name]));

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
        responsibleUserId: owners.get(row.id)?.responsibleUserId ?? null,
        ownership: owners.get(row.id)?.ownership ?? "",
        assignmentReason: owners.get(row.id)?.assignmentReason ?? null,
        updatedAt: row.updated_at,
        clientName: location?.client_id ? clientNames.get(location.client_id) ?? null : null,
        groupName: location?.group_id ? groupNames.get(location.group_id) ?? null : null,
        openedAt: row.opened_at,
        dueAt: row.due_at,
        resolvedAt: row.resolved_at,
        resolutionCode: row.resolution_code,
        resolutionNote: row.internal_note,
        triggerReasons: row.trigger_reasons,
        reviewId: review.id,
        ticketNo: row.ticket_no,
        reviewerName: review.reviewer_display_name,
        starRating: review.star_rating,
        comment: review.comment,
        theme: review.complaint_theme,
        replyStatus: review.reply_status,
        replyId: latestReply.get(review.id)?.id ?? null,
        replyContent: latestReply.get(review.id)?.content ?? "",
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
    let scopedLocationIds: string[] | null = null;
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
      scopedLocationIds = (locationRows.data ?? []).map((row) => row.id);
      if (scopedLocationIds.length === 0) return { needs_human: 0, in_progress: 0, past_sla: 0, resolved: 0 };
    }
    const head = (status?: string, past?: boolean, open?: boolean) => {
      let query = admin
        .from("grm_escalations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      if (scopedLocationIds) query = query.in("location_id", scopedLocationIds);
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

  static async get(workspaceId: string, escalationId: string): Promise<EscalationQueueItem | null> {
    const admin = createAdminClient();
    const row = await admin
      .from("grm_escalations")
      .select(
        "id, status, level, assignee_user_id, updated_at, opened_at, due_at, resolved_at, resolution_code, internal_note, trigger_reasons, review_id, ticket_no, location_id"
      )
      .eq("workspace_id", workspaceId)
      .eq("id", escalationId)
      .maybeSingle();
    if (row.error) throw new AppError("Could not load this case.", "DB_ERROR", 500);
    if (!row.data) return null;
    const current = row.data;
    const [reviewResult, locationResult, events, replyResult, ownerResult] = await Promise.all([
      admin
        .from("grm_reviews")
        .select("id, reviewer_display_name, star_rating, comment, complaint_theme, reply_status")
        .eq("id", current.review_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      admin
        .from("grm_google_locations")
        .select("id, location_title, client_id, group_id")
        .eq("id", current.location_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      admin
        .from("grm_escalation_events")
        .select("kind, created_at, metadata, body, actor_id")
        .eq("workspace_id", workspaceId)
        .eq("escalation_id", escalationId)
        .order("created_at", { ascending: true })
        .limit(100),
      admin
        .from("grm_review_replies")
        .select("id, content, status, created_at")
        .eq("workspace_id", workspaceId)
        .eq("review_id", current.review_id)
        .in("status", ["draft", "approved", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("grm_escalations")
        .select("responsible_user_id, ownership, assignment_reason")
        .eq("id", escalationId)
        .maybeSingle(),
    ]);
    if (reviewResult.error || locationResult.error || events.error || replyResult.error || !reviewResult.data) {
      throw new AppError("Could not load this case.", "DB_ERROR", 500);
    }
    const location = locationResult.data;
    const [clientName, groupName] = await Promise.all([
      location?.client_id
        ? admin.from("grm_clients").select("name").eq("id", location.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      location?.group_id
        ? admin.from("grm_groups").select("name, parent_id").eq("id", location.group_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const reply = replyResult.data;
    const owner = ownerResult.error ? null : ownerResult.data;
    return {
      id: current.id,
      status: current.status,
      level: current.level,
      assignedTo: current.assignee_user_id,
      responsibleUserId: owner?.responsible_user_id ?? null,
      ownership: owner?.ownership === "manager" ? "manager" : owner?.ownership === "fallback" ? "fallback" : "",
      assignmentReason: owner?.assignment_reason ?? null,
      updatedAt: current.updated_at,
      clientName: clientName.data?.name ?? null,
      groupName: groupName.data?.name ?? null,
      openedAt: current.opened_at,
      dueAt: current.due_at,
      resolvedAt: current.resolved_at,
      resolutionCode: current.resolution_code,
      resolutionNote: current.internal_note,
      triggerReasons: current.trigger_reasons,
      reviewId: reviewResult.data.id,
      ticketNo: current.ticket_no,
      reviewerName: reviewResult.data.reviewer_display_name || "No name stored",
      starRating: reviewResult.data.star_rating,
      comment: reviewResult.data.comment,
      theme: reviewResult.data.complaint_theme,
      replyStatus: reviewResult.data.reply_status,
      replyId: reply?.id ?? null,
      replyContent: reply?.content ?? "",
      locationName: location?.location_title ?? "Location",
      locationId: current.location_id,
      clientId: location?.client_id ?? null,
      groupId: location?.group_id ?? null,
      parentGroupId: groupName.data?.parent_id ?? null,
      events: (events.data ?? []).map((event) => ({
        action: event.kind,
        createdAt: event.created_at,
        metadata: event.metadata,
        body: event.body,
        actorId: event.actor_id,
      })),
    };
  }

  static async start(input: { workspaceId: string; escalationId: string; actorId: string }): Promise<void> {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("grm_escalations")
      .update({ status: "in_progress", updated_at: now })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .eq("status", "needs_human")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new ValidationError("This case is already in progress or resolved.");
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "status_changed",
      body: "Status set to in progress.",
      metadata: { status: "in_progress" },
    });
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.started",
      entityType: "grm_escalations",
      entityId: input.escalationId,
    });
  }

  static async comment(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    body: string;
  }): Promise<void> {
    const body = input.body.trim();
    if (body.length < 1 || body.length > 2000) throw new ValidationError("Write a comment of 2,000 characters or fewer.");
    const admin = createAdminClient();
    const current = await admin
      .from("grm_escalations")
      .select("id")
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (current.error || !current.data) throw new AppError("That case is not in this organization.", "NOT_FOUND", 404);
    const now = new Date().toISOString();
    const { error } = await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "comment",
      body,
      metadata: {},
    });
    if (error) throw new AppError("Could not save the comment.", "DB_ERROR", 500);
    await admin
      .from("grm_escalations")
      .update({ updated_at: now })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.commented",
      entityType: "grm_escalations",
      entityId: input.escalationId,
    });
  }

  static async assign(input: {
    workspaceId: string;
    escalationId: string;
    actorId: string;
    assigneeId: string;
    reason: string;
    expectedUpdatedAt: string;
  }): Promise<void> {
    const admin = createAdminClient();
    const assignmentReady = await EscalationService.assignmentColumnsReady();
    const current = await admin
      .from("grm_escalations")
      .select("id, location_id, assignee_user_id, updated_at, status")
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (current.error || !current.data) throw new AppError("Could not assign this escalation.", "DB_ERROR", 400);
    if (current.data.status === "resolved") throw new ValidationError("A resolved case cannot be reassigned.");
    const context = await this.assignmentContext(input.workspaceId, [current.data.location_id]);
    const location = context.locations.get(current.data.location_id);
    if (!location) throw new ValidationError("That location is not in this workspace.");
    const actor = context.members.find((member) => member.userId === input.actorId) ?? null;
    const target = context.members.find((member) => member.userId === input.assigneeId) ?? null;
    const problem = reassignmentError({
      actorCanAssign: canReassignEscalation(actor?.role),
      target,
      location,
      reason: input.reason,
      currentUpdatedAt: current.data.updated_at,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    if (problem) throw new ValidationError(problem);
    if (current.data.assignee_user_id === input.assigneeId) return;
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("grm_escalations")
      .update({
        assignee_user_id: input.assigneeId,
        ...(assignmentReady ? { assignment_reason: input.reason.trim() } : {}),
        status: "in_progress",
        updated_at: now,
      })
      .eq("id", input.escalationId)
      .eq("workspace_id", input.workspaceId)
      .eq("updated_at", input.expectedUpdatedAt)
      .neq("status", "resolved")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new ValidationError("This case changed. Refresh and try again.");
    let responsibleUserId: string | null = null;
    if (assignmentReady) {
      const owner = await admin
        .from("grm_escalations")
        .select("responsible_user_id")
        .eq("id", input.escalationId)
        .maybeSingle();
      responsibleUserId = owner.data?.responsible_user_id ?? null;
    }
    await admin.from("grm_escalation_events").insert({
      workspace_id: input.workspaceId,
      escalation_id: input.escalationId,
      actor_id: input.actorId,
      kind: "assigned",
      body: "Reassigned. The responsible manager was left in place.",
      metadata: {
        previousAssigneeId: current.data.assignee_user_id,
        assigneeId: input.assigneeId,
        responsibleUserId,
        reason: input.reason.trim(),
        actorId: input.actorId,
        at: now,
      },
    });
    const owner = context.members.find((member) => member.userId === input.assigneeId);
    if (owner) await this.notifyOwner(input.workspaceId, input.escalationId, owner, false);
    await AuditService.log({
      workspaceId: input.workspaceId,
      userId: input.actorId,
      action: "escalation.assigned",
      entityType: "grm_escalations",
      entityId: input.escalationId,
      metadata: {
        previousAssigneeId: current.data.assignee_user_id,
        assigneeId: input.assigneeId,
        reason: input.reason.trim(),
      },
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
    await this.settleOpenAssignments(input.workspaceId);
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
