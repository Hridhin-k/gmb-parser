import { getAuthUserById } from "@/lib/auth/users";
import { createAdminClient } from "@/lib/db/client";
import { canAct, reviewPermission, type ResourceRef } from "@/lib/access";
import { ESCALATION_LEVELS } from "@/lib/escalations";
import { reviewWindow } from "@/lib/metrics";
import {
  countDeltaLabel,
  mobileDateRange,
  mobileHref,
  mobileRangeKey,
  oneId,
  ratingDeltaLabel,
  relativeTime,
  replyRateLabel,
  skippedIds,
  slaRemaining,
  themeBars,
  weekBrief,
  type MobileRangeKey,
} from "@/lib/mobile-work";
import { checkReplyGuardrails } from "@/lib/reply-guardrails";
import { themeLabel } from "@/lib/review-inbox";
import { splitGoogleTranslation } from "@/lib/review-text";
import { getMemberAccess, visibleClientIds, type MemberAccess } from "@/lib/services/access";
import { EscalationContactStore } from "@/lib/services/escalations";
import { readPageScope } from "@/lib/services/scope-catalog";
import {
  getDashboardContext,
  loadDashboardWindowFacts,
  type DashboardLocation,
  type DashboardScope,
} from "@/lib/services/dashboard-metrics";

const NIL = "00000000-0000-0000-0000-000000000000";
const QUEUE_LIMIT = 40;

export interface MobileClientOption {
  id: string;
  name: string;
}

export interface MobileAlert {
  id: string;
  text: string;
  href: string;
}

export interface MobileOverview {
  rangeKey: MobileRangeKey;
  rangeLabel: string;
  clientId: string | null;
  clients: MobileClientOption[];
  chooseClient: boolean;
  unknownClient: boolean;
  scopeLabel: string;
  brief: string;
  average: string;
  ratingDelta: string | null;
  replyRate: string;
  replyDetail: string;
  newReviews: number;
  reviewDelta: string | null;
  openEscalations: number;
  overdueEscalations: number;
  alerts: MobileAlert[];
  themes: Array<{ id: string; label: string; count: number; width: number; stars?: import("@/lib/metrics").StarCounts }>;
  approveHref: string;
  escalationsHref: string;
  sevenHref: string;
  thirtyHref: string;
}

export interface MobileApprovalCard {
  reviewId: string;
  replyId: string | null;
  replyStatus: string | null;
  content: string;
  starRating: number;
  reviewerName: string;
  when: string;
  original: string | null;
  translation: string | null;
  locationName: string;
  position: number;
  total: number;
  skipped: number;
  canPublish: boolean;
  canDraft: boolean;
  violations: string[];
  sameNameCount: number;
  openEscalationId: string | null;
  publishableIds: string[];
}

export interface MobileApproval {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  clients: MobileClientOption[];
  card: MobileApprovalCard | null;
  skippedIds: string[];
  clearSkipHref: string;
  clientHrefs: Array<{ id: string; name: string; href: string }>;
  resolutionPhone: string | null;
  resolutionEmail: string | null;
}

export interface MobileNote {
  id: string;
  body: string;
  when: string;
}

export interface MobileComplaintCard {
  id: string;
  reviewId: string;
  locationName: string;
  assigneeLabel: string;
  levelLabel: string;
  level: string;
  slaLabel: string;
  overdue: boolean;
  starRating: number;
  reviewerName: string;
  when: string;
  original: string | null;
  translation: string | null;
  theme: string | null;
  sameNameCount: number;
  notes: MobileNote[];
  escalationNote: string | null;
  replyId: string | null;
  replyContent: string;
  resolutionCode: string | null;
  canPassRegional: boolean;
  canDraft: boolean;
  photosStored: boolean;
  position: number;
  total: number;
  violations: string[];
}

export interface MobileComplaint {
  clientId: string | null;
  groupId: string | null;
  locationId: string | null;
  clients: MobileClientOption[];
  card: MobileComplaintCard | null;
  missingId: boolean;
  clientHrefs: Array<{ id: string; name: string; href: string }>;
  resolutionPhone: string | null;
  resolutionEmail: string | null;
}

interface Placed {
  access: MemberAccess;
  scope: DashboardScope;
  denied: boolean;
  dropped: boolean;
  title: string;
}

function keptId(id: string | null): string | null {
  return id && id !== NIL ? id : null;
}

function scopeQuery(scope: DashboardScope): { client: string | null; group: string | null; location: string | null } {
  return {
    client: keptId(scope.clientId),
    group: keptId(scope.groupId),
    location: keptId(scope.locationId),
  };
}

