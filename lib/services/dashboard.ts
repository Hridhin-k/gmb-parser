import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpcLocationReviewStats } from "@/lib/supabase/rpc";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import { formatLocationOption, locationDisplayName } from "@/lib/ui/location-place";
import {
  detectComplaintTheme,
  detectReviewLanguage,
  type InboxSort,
} from "@/lib/review-inbox";
import { replyActivityLabel } from "@/lib/reply-activity";
import { orIlikeAny } from "@/lib/postgrest-search";
import { statusOrFilter } from "@/lib/review-filter-params";
import { groupIdsInScope } from "@/lib/hierarchy";
import { loadCatalogTables } from "@/lib/services/catalog-tables";
import { forgetPrefix, remember } from "@/lib/ttl-cache";

export interface DashboardFilters {
  /** Selected status keys; empty = all statuses. */
  filters: string[];
  /** Selected star ratings; empty = any (unless ratingBucket is set). */
  ratings?: number[];
  ratingBucket?: "negative" | "positive" | "escalation";
  q: string;
  clientId: string;
  locationId: string;
  /** Review date window [since, until); null bounds are open. */
  since: string | null;
  until: string | null;
  hasComment?: boolean;
  /** has = written text, none = rating only. */
  text?: "has" | "none";
  languages?: string[];
  themes?: string[];
  /** Member ids and/or "unassigned". */
  assignees?: string[];
  groupId?: string;
  sort?: InboxSort;
  page: number;
  /** Profile directory search (name) */
  profileQ: string;
  /** attention | unanswered | rating | name | reviews */
  profileSort: "attention" | "unanswered" | "rating" | "name" | "reviews";
  profilePage: number;
}

export interface DashboardKpis {
  totalReviews: number;
  unanswered: number;
  drafts: number;
  approved: number;
  failed: number;
  published: number;
  avgRating: number | null;
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
  clientsActive: number;
  locationsActive: number;
  reviewsLast7d: number;
  reviewsLast30d: number;
  profilesNeedingReply: number;
  criticalReviews: number;
}

/** Lightweight row — safe to list hundreds of these. No AI payload. */
export interface ProfileRow {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  storeCode: string | null;
  address: string | null;
  reviewCount: number;
  unanswered: number;
  critical: number;
  avgRating: number | null;
  lastReviewAt: string | null;
  attentionScore: number;
}

export interface DashboardReviewRow {
  id: string;
  reviewer_display_name: string;
  reviewer_is_anonymous: boolean;
  star_rating: number;
  comment: string | null;
  review_create_time: string;
  review_update_time: string | null;
  google_reply_comment: string | null;
  google_reply_update_time: string | null;
  reply_status: string;
  location_title: string;
  client_name: string | null;
  group_name: string | null;
  location_id: string;
  review_language: string | null;
  complaint_theme: string | null;
  assigned_to: string | null;
  reopened_at: string | null;
  notes: Array<{ id: string; body: string; createdAt: string; authorId: string }>;
  activity: Array<{ at: string; label: string }>;
}

const INBOX_PAGE_SIZE = 30;
const PROFILE_PAGE_SIZE = 25;

const EMPTY_KPIS: DashboardKpis = {
  totalReviews: 0,
  unanswered: 0,
  drafts: 0,
  approved: 0,
  failed: 0,
  published: 0,
  avgRating: null,
  ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  clientsActive: 0,
  locationsActive: 0,
  reviewsLast7d: 0,
  reviewsLast30d: 0,
  profilesNeedingReply: 0,
  criticalReviews: 0,
};

export function forgetReviewList(workspaceId: string): void {
  forgetPrefix(`inbox:${workspaceId}:`);
}

export async function getDashboardData(
  workspaceId: string,
  filters: DashboardFilters
) {
  return remember(`inbox:${workspaceId}:${JSON.stringify(filters)}`, 20_000, () =>
    loadDashboardData(workspaceId, filters)
  );
}

