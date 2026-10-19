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
    detail: "Records that someone should apologise and call. It does not mean the call happened.",
  },
  {
    id: "replacement_arranged",
    label: "Replacement arranged",
    detail: "Records replacement as the next step. It does not mean a replacement was delivered.",
  },
  {
    id: "store_visit_scheduled",
    label: "Store visit scheduled",
    detail: "Records a store visit as the next step. It does not mean the visit happened.",
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
  | "manager_missing"
  | "manager_inactive"
  | "manager_unauthorised"
  | "no_administrator";

export interface AssignmentPlan {
  /** Configured location manager, kept even when that person cannot take the case. */
  responsibleUserId: string | null;
  assigneeId: string | null;
  ownership: "manager" | "fallback";
  reason: AssignmentReason;
}

const FALLBACK_ROLES = ["owner", "org_admin", "admin"];

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

/**
 * The location manager owns the case when they are an active member who can see that location.
 * Otherwise an active organisation admin in scope owns it, and the case is marked as a fallback.
 */
export function planAssignment(input: {
  locationManagerId: string | null;
  members: AssignmentMember[];
  location: AssignmentLocation;
}): AssignmentPlan {
  const manager = input.locationManagerId
    ? input.members.find((member) => member.userId === input.locationManagerId) ?? null
    : null;
  if (manager && canTakeCase(manager, input.location)) {
    return {
      responsibleUserId: manager.userId,
      assigneeId: manager.userId,
      ownership: "manager",
      reason: "location_manager",
    };
  }

  const reason: AssignmentReason = !input.locationManagerId
    ? "manager_missing"
    : !manager
      ? "manager_unauthorised"
      : !manager.enabled
        ? "manager_inactive"
        : "manager_unauthorised";
  const fallback = input.members
    .filter((member) => FALLBACK_ROLES.includes(member.role) && canTakeCase(member, input.location))
    .sort((left, right) => {
      const rank = FALLBACK_ROLES.indexOf(left.role) - FALLBACK_ROLES.indexOf(right.role);
      return rank !== 0 ? rank : left.userId.localeCompare(right.userId);
    })[0];
  if (!fallback) {
    return {
      responsibleUserId: input.locationManagerId,
      assigneeId: null,
      ownership: "fallback",
      reason: "no_administrator",
    };
  }
  return {
    responsibleUserId: input.locationManagerId,
    assigneeId: fallback.userId,
    ownership: "fallback",
    reason,
  };
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