async function placed(
  workspaceId: string,
  userId: string,
  params: { client?: unknown; group?: unknown; location?: unknown }
): Promise<Placed | null> {
  const access = await getMemberAccess(userId, workspaceId);
  if (!access?.enabled) return null;
  const resolved = await readPageScope(userId, workspaceId, {
    client: typeof params.client === "string" ? params.client : undefined,
    group: typeof params.group === "string" ? params.group : undefined,
    location: typeof params.location === "string" ? params.location : undefined,
  });
  return {
    access,
    denied: resolved.blocked,
    dropped: resolved.dropped,
    title: resolved.title,
    scope: {
      clientId: resolved.clientId,
      groupId: resolved.groupId,
      locationId: resolved.locationId,
    },
  };
}

function inView(
  locations: DashboardLocation[],
  scope: DashboardScope,
  allowedClientIds: string[] | null
): DashboardLocation[] {
  if (scope.clientId === NIL || scope.locationId === NIL || scope.groupId === NIL) return [];
  return locations.filter((location) => {
    if (allowedClientIds && (!location.clientId || !allowedClientIds.includes(location.clientId))) return false;
    if (scope.locationId && location.id !== scope.locationId) return false;
    if (scope.groupId && location.groupId !== scope.groupId && location.parentGroupId !== scope.groupId) {
      return false;
    }
    if (scope.clientId && location.clientId !== scope.clientId) return false;
    return true;
  });
}

function resource(access: MemberAccess, location: DashboardLocation): ResourceRef {
  return {
    workspaceId: access.workspaceId,
    clientId: location.clientId,
    groupId: location.groupId,
    parentGroupId: location.parentGroupId,
    locationId: location.id,
  };
}

function allowed(
  access: MemberAccess,
  location: DashboardLocation,
  permission: ReturnType<typeof reviewPermission>
): boolean {
  return canAct({
    role: access.role,
    enabled: access.enabled,
    permission,
    scope: access.scope,
    actorWorkspaceId: access.workspaceId,
    resource: resource(access, location),
  });
}

async function sameNameCount(workspaceId: string, locationIds: string[], name: string): Promise<number> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || locationIds.length === 0) return 0;
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("grm_reviews")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("reviewer_display_name", trimmed)
    .in("location_id", locationIds);
  if (error) return 0;
  return count ?? 0;
}

async function evidenceBucket(): Promise<boolean> {
  // Evidence uploads have no native storage backend configured yet.
  return false;
}

