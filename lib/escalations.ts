import { canAct, type ScopeIds } from "@/lib/access";

export const ESCALATION_TIMEZONES = [
  { id: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { id: "UTC", label: "UTC" },
  { id: "Asia/Dubai", label: "Gulf (Asia/Dubai)" },
  { id: "America/New_York", label: "US Eastern (America/New_York)" },
] as const;

export type EscalationTimezone = (typeof ESCALATION_TIMEZONES)[number]["id"];

export const RESOLUTION_ACTIONS = [
  {
    id: "apology_callback",
    label: "Apology and callback",
    detail:
      "Closes the case and emails the organisation resolution address, asking them to call the reviewer. If none is saved, the assignee is emailed. It does not place the call.",
    closed: "The resolution address was asked to call the reviewer. The email does not place the call.",
  },
  {
    id: "replacement_arranged",
    label: "Replacement arranged",
    detail:
      "Closes the case and emails the organisation resolution address with the replacement request. If none is saved, the assignee is emailed. It does not ship a replacement.",
    closed: "The resolution address was asked to arrange the replacement. The email does not ship it.",
  },
  {
    id: "store_visit_scheduled",
    label: "Store visit scheduled",
    detail:
      "Closes the case and emails the organisation resolution address to confirm a store visit. If none is saved, the assignee is emailed. It does not book the visit.",
    closed: "The resolution address was asked to confirm a store visit. The email does not book it.",
  },
] as const;

export type ResolutionCode = (typeof RESOLUTION_ACTIONS)[number]["id"];

export const ESCALATION_LEVELS = [
  { id: "store", label: "Store" },
  { id: "regional", label: "Regional" },
  { id: "leadership", label: "Leadership" },
] as const;

export type EscalationLevel = (typeof ESCALATION_LEVELS)[number]["id"];

export interface EscalationPolicy {
  maxStars: number;
  flagProfanity: boolean;
  flagLegalSafety: boolean;
  extraKeywords: string[];
  reminderHours: number[];
  dueHours: number;
  timezone: EscalationTimezone;
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  maxStars: 3,
  flagProfanity: true,
  flagLegalSafety: true,
  extraKeywords: [],
  reminderHours: [2, 6],
  dueHours: 24,
  timezone: "Asia/Kolkata",
};

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard"];
const LEGAL_SAFETY = [
  "lawsuit",
  "sue ",
  "lawyer",
  "attorney",
  "police",
  "injury",
  "injured",
  "unsafe",
  "harassment",
  "fraud",
  "poison",
  "food poisoning",
];

export type TriggerReason = "rating" | "profanity" | "legal_safety" | "keyword";

function hasWord(text: string, word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^a-z])${escaped}(?:[^a-z]|$)`, "i").test(text);
}

/** The same substrings the escalation rules use for legal and safety text. */
export function legalSafetyTerms(): string[] {
  return LEGAL_SAFETY.map((word) => word.trim()).filter((word) => word.length >= 3);
}
export function legalSafetyMatches(comment: string | null): string[] {
  const text = (comment ?? "").toLowerCase();
  if (!text) return [];
  return LEGAL_SAFETY.filter((word) => text.includes(word.trim())).map((word) => word.trim());
}

export function escalationReasons(
  input: { starRating: number; comment: string | null },
  policy: EscalationPolicy
): TriggerReason[] {
  const reasons: TriggerReason[] = [];
  if (input.starRating <= policy.maxStars) reasons.push("rating");
  const text = (input.comment ?? "").toLowerCase();
  if (policy.flagProfanity && PROFANITY.some((word) => hasWord(text, word))) reasons.push("profanity");
  if (policy.flagLegalSafety && LEGAL_SAFETY.some((word) => text.includes(word.trim()))) {
    reasons.push("legal_safety");
  }
  const extra = policy.extraKeywords.map((word) => word.trim().toLowerCase()).filter((word) => word.length >= 3);
  if (extra.some((word) => text.includes(word))) reasons.push("keyword");
  return reasons;
}

/** An open escalation, or the same trigger key, blocks a second record. */
export function shouldSkipTrigger(input: { hasOpen: boolean; knownKey: boolean }): boolean {
  return input.hasOpen || input.knownKey;
}

export function queueBucket(
  input: { status: string; dueAt: string },
  now: number
): "needs_human" | "in_progress" | "past_sla" | "resolved" {
  if (input.status === "resolved") return "resolved";
  if (Date.parse(input.dueAt) < now) return "past_sla";
  if (input.status === "in_progress") return "in_progress";
  return "needs_human";
}

export function slaClock(dueAt: string, now: number): { remaining: string | null; overdue: string | null } {
  const delta = Date.parse(dueAt) - now;
  const abs = Math.abs(delta);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  if (delta >= 0) return { remaining: label, overdue: null };
  return { remaining: null, overdue: label };
}

export function formatInTimezone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** A public Google reply does not close the escalation. Resolution is a separate recorded action. */
export function closesWhenReplyPublished(): boolean {
  return false;
}

export function ticketKey(ticketNo: number | null): string {
  return ticketNo && ticketNo > 0 ? `ESC-${ticketNo}` : "ESC";
}

export function escalationStatusLabel(status: string): string {
  if (status === "resolved") return "Resolved";
  if (status === "in_progress") return "In progress";
  return "Needs human";
}

function mailRecipients(metadata: Record<string, unknown>): string {
  return Array.isArray(metadata.recipients)
    ? metadata.recipients.filter((item): item is string => typeof item === "string" && item.length > 0).join(", ")
    : "";
}

function resolvedEventLabel(metadata: Record<string, unknown>): string {
  const email = typeof metadata.email === "string" ? metadata.email : "";
  const recipients = mailRecipients(metadata);
  if (email === "sent" && recipients) {
    return `Resolved. Email sent to ${recipients}. This does not place a call, ship a replacement, or book a visit.`;
  }
  if (email === "failed") return "Resolved. The email did not send.";
  if (email === "unavailable") return "Resolved. Email is not configured, so no message was sent.";
  if (email === "no_recipient") return "Resolved. No resolution email or assignee email was available.";
  return "Resolution recorded. This does not confirm a callback, replacement, or visit.";
}

function reminderEventLabel(metadata: Record<string, unknown>): string {
  const hours = String(metadata.kind ?? "");
  const email = typeof metadata.email === "string" ? metadata.email : "";
  const recipients = mailRecipients(metadata);
  if (email === "sent" && recipients) return `Reminder at ${hours} hours emailed to ${recipients}.`;
  if (email === "failed") return `Reminder at ${hours} hours recorded. The email did not send.`;
  if (email === "unavailable") return `Reminder at ${hours} hours recorded. Email is not configured.`;
  if (email === "off") {
    return `Reminder at ${hours} hours recorded in the bell. Email alerts are off for the assignee.`;
  }
  if (email === "no_recipient") return `Reminder at ${hours} hours recorded. The assignee has no email address.`;
  return `Reminder at ${hours} hours recorded. The assignee sees it in the bell when in-app alerts are on. No email was sent.`;
}

export function escalationEventLabel(
  action: string,
  metadata: Record<string, unknown>,
  name: (userId: string | null) => string
): string {
  if (action === "opened") {
    const reasons = metadata.reasons;
    if (Array.isArray(reasons) && reasons.includes("manager_requested")) {
      return "Opened because someone asked a manager to handle it.";
    }
    return "Opened from the complaint rules.";
  }
  if (action === "reopened") return "Reopened because the review changed.";
  if (action === "assigned") {
    const reason = typeof metadata.reason === "string" ? metadata.reason : "";
    const next = name(typeof metadata.assigneeId === "string" ? metadata.assigneeId : null);
    const previous = name(typeof metadata.previousAssigneeId === "string" ? metadata.previousAssigneeId : null);
    return reason
      ? `Assignee changed from ${previous} to ${next}. Reason: ${reason}.`
      : `Assignee changed from ${previous} to ${next}.`;
  }
  if (action === "fallback") return "No manager was available, so an admin owns this case until someone reassigns it.";
  if (action === "notified") return "Notice recorded for the current owner.";
  if (action === "overdue_noted") return "Still overdue at leadership. The level did not change again.";
  if (action === "level_changed") return `Handed to ${String(metadata.level ?? "the next level")}.`;
  if (action === "status_changed") return `Status set to ${escalationStatusLabel(String(metadata.status ?? ""))}.`;
  if (action === "resolved") return resolvedEventLabel(metadata);
  if (action === "next_step") {
    return "Next step recorded. The case stays open until it is resolved, which is when the email is sent.";
  }
  if (action === "reminder_recorded") return reminderEventLabel(metadata);
  if (action === "comment") return "Comment added.";
  return action;
}

export interface AssignmentMember {
  userId: string;
  role: string;
  enabled: boolean;
  scope: ScopeIds;
}

export interface AssignmentLocation {
  workspaceId: string;
  clientId: string | null;
  groupId: string | null;
  parentGroupId: string | null;
  locationId: string;
}

export type AssignmentReason =
  | "location_manager"
  | "group_manager"
  | "organisation_manager"
  | "manager_missing"
  | "manager_inactive"
  | "manager_unauthorised"
  | "no_administrator";

export interface AssignmentPlan {
  /** Manager who should own the case, kept even when that person cannot take it. */
  responsibleUserId: string | null;
  assigneeId: string | null;
  ownership: "manager" | "fallback";
  reason: AssignmentReason;
}

/** Automatic fallback reasons. A manual reassignment stores the person's own reason and is left alone. */
export const AUTOMATIC_ASSIGNMENT_REASONS: AssignmentReason[] = [
  "manager_missing",
  "manager_inactive",
  "manager_unauthorised",
  "no_administrator",
];

const ADMIN_ROLES = ["org_admin", "admin"];
const MANAGER_ROLES = ["store_manager", "group_manager", "brand_manager"];
const RECEIVER_ROLES = ["owner", "org_admin", "admin", ...MANAGER_ROLES];

function locationResource(location: AssignmentLocation) {
  return {
    workspaceId: location.workspaceId,
    clientId: location.clientId,
    groupId: location.groupId,
    parentGroupId: location.parentGroupId,
    locationId: location.locationId,
  };
}

function canTakeCase(member: AssignmentMember, location: AssignmentLocation): boolean {
  return canAct({
    role: member.role,
    enabled: member.enabled,
    permission: "draft",
    scope: member.scope,
    actorWorkspaceId: location.workspaceId,
    resource: locationResource(location),
  });
}

function byUserId(left: AssignmentMember, right: AssignmentMember): number {
  return left.userId.localeCompare(right.userId);
}

function firstAvailable(
  members: AssignmentMember[],
  location: AssignmentLocation,
  match: (member: AssignmentMember) => boolean
): AssignmentMember | null {
  return members.filter((member) => match(member) && canTakeCase(member, location)).sort(byUserId)[0] ?? null;
}

/**
 * The manager for the location owns the case, then the group manager, then the organisation manager.
 * When none of them can take it, any admin does. The owner is used only when the workspace has no admin.
 */
export function planAssignment(input: {
  locationManagerId: string | null;
  members: AssignmentMember[];
  location: AssignmentLocation;
}): AssignmentPlan {
  const designated = input.locationManagerId
    ? input.members.find((member) => member.userId === input.locationManagerId) ?? null
    : null;
  const locationManager =
    designated && canTakeCase(designated, input.location)
      ? designated
      : firstAvailable(
          input.members,
          input.location,
          (member) => member.role === "store_manager" && member.scope.locationId === input.location.locationId
        );
  if (locationManager) {
    return {
      responsibleUserId: locationManager.userId,
      assigneeId: locationManager.userId,
      ownership: "manager",
      reason: "location_manager",
    };
  }

  const groupManager = firstAvailable(
    input.members,
    input.location,
    (member) =>
      member.role === "group_manager" &&
      Boolean(member.scope.groupId) &&
      (member.scope.groupId === input.location.groupId || member.scope.groupId === input.location.parentGroupId)
  );
  if (groupManager) {
    return {
      responsibleUserId: groupManager.userId,
      assigneeId: groupManager.userId,
      ownership: "manager",
      reason: "group_manager",
    };
  }

  const organisationManager = firstAvailable(
    input.members,
    input.location,
    (member) => member.role === "brand_manager" && member.scope.clientId === input.location.clientId
  );
  if (organisationManager) {
    return {
      responsibleUserId: organisationManager.userId,
      assigneeId: organisationManager.userId,
      ownership: "manager",
      reason: "organisation_manager",
    };
  }

  const held =
    designated ??
    input.members.find(
      (member) => member.role === "store_manager" && member.scope.locationId === input.location.locationId
    ) ??
    input.members.find(
      (member) =>
        member.role === "group_manager" &&
        (member.scope.groupId === input.location.groupId || member.scope.groupId === input.location.parentGroupId)
    ) ??
    input.members.find((member) => member.role === "brand_manager" && member.scope.clientId === input.location.clientId) ??
    null;
  const reason: AssignmentReason = !input.locationManagerId && !held
    ? "manager_missing"
    : held && !held.enabled
      ? "manager_inactive"
      : input.locationManagerId || held
        ? "manager_unauthorised"
        : "manager_missing";
  const admin = input.members
    .filter((member) => ADMIN_ROLES.includes(member.role) && canTakeCase(member, input.location))
    .sort((left, right) => {
      const rank = ADMIN_ROLES.indexOf(left.role) - ADMIN_ROLES.indexOf(right.role);
      return rank !== 0 ? rank : left.userId.localeCompare(right.userId);
    })[0];
  const owner = input.members
    .filter((member) => member.role === "owner" && canTakeCase(member, input.location))
    .sort(byUserId)[0];
  const fallback = admin ?? owner ?? null;
  if (!fallback) {
    return {
      responsibleUserId: input.locationManagerId ?? held?.userId ?? null,
      assigneeId: null,
      ownership: "fallback",
      reason: "no_administrator",
    };
  }
  return {
    responsibleUserId: input.locationManagerId ?? held?.userId ?? null,
    assigneeId: fallback.userId,
    ownership: "fallback",
    reason,
  };
}

export function canReassignEscalation(role: string | null | undefined): boolean {
  return role === "owner" || role === "org_admin" || role === "admin";
}

export function canReceiveEscalation(member: AssignmentMember, location: AssignmentLocation): boolean {
  return RECEIVER_ROLES.includes(member.role) && canTakeCase(member, location);
}

/** One automatic step. Leadership stays at leadership. */
export function nextEscalationLevel(level: EscalationLevel): EscalationLevel | null {
  if (level === "store") return "regional";
  if (level === "regional") return "leadership";
  return null;
}

/**
 * A claimed overdue case moves one level. A lost claim, a future due time, or a resolved case does nothing.
 * Leadership records the overdue state once.
 */
export function overdueStep(input: {
  status: string;
  level: EscalationLevel;
  dueAt: string;
  now: string;
  claimed: boolean;
}): "wait" | "skip" | "advance" | "note" {
  if (input.status === "resolved") return "skip";
  if (Date.parse(input.now) < Date.parse(input.dueAt)) return "wait";
  if (!input.claimed) return "skip";
  return nextEscalationLevel(input.level) ? "advance" : "note";
}

/** The next level's owner. The current assignee stays when nobody at that level can see the location. */
export function planLevelOwner(
  level: EscalationLevel,
  members: AssignmentMember[],
  location: AssignmentLocation,
  currentAssigneeId: string | null
): string | null {
  const eligible = members.filter((member) => canTakeCase(member, location));
  const pick = (roles: string[]) =>
    eligible.filter((member) => roles.includes(member.role)).sort((left, right) => left.userId.localeCompare(right.userId))[0];
  if (level === "regional") {
    return pick(["group_manager"])?.userId ?? pick(["brand_manager"])?.userId ?? currentAssigneeId;
  }
  if (level === "leadership") {
    return pick(["owner"])?.userId ?? pick(["org_admin", "admin"])?.userId ?? currentAssigneeId;
  }
  return currentAssigneeId;
}

export function reassignmentError(input: {
  actorCanAssign: boolean;
  target: AssignmentMember | null;
  location: AssignmentLocation;
  reason: string;
  currentUpdatedAt: string;
  expectedUpdatedAt: string;
}): string | null {
  if (!input.actorCanAssign) return "You do not have permission to reassign this case.";
  if (input.currentUpdatedAt !== input.expectedUpdatedAt) return "This case changed. Refresh and try again.";
  if (input.reason.trim().length < 3) return "Enter a reason for the reassignment.";
  if (!input.target) return "That person is not in this workspace.";
  if (!input.target.enabled) return "That person is not active.";
  if (!RECEIVER_ROLES.includes(input.target.role)) return "Assign the case to a manager or an admin.";
  if (!canTakeCase(input.target, input.location)) return "That person cannot take cases for this location.";
  return null;
}

/** Organisation, group (including its cities), or one location. An empty scope is the whole workspace. */
export function escalationVisibleInScope(input: {
  caseClientId: string | null;
  caseGroupId: string | null;
  caseLocationId: string;
  scope: { clientId: string | null; groupId: string | null; locationId: string | null; groupIds: string[] };
}): boolean {
  if (input.scope.locationId) return input.caseLocationId === input.scope.locationId;
  if (input.scope.groupId) return Boolean(input.caseGroupId && input.scope.groupIds.includes(input.caseGroupId));
  if (input.scope.clientId) return input.caseClientId === input.scope.clientId;
  return true;
}

export function autoreplyPausedFor(input: {
  pauses: Array<{ scope: string; clientId: string | null; locationId: string | null }>;
  clientId: string | null;
  locationId: string | null;
}): boolean {
  return input.pauses.some(
    (pause) =>
      pause.scope === "workspace" ||
      (pause.scope === "client" && pause.clientId && pause.clientId === input.clientId) ||
      (pause.scope === "location" && pause.locationId && pause.locationId === input.locationId)
  );
}