async function loadDashboardData(
  workspaceId: string,
  filters: DashboardFilters
) {
  const admin = createAdminClient();
  // One small batch, and never two at once. A wide update loop starves the
  // next page (reports, clients) until the browser times out.
  scheduleReviewBackfill(admin, workspaceId);

  const [tables, connectionsResult] = await Promise.all([
    loadCatalogTables(workspaceId),
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1),
  ]);
  const connections = connectionsResult.data;
  const clientById = new Map(tables.clients.map((client) => [client.id, client]));
  const unassignedIds = new Set(
    tables.clients.filter((client) => client.notes === UNASSIGNED_CLIENT_MARKER).map((client) => client.id)
  );
  const allClients = tables.clients.filter((client) => client.notes !== UNASSIGNED_CLIENT_MARKER);
  const allLocations = tables.locations
    .filter((location) => location.is_active)
    .map((location) => ({
      ...location,
      grm_clients: location.client_id ? (clientById.get(location.client_id) ?? null) : null,
    }));
  const locationGroups = tables.groups;

  const locations = (allLocations ?? []).filter((l) => {
    if (!l.client_id || unassignedIds.has(l.client_id)) return false;
    const client = Array.isArray(l.grm_clients) ? l.grm_clients[0] : l.grm_clients;
    return (
      (client as { notes?: string | null } | null)?.notes !==
      UNASSIGNED_CLIENT_MARKER
    );
  });

  // The inbox only needs locations, filters, and the current page of reviews.
  // Org-wide stats are loaded by the pages that render them.
  const kpis: DashboardKpis = {
    ...EMPTY_KPIS,
    clientsActive: (allClients ?? []).length,
    locationsActive: locations.length,
  };
  const attentionQueue: ProfileRow[] = [];
  const profileDirectory: ProfileRow[] = [];
  const profileTotal = 0;
  const profilePageSize = PROFILE_PAGE_SIZE;
  const selectedHeuristic: string | null = null;
  const selectedProfile: ProfileRow | null = null;

  const clients = (allClients ?? []).map((c) => ({ id: c.id, name: c.name }));
  const filterSource = filters.clientId
    ? locations.filter((l) => l.client_id === filters.clientId)
    : filters.locationId
      ? locations.filter((l) => l.id === filters.locationId)
      : [];
  const locationsForFilters = filterSource.map((l) => {
    const client = Array.isArray(l.grm_clients) ? l.grm_clients[0] : l.grm_clients;
    const brand = (client as { name?: string } | null)?.name ?? null;
    return {
      id: l.id,
      location_title: formatLocationOption({
        brand,
        title: l.location_title,
        storeCode: l.store_code,
        address: l.address_formatted,
      }),
      clientId: l.client_id,
    };
  });

  // Inbox
  const rangeFrom = (filters.page - 1) * INBOX_PAGE_SIZE;
  const rangeTo = rangeFrom + INBOX_PAGE_SIZE - 1;
  const { since, until } = filters;

  let locationFilterIds: string[] | null = null;
  if (filters.locationId && /^[0-9a-f-]{36}$/i.test(filters.locationId)) {
    locationFilterIds = [filters.locationId];
  } else if (filters.clientId && /^[0-9a-f-]{36}$/i.test(filters.clientId)) {
    locationFilterIds = locations
      .filter((l) => l.client_id === filters.clientId)
      .map((l) => l.id);
  }
  if (filters.groupId && /^[0-9a-f-]{36}$/i.test(filters.groupId)) {
    const scope = new Set(
      groupIdsInScope(
        filters.groupId,
        (locationGroups ?? []).map((group) => ({ id: group.id, parentId: group.parent_id }))
      )
    );
    const inGroup = locations
      .filter((location) => location.group_id && scope.has(location.group_id))
      .map((location) => location.id);
    locationFilterIds = locationFilterIds
      ? locationFilterIds.filter((id) => inGroup.includes(id))
      : inGroup;
  }

  const emptyInbox = {
    kpis,
    attentionQueue,
    profileDirectory,
    profileTotal,
    profilePageSize,
    selectedProfile,
    selectedHeuristic,
    reviews: [] as DashboardReviewRow[],
    replies: {} as Record<string, never>,
    totalReviewCount: 0,
    pageSize: INBOX_PAGE_SIZE,
    clients,
    locations: locationsForFilters,
    groups: (locationGroups ?? []).map((group) => ({ id: group.id, name: group.name })),
    hasConnections: (connections?.length ?? 0) > 0,
  };

  if (locationFilterIds && locationFilterIds.length === 0) {
    return emptyInbox;
  }

  let reviewQuery = admin
    .from("grm_reviews")
    .select(
      `id, google_review_id, star_rating, comment, reviewer_display_name,
       reviewer_is_anonymous, review_create_time, review_update_time,
       google_reply_comment, google_reply_update_time, reply_status, last_synced_at,
       review_language, complaint_theme, assigned_to, reopened_at,
       location_id,
       grm_google_locations!inner(
         id, location_title, store_code, address_formatted, client_id, group_id,
         grm_clients(name)
       )`,
      { count: "exact" }
    )
    .eq("workspace_id", workspaceId)
    .is("missing_on_google_at", null);

  if (locationFilterIds) {
    reviewQuery = reviewQuery.in("location_id", locationFilterIds);
  }
  if (since) reviewQuery = reviewQuery.gte("review_create_time", since);
  if (until) reviewQuery = reviewQuery.lt("review_create_time", until);

  const statusList = filters.filters ?? [];
  const multiStatusOr = statusList.length > 1 ? statusOrFilter(statusList) : null;
  if (multiStatusOr) {
    reviewQuery = reviewQuery.or(multiStatusOr);
  } else {
    switch (statusList[0]) {
    case "unanswered":
      reviewQuery = reviewQuery.eq("reply_status", "none");
      break;
    case "attention":
      reviewQuery = reviewQuery.in("reply_status", ["none", "draft", "failed"]);
      break;
    case "answered":
      reviewQuery = reviewQuery.neq("reply_status", "none");
      break;
    case "draft":
      reviewQuery = reviewQuery.eq("reply_status", "draft");
      break;
    case "approved":
      reviewQuery = reviewQuery.in("reply_status", [
        "approved",
        "pending_publish",
      ]);
      break;
    case "failed":
      reviewQuery = reviewQuery.eq("reply_status", "failed");
      break;
    case "published":
      reviewQuery = reviewQuery.eq("reply_status", "published");
      break;
    case "reopened":
      reviewQuery = reviewQuery.not("reopened_at", "is", null);
      break;
    case "escalated":
      reviewQuery = reviewQuery
        .lte("star_rating", 3)
        .in("reply_status", ["none", "draft", "failed"]);
      break;
    default:
      break;
    }
  }

  if (filters.languages?.length) {
    reviewQuery = reviewQuery.in("review_language", filters.languages);
  }
  if (filters.themes?.length) {
    reviewQuery = reviewQuery.in("complaint_theme", filters.themes);
  }
  const assigneeIds = (filters.assignees ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const wantUnassigned = (filters.assignees ?? []).includes("unassigned");
  if (assigneeIds.length > 0 && wantUnassigned) {
    reviewQuery = reviewQuery.or(
      `assigned_to.in.(${assigneeIds.join(",")}),assigned_to.is.null`
    );
  } else if (assigneeIds.length > 0) {
    reviewQuery = reviewQuery.in("assigned_to", assigneeIds);
  } else if (wantUnassigned) {
    reviewQuery = reviewQuery.is("assigned_to", null);
  }

  if (filters.ratings?.length) {
    reviewQuery = reviewQuery.in("star_rating", filters.ratings);
  } else if (filters.ratingBucket === "negative") {
    reviewQuery = reviewQuery.lte("star_rating", 2);
  } else if (filters.ratingBucket === "escalation") {
    reviewQuery = reviewQuery.lte("star_rating", 3);
  } else if (filters.ratingBucket === "positive") {
    reviewQuery = reviewQuery.gte("star_rating", 4);
  }

  if (filters.text === "none") {
    reviewQuery = reviewQuery.or("comment.is.null,comment.eq.");
  } else if (filters.text === "has" || filters.hasComment === true) {
    reviewQuery = reviewQuery.not("comment", "is", null).neq("comment", "");
  }

  if (filters.q) {
    // Quoted operands: search text may contain commas or parentheses
    // (e.g. an excerpt pasted from a review), which are structural in
    // PostgREST logic trees and must not be interpolated raw.
    reviewQuery = reviewQuery.or(orIlikeAny(["comment", "reviewer_display_name"], filters.q));
  }

  if (filters.sort === "oldest") {
    reviewQuery = reviewQuery.order("review_create_time", { ascending: true });
  } else if (filters.sort === "highest") {
    reviewQuery = reviewQuery
      .order("star_rating", { ascending: false })
      .order("review_create_time", { ascending: false });
  } else if (filters.sort === "lowest") {
    reviewQuery = reviewQuery
      .order("star_rating", { ascending: true })
      .order("review_create_time", { ascending: false });
  } else {
    reviewQuery = reviewQuery.order("review_create_time", { ascending: false });
  }
  reviewQuery = reviewQuery.range(rangeFrom, rangeTo);

  const { data: rawReviews, count: totalReviewCount, error: reviewError } = await reviewQuery;
  if (reviewError) {
    throw new Error(`Failed to load reviews: ${reviewError.message}`);
  }

  const reviews: DashboardReviewRow[] = (rawReviews ?? []).map((r) => {
    const loc = Array.isArray(r.grm_google_locations)
      ? r.grm_google_locations[0]
      : r.grm_google_locations;
    const locTyped = loc as {
      location_title?: string;
      store_code?: string | null;
      address_formatted?: string | null;
      group_id?: string | null;
      grm_clients?: { name: string } | Array<{ name: string }> | null;
    } | null;
    const clientData = locTyped?.grm_clients;
    const clientName = Array.isArray(clientData)
      ? (clientData[0]?.name ?? null)
      : (clientData?.name ?? null);

    return {
      id: r.id,
      reviewer_display_name: r.reviewer_display_name,
      reviewer_is_anonymous: r.reviewer_is_anonymous,
      star_rating: r.star_rating,
      comment: r.comment,
      review_create_time: r.review_create_time,
      review_update_time: r.review_update_time,
      google_reply_comment: r.google_reply_comment,
      google_reply_update_time: r.google_reply_update_time,
      reply_status: r.reply_status as string,
      location_title: locTyped?.location_title
        ? locationDisplayName({
            title: locTyped.location_title,
            brand: clientName,
            storeCode: locTyped.store_code,
            address: locTyped.address_formatted,
          })
        : "Unknown",
      client_name: clientName,
      group_name: null,
      location_id: r.location_id,
      review_language: r.review_language,
      complaint_theme: r.complaint_theme,
      assigned_to: r.assigned_to,
      reopened_at: r.reopened_at,
      notes: [],
      activity: [],
    };
  });

  const reviewIdsForMeta = reviews.map((review) => review.id);
  const groupIds = [
    ...new Set(
      (rawReviews ?? [])
        .map((review) => {
          const loc = Array.isArray(review.grm_google_locations)
            ? review.grm_google_locations[0]
            : review.grm_google_locations;
          return (loc as { group_id?: string | null } | null)?.group_id ?? null;
        })
        .filter((id): id is string => Boolean(id))
    ),
  ];
  // Groups, notes and replies all depend only on the review page just loaded,
  // so they run together — previously replies waited for notes to finish.
  const [groupResult, noteResult, repliesResult] = await Promise.all([
    groupIds.length
      ? admin.from("grm_groups").select("id, name").in("id", groupIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    reviewIdsForMeta.length
      ? admin
          .from("grm_review_notes")
          .select("id, review_id, author_id, body, created_at")
          .eq("workspace_id", workspaceId)
          .in("review_id", reviewIdsForMeta)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<{ id: string; review_id: string; author_id: string; body: string; created_at: string }> }),
    reviewIdsForMeta.length
      ? admin
          .from("grm_review_replies")
          .select(
            "id, review_id, content, source, status, created_at, approved_at, approved_by, published_at, last_error, failure_count"
          )
          .eq("workspace_id", workspaceId)
          .in("review_id", reviewIdsForMeta)
          .in("status", [
            "draft",
            "approved",
            "pending_publish",
            "published",
            "failed",
          ])
      : Promise.resolve({ data: [] as Array<{ id: string; review_id: string; content: string; source: string; status: string; created_at: string; approved_at: string | null; approved_by: string | null; published_at: string | null; last_error: string | null; failure_count: number }> }),
  ]);
  const groupNames = new Map((groupResult.data ?? []).map((group) => [group.id, group.name]));
  const notesByReview = new Map<string, DashboardReviewRow["notes"]>();
  for (const note of noteResult.data ?? []) {
    const list = notesByReview.get(note.review_id) ?? [];
    list.push({
      id: note.id,
      body: note.body,
      createdAt: note.created_at,
      authorId: note.author_id,
    });
    notesByReview.set(note.review_id, list);
  }
  for (const review of reviews) {
    const raw = (rawReviews ?? []).find((row) => row.id === review.id);
    const loc = raw
      ? Array.isArray(raw.grm_google_locations)
        ? raw.grm_google_locations[0]
        : raw.grm_google_locations
      : null;
    const groupId = (loc as { group_id?: string | null } | null)?.group_id;
    review.group_name = groupId ? groupNames.get(groupId) ?? null : null;
    review.notes = notesByReview.get(review.id) ?? [];
  }

  const repliesMap: Record<
    string,
    {
      id: string;
      content: string;
      source: string;
      status: string;
      created_at: string;
      approved_at: string | null;
      approved_by: string | null;
      published_at: string | null;
      last_error: string | null;
      failure_count: number;
    }
  > = {};

  const reviewIds = reviews.map((r) => r.id);
  if (reviewIds.length > 0) {
    for (const row of repliesResult.data ?? []) {
      repliesMap[row.review_id] = {
        id: row.id,
        content: row.content,
        source: row.source as string,
        status: row.status as string,
        created_at: row.created_at,
        approved_at: row.approved_at,
        approved_by: row.approved_by,
        published_at: row.published_at,
        last_error: row.last_error,
        failure_count: row.failure_count,
      };
    }
  }

  const activityIds = [...reviewIds, ...Object.values(repliesMap).map((reply) => reply.id)];
  if (activityIds.length) {
    const { data: activityRows } = await admin
      .from("grm_audit_logs")
      .select("action, created_at, entity_id, metadata")
      .eq("workspace_id", workspaceId)
      .in("entity_id", activityIds)
      .order("created_at", { ascending: false })
      .limit(300);
    const replyToReview = new Map(Object.entries(repliesMap).map(([reviewId, reply]) => [reply.id, reviewId]));
    for (const row of activityRows ?? []) {
      const label = replyActivityLabel(row.action);
      if (!label || !row.entity_id) continue;
      const reviewId = replyToReview.get(row.entity_id) ?? row.entity_id;
      const review = reviews.find((item) => item.id === reviewId);
      if (!review) continue;
      review.activity.push({ at: row.created_at, label });
    }
  }

  return {
    kpis,
    attentionQueue,
    profileDirectory,
    profileTotal,
    profilePageSize,
    selectedProfile,
    selectedHeuristic,
    reviews,
    replies: repliesMap,
    totalReviewCount: totalReviewCount ?? 0,
    pageSize: INBOX_PAGE_SIZE,
    clients,
    locations: locationsForFilters,
    groups: (locationGroups ?? []).map((group) => ({ id: group.id, name: group.name })),
    hasConnections: (connections?.length ?? 0) > 0,
  };
}

let reviewBackfillRunning = false;

function scheduleReviewBackfill(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  if (reviewBackfillRunning) return;
  reviewBackfillRunning = true;
  after(async () => {
    try {
      await backfillReviewSignals(admin, workspaceId);
    } finally {
      reviewBackfillRunning = false;
    }
  });
}

async function backfillReviewSignals(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  const { data, error } = await admin
    .from("grm_reviews")
    .select("id, comment, star_rating")
    .eq("workspace_id", workspaceId)
    .is("review_language", null)
    .is("missing_on_google_at", null)
    .limit(8);
  if (error || !data?.length) return;

  // Small batches only. A wide Promise.all of updates can starve the inbox
  // queries that follow and surface as "TypeError: fetch failed".
  const batchSize = 8;
  for (let i = 0; i < data.length; i += batchSize) {
    const slice = data.slice(i, i + batchSize);
    await Promise.all(
      slice.map((row) =>
        admin
          .from("grm_reviews")
          .update({
            review_language: detectReviewLanguage(row.comment),
            complaint_theme: detectComplaintTheme(row.comment, row.star_rating),
          })
          .eq("id", row.id)
          .eq("workspace_id", workspaceId)
      )
    );
  }
}