export async function loadMobileOverview(input: {
  workspaceId: string;
  userId: string;
  clientParam: unknown;
  groupParam?: unknown;
  locationParam?: unknown;
  rangeParam: unknown;
  now?: Date;
}): Promise<MobileOverview> {
  const now = input.now ?? new Date();
  const rangeKey = mobileRangeKey(input.rangeParam);
  const view = await placed(input.workspaceId, input.userId, {
    client: input.clientParam,
    group: input.groupParam,
    location: input.locationParam,
  });
  const emptyClients: MobileClientOption[] = [];
  const base = {
    rangeKey,
    rangeLabel: rangeKey === "7d" ? "7 days" : "30 days",
    clientId: view && !view.denied ? view.scope.clientId : null,
    clients: emptyClients,
    chooseClient: false,
    unknownClient: false,
    scopeLabel: "this view",
    brief: "No reviews in this period.",
    average: "—",
    ratingDelta: null,
    replyRate: "—",
    replyDetail: "No reviews in this period.",
    newReviews: 0,
    reviewDelta: null,
    openEscalations: 0,
    overdueEscalations: 0,
    alerts: [] as MobileAlert[],
    themes: [] as MobileOverview["themes"],
    approveHref: "/m/approve",
    escalationsHref: "/m/escalations",
    sevenHref: "/m?range=7d",
    thirtyHref: "/m?range=30d",
  };
  if (!view) return base;

  const range = mobileDateRange(rangeKey, now);
  const weekRange = mobileDateRange("7d", now);
  const [context, allowedClientIds] = await Promise.all([
    getDashboardContext(input.workspaceId, range, view.scope),
    visibleClientIds(input.workspaceId, view.access.scope),
  ]);
  // The 7-day brief needs only window totals, not a second full context:
  // reuse the first context's timezone and fetch just the bundle facts.
  const week =
    rangeKey === "7d"
      ? null
      : await loadDashboardWindowFacts(input.workspaceId, view.scope, weekRange, context.timezone);
  const locations = inView(context.locations, view.scope, allowedClientIds);
  const locationIds = locations.map((location) => location.id);
  const clients = context.clients.filter((client) => !allowedClientIds || allowedClientIds.includes(client.id));
  const clientId = view.denied ? null : keptId(view.scope.clientId);
  const unknownClient = view.dropped;
  const scopeLabel = view.denied || view.dropped ? "That selection is not available" : view.title;
  const weekFacts = week?.facts ?? context.facts;
  const weekPrevious = week?.previous ?? context.previous;
  const current = reviewWindow(context.facts);
  const previousWindow = context.previous ? reviewWindow(context.previous) : null;
  const rates = replyRateLabel(context.facts);
  const admin = createAdminClient();
  const openQuery = admin
    .from("grm_escalations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .neq("status", "resolved");
  const overdueQuery = admin
    .from("grm_escalations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .neq("status", "resolved")
    .lt("due_at", now.toISOString());
  const draftQuery = admin
    .from("grm_reviews")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", input.workspaceId)
    .is("missing_on_google_at", null)
    .eq("reply_status", "draft")
    .gte("star_rating", 4);
  const [openCount, overdueCount, draftCount, connections] = await Promise.all([
    locationIds.length === 0 ? Promise.resolve({ count: 0, error: null }) : openQuery.in("location_id", locationIds),
    locationIds.length === 0
      ? Promise.resolve({ count: 0, error: null })
      : overdueQuery.in("location_id", locationIds),
    locationIds.length === 0 ? Promise.resolve({ count: 0, error: null }) : draftQuery.in("location_id", locationIds),
    admin.from("grm_google_connections").select("status, client_id").eq("workspace_id", input.workspaceId),
  ]);
  if (openCount.error || overdueCount.error || draftCount.error || connections.error) {
    throw new Error("Could not load the mobile overview.");
  }

  const query = { ...scopeQuery(view.scope), range: rangeKey };
  const approveHref = mobileHref("/m/approve", scopeQuery(view.scope));
  const escalationsHref = mobileHref("/m/escalations", scopeQuery(view.scope));
  const names = new Map(locations.map((location) => [location.id, location.name]));
  const worst = [...context.facts.locations]
    .filter((location) => location.oneToThree > 0 && names.has(location.locationId))
    .sort((a, b) => b.oneToThree - a.oneToThree)[0];
  const alerts: MobileAlert[] = [];
  if (worst) {
    alerts.push({
      id: `location-${worst.locationId}`,
      text: `${names.get(worst.locationId)} has ${worst.oneToThree} review${worst.oneToThree === 1 ? "" : "s"} of 1–3 stars in this period.`,
      href: mobileHref("/m/escalations", { client: clientId, location: worst.locationId }),
    });
  }
  const overdue = overdueCount.count ?? 0;
  if (overdue > 0) {
    alerts.push({
      id: "overdue",
      text: `${overdue} open escalation${overdue === 1 ? " is" : "s are"} past the due time.`,
      href: escalationsHref,
    });
  }
  const ready = draftCount.count ?? 0;
  if (ready > 0) {
    alerts.push({
      id: "drafts",
      text: `${ready} draft${ready === 1 ? "" : "s"} of 4–5 stars ${ready === 1 ? "is" : "are"} waiting.`,
      href: approveHref,
    });
  }
  const clientIds = new Set(locations.map((location) => location.clientId).filter((id): id is string => Boolean(id)));
  const visibleConnections = (connections.data ?? []).filter((row) => {
    if (!clientId && !view.access.scope.clientId && !view.access.scope.groupId && !view.access.scope.locationId) {
      return true;
    }
    return Boolean(row.client_id && clientIds.has(row.client_id));
  });
  const expired = visibleConnections.filter((row) => row.status === "expired").length;
  const revoked = visibleConnections.filter((row) => row.status === "revoked").length;
  if (expired > 0) {
    alerts.push({
      id: "expired",
      text: `${expired} Google connection${expired === 1 ? " has" : "s have"} expired.`,
      href: "/settings",
    });
  }
  if (revoked > 0) {
    alerts.push({
      id: "revoked",
      text: `${revoked} Google connection${revoked === 1 ? " is" : "s are"} revoked.`,
      href: "/settings",
    });
  }

  return {
    rangeKey,
    rangeLabel: range.label,
    clientId,
    clients,
    chooseClient: false,
    unknownClient,
    scopeLabel,
    brief: weekBrief({
      facts: weekFacts,
      previous: weekPrevious,
      scopeLabel,
    }),
    average: current.avgRating === null ? "—" : current.avgRating.toFixed(2),
    ratingDelta: ratingDeltaLabel(current.avgRating, previousWindow?.avgRating ?? null),
    replyRate: rates.rate,
    replyDetail: rates.detail,
    newReviews: context.facts.reviews,
    reviewDelta: countDeltaLabel(context.facts.reviews, context.previous?.reviews ?? null),
    openEscalations: openCount.count ?? 0,
    overdueEscalations: overdue,
    alerts,
    themes: themeBars(context.facts),
    approveHref,
    escalationsHref,
    sevenHref: mobileHref("/m", { ...query, range: "7d" }),
    thirtyHref: mobileHref("/m", { ...query, range: "30d" }),
  };
}

interface ReviewRow {
  id: string;
  star_rating: number;
  reviewer_display_name: string | null;
  comment: string | null;
  review_create_time: string;
  location_id: string;
  reply_status: string;
  complaint_theme: string | null;
}

interface ReplyRow {
  id: string;
  review_id: string;
  content: string;
  status: string;
  created_at: string;
}

async function queueContext(
  workspaceId: string,
  userId: string,
  params: { client?: unknown; group?: unknown; location?: unknown }
) {
  const view = await placed(workspaceId, userId, params);
  if (!view) return null;
  const allowedClientIds = await visibleClientIds(workspaceId, view.access.scope);
  const context = await getDashboardContext(workspaceId, mobileDateRange("30d"), view.scope);
  const locations = inView(context.locations, view.scope, allowedClientIds);
  const clients = context.clients.filter((client) => !allowedClientIds || allowedClientIds.includes(client.id));
  return {
    view,
    locations,
    clients,
    clientId: view.denied ? null : view.scope.clientId,
    names: new Map(locations.map((location) => [location.id, location.name])),
    byId: new Map(locations.map((location) => [location.id, location])),
  };
}

export async function loadMobileApproval(input: {
  workspaceId: string;
  userId: string;
  clientParam: unknown;
  groupParam?: unknown;
  locationParam?: unknown;
  skipParam: unknown;
  now?: Date;
}): Promise<MobileApproval> {
  const now = input.now ?? new Date();
  const skip = new Set(skippedIds(input.skipParam));
  const loaded = await queueContext(input.workspaceId, input.userId, {
    client: input.clientParam,
    group: input.groupParam,
    location: input.locationParam,
  });
  if (!loaded || loaded.locations.length === 0) {
    return {
      clientId: loaded?.clientId ?? null,
      groupId: loaded ? keptId(loaded.view.scope.groupId) : null,
      locationId: loaded ? keptId(loaded.view.scope.locationId) : null,
      clients: loaded?.clients ?? [],
      card: null,
      skippedIds: [...skip],
      clearSkipHref: "/m/approve",
      clientHrefs: [],
      resolutionPhone: null,
      resolutionEmail: null,
    };
  }
  const admin = createAdminClient();
  const locationIds = loaded.locations.map((location) => location.id);
  const { data, error } = await admin
    .from("grm_reviews")
    .select("id, star_rating, reviewer_display_name, comment, review_create_time, location_id, reply_status, complaint_theme")
    .eq("workspace_id", input.workspaceId)
    .is("missing_on_google_at", null)
    .in("location_id", locationIds)
    .in("reply_status", ["draft", "approved", "failed"])
    .order("review_create_time", { ascending: false })
    .limit(QUEUE_LIMIT);
  if (error) throw new Error("Could not load the approval queue.");
  const reviews = ((data ?? []) as ReviewRow[]).sort((a, b) => {
    const rank = (status: string) => (status === "draft" ? 0 : status === "approved" ? 1 : 2);
    return rank(a.reply_status) - rank(b.reply_status) || Date.parse(b.review_create_time) - Date.parse(a.review_create_time);
  });
  const reviewIds = reviews.map((review) => review.id);
  const [replies, escalations, contact] = await Promise.all([
    reviewIds.length
      ? admin
          .from("grm_review_replies")
          .select("id, review_id, content, status, created_at")
          .eq("workspace_id", input.workspaceId)
          .in("review_id", reviewIds)
          .in("status", ["draft", "approved", "failed"])
      : Promise.resolve({ data: [], error: null }),
    reviewIds.length
      ? admin
          .from("grm_escalations")
          .select("id, review_id")
          .eq("workspace_id", input.workspaceId)
          .in("review_id", reviewIds)
          .neq("status", "resolved")
      : Promise.resolve({ data: [], error: null }),
    EscalationContactStore.read(input.workspaceId),
  ]);
  if (replies.error || escalations.error) throw new Error("Could not load the approval queue.");
  const replyByReview = new Map<string, ReplyRow>();
  for (const reply of (replies.data ?? []) as ReplyRow[]) {
    const current = replyByReview.get(reply.review_id);
    if (!current || Date.parse(reply.created_at) > Date.parse(current.created_at)) replyByReview.set(reply.review_id, reply);
  }
  const escalationByReview = new Map((escalations.data ?? []).map((row) => [row.review_id, row.id]));
  const visible = reviews.filter((review) => !skip.has(review.id));
  const current = visible[0] ?? null;
  const publishableIds = reviews
    .filter((review) => {
      if (skip.has(review.id)) return false;
      const location = loaded.byId.get(review.location_id);
      const reply = replyByReview.get(review.id);
      if (!location || !reply || review.star_rating < 4) return false;
      if (!allowed(loaded.view.access, location, reviewPermission(review.star_rating, "publish"))) return false;
      return checkReplyGuardrails(reply.content).length === 0;
    })
    .slice(0, 50)
    .map((review) => review.id);

  let card: MobileApprovalCard | null = null;
  if (current) {
    const location = loaded.byId.get(current.location_id);
    const reply = replyByReview.get(current.id) ?? null;
    const text = current.comment ? splitGoogleTranslation(current.comment) : { original: "", translation: null };
    const name = current.reviewer_display_name?.trim() || "No name stored";
    card = {
      reviewId: current.id,
      replyId: reply?.id ?? null,
      replyStatus: reply?.status ?? null,
      content: reply?.content ?? "",
      starRating: current.star_rating,
      reviewerName: name,
      when: relativeTime(current.review_create_time, now),
      original: text.original.trim() ? text.original.trim() : null,
      translation: text.translation,
      locationName: location ? loaded.names.get(location.id) ?? "Location" : "Location",
      position: reviews.findIndex((review) => review.id === current.id) + 1,
      total: reviews.length,
      skipped: reviews.length - visible.length,
      canPublish: location
        ? allowed(loaded.view.access, location, reviewPermission(current.star_rating, "publish"))
        : false,
      canDraft: location ? allowed(loaded.view.access, location, "draft") : false,
      violations: reply ? checkReplyGuardrails(reply.content).map((item) => item.message) : [],
      sameNameCount: name === "No name stored" ? 0 : await sameNameCount(input.workspaceId, locationIds, name),
      openEscalationId: escalationByReview.get(current.id) ?? null,
      publishableIds,
    };
  }

  return {
    clientId: loaded.clientId,
    groupId: keptId(loaded.view.scope.groupId),
    locationId: keptId(loaded.view.scope.locationId),
    clients: loaded.clients,
    card,
    skippedIds: [...skip],
    clearSkipHref: mobileHref("/m/approve", scopeQuery(loaded.view.scope)),
    clientHrefs: [
      { id: "all", name: "All", href: "/m/approve" },
      ...loaded.clients.map((client) => ({
        id: client.id,
        name: client.name,
        href: mobileHref("/m/approve", { client: client.id }),
      })),
    ],
    resolutionPhone: contact.phone,
    resolutionEmail: contact.email,
  };
}

export async function loadMobileComplaint(input: {
  workspaceId: string;
  userId: string;
  clientParam: unknown;
  groupParam?: unknown;
  locationParam: unknown;
  idParam: unknown;
  now?: Date;
}): Promise<MobileComplaint> {
  const now = input.now ?? new Date();
  const loaded = await queueContext(input.workspaceId, input.userId, {
    client: input.clientParam,
    group: input.groupParam,
    location: input.locationParam,
  });
  const blank: MobileComplaint = {
    clientId: loaded?.clientId ?? null,
    groupId: loaded ? keptId(loaded.view.scope.groupId) : null,
    locationId: loaded ? keptId(loaded.view.scope.locationId) : null,
    clients: loaded?.clients ?? [],
    card: null,
    missingId: false,
    clientHrefs: [],
    resolutionPhone: null,
    resolutionEmail: null,
  };
  if (!loaded || loaded.locations.length === 0) return blank;
  const locations = loaded.locations;
  const admin = createAdminClient();
  const locationIds = locations.map((location) => location.id);
  const { data, error } = await admin
    .from("grm_escalations")
    .select("id, review_id, location_id, status, level, assignee_user_id, due_at, resolution_code, internal_note, theme")
    .eq("workspace_id", input.workspaceId)
    .in("location_id", locationIds)
    .neq("status", "resolved")
    .order("due_at", { ascending: true })
    .limit(QUEUE_LIMIT);
  if (error) throw new Error("Could not load escalations.");
  const rows = data ?? [];
  const requested = oneId(input.idParam);
  const current = (requested ? rows.find((row) => row.id === requested) : null) ?? rows[0] ?? null;
  let card: MobileComplaintCard | null = null;
  if (current) {
    const [reviewResult, notesResult, photos] = await Promise.all([
      admin
        .from("grm_reviews")
        .select("id, star_rating, reviewer_display_name, comment, review_create_time, location_id, reply_status, complaint_theme")
        .eq("id", current.review_id)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle(),
      admin
        .from("grm_review_notes")
        .select("id, body, created_at")
        .eq("workspace_id", input.workspaceId)
        .eq("review_id", current.review_id)
        .order("created_at", { ascending: false })
        .limit(8),
      evidenceBucket(),
    ]);
    if (reviewResult.error || notesResult.error || !reviewResult.data) {
      throw new Error("Could not load this escalation.");
    }
    const review = reviewResult.data as ReviewRow;
    const replyResult = await admin
      .from("grm_review_replies")
      .select("id, review_id, content, status, created_at")
      .eq("workspace_id", input.workspaceId)
      .eq("review_id", review.id)
      .in("status", ["draft", "approved", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (replyResult.error) throw new Error("Could not load this escalation.");
    const location = loaded.byId.get(current.location_id);
    const text = review.comment ? splitGoogleTranslation(review.comment) : { original: "", translation: null };
    const name = review.reviewer_display_name?.trim() || "No name stored";
    const sla = slaRemaining(current.due_at, now);
    let assigneeLabel = "No one is assigned";
    if (current.assignee_user_id === input.userId) assigneeLabel = "Assigned to you";
    else if (current.assignee_user_id) {
      const user = await getAuthUserById(current.assignee_user_id).catch(() => null);
      assigneeLabel = user?.data.user?.email
        ? `Assigned to ${user.data.user.email}`
        : "Assigned to a workspace member";
    }
    const reply = (replyResult.data as ReplyRow | null) ?? null;
    card = {
      id: current.id,
      reviewId: review.id,
      locationName: location ? loaded.names.get(location.id) ?? "Location" : "Location",
      assigneeLabel,
      levelLabel: ESCALATION_LEVELS.find((level) => level.id === current.level)?.label ?? current.level,
      level: current.level,
      slaLabel: sla.label,
      overdue: sla.overdue,
      starRating: review.star_rating,
      reviewerName: name,
      when: relativeTime(review.review_create_time, now),
      original: text.original.trim() ? text.original.trim() : null,
      translation: text.translation,
      theme: themeLabel(current.theme ?? review.complaint_theme),
      sameNameCount: name === "No name stored" ? 0 : await sameNameCount(input.workspaceId, loaded.locations.map((item) => item.id), name),
      notes: (notesResult.data ?? []).map((note) => ({
        id: note.id,
        body: note.body,
        when: relativeTime(note.created_at, now),
      })),
      escalationNote: current.internal_note,
      replyId: reply?.id ?? null,
      replyContent: reply?.content ?? "",
      resolutionCode: current.resolution_code,
      canPassRegional: location ? allowed(loaded.view.access, location, "approve_negative") : false,
      canDraft: location ? allowed(loaded.view.access, location, "draft") : false,
      photosStored: photos,
      position: rows.findIndex((row) => row.id === current.id) + 1,
      total: rows.length,
      violations: reply ? checkReplyGuardrails(reply.content).map((item) => item.message) : [],
    };
  }

  const contact = await EscalationContactStore.read(input.workspaceId);
  return {
    clientId: loaded.clientId,
    groupId: keptId(loaded.view.scope.groupId),
    locationId: keptId(loaded.view.scope.locationId),
    clients: loaded.clients,
    card,
    resolutionPhone: contact.phone,
    resolutionEmail: contact.email,
    missingId: Boolean(requested && !rows.some((row) => row.id === requested)),
    clientHrefs: [
      { id: "all", name: "All", href: "/m/escalations" },
      ...loaded.clients.map((client) => ({
        id: client.id,
        name: client.name,
        href: mobileHref("/m/escalations", { client: client.id }),
      })),
    ],
  };
}
