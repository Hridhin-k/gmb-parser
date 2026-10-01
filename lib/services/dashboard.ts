import { createAdminClient } from "@/lib/supabase/admin";
import { UNASSIGNED_CLIENT_MARKER } from "@/lib/services/unassigned-client";
import {
  LocationInsightService,
  type LocationInsight,
} from "@/lib/services/location-insights";

export interface DashboardFilters {
  filter: string;
  rating?: number;
  ratingBucket?: "negative" | "positive";
  q: string;
  clientId: string;
  locationId: string;
  period: "7d" | "30d" | "90d" | "all";
  hasComment?: boolean;
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
  location_id: string;
}

const INBOX_PAGE_SIZE = 30;
const PROFILE_PAGE_SIZE = 25;
const ATTENTION_LIMIT = 12;

function periodStart(period: DashboardFilters["period"]): string | null {
  if (period === "all") return null;
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function attentionScore(row: {
  unanswered: number;
  critical: number;
  lastReviewAt: string | null;
}): number {
  let score = row.unanswered * 10 + row.critical * 6;
  if (row.lastReviewAt) {
    const ageHours =
      (Date.now() - new Date(row.lastReviewAt).getTime()) / 3_600_000;
    if (ageHours < 48) score += 5;
    else if (ageHours < 168) score += 2;
  }
  return score;
}

export async function getDashboardData(
  workspaceId: string,
  filters: DashboardFilters
) {
  const admin = createAdminClient();

  const [
    { data: allClients },
    { data: allLocations },
    { data: connections },
    allReviewsLite,
  ] = await Promise.all([
    admin
      .from("grm_clients")
      .select("id, name, notes")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .or(`notes.is.null,notes.neq.${UNASSIGNED_CLIENT_MARKER}`)
      .order("name"),
    admin
      .from("grm_google_locations")
      .select(
        `id, location_title, client_id, last_synced_at,
         grm_clients(name, notes)`
      )
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("location_title"),
    admin
      .from("grm_google_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1),
    // Aggregate fields only — not full review bodies
    admin
      .from("grm_reviews")
      .select("location_id, star_rating, reply_status, review_create_time")
      .eq("workspace_id", workspaceId),
  ]);

  const unassignedIds = new Set(
    (
      await admin
        .from("grm_clients")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("notes", UNASSIGNED_CLIENT_MARKER)
    ).data?.map((c) => c.id) ?? []
  );

  const locations = (allLocations ?? []).filter((l) => {
    if (!l.client_id || unassignedIds.has(l.client_id)) return false;
    const client = Array.isArray(l.grm_clients) ? l.grm_clients[0] : l.grm_clients;
    return (
      (client as { notes?: string | null } | null)?.notes !==
      UNASSIGNED_CLIENT_MARKER
    );
  });

  const reviewsLite = allReviewsLite.data ?? [];

  const ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let ratingSum = 0;
  let unanswered = 0;
  let drafts = 0;
  let approved = 0;
  let failed = 0;
  let published = 0;
  const now = Date.now();
  let reviewsLast7d = 0;
  let reviewsLast30d = 0;
  let criticalReviews = 0;

  type LocAgg = {
    count: number;
    unanswered: number;
    critical: number;
    sum: number;
    lastAt: string | null;
  };
  const byLocStats = new Map<string, LocAgg>();
  for (const l of locations) {
    byLocStats.set(l.id, {
      count: 0,
      unanswered: 0,
      critical: 0,
      sum: 0,
      lastAt: null,
    });
  }

  for (const r of reviewsLite) {
    const star = r.star_rating as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) ratingDistribution[star] += 1;
    ratingSum += r.star_rating;
    if (r.star_rating <= 2) criticalReviews += 1;
    if (r.reply_status === "none") unanswered += 1;
    else if (r.reply_status === "draft") drafts += 1;
    else if (
      r.reply_status === "approved" ||
      r.reply_status === "pending_publish"
    )
      approved += 1;
    else if (r.reply_status === "failed") failed += 1;
    else if (r.reply_status === "published") published += 1;

    const t = new Date(r.review_create_time).getTime();
    if (now - t <= 7 * 86400000) reviewsLast7d += 1;
    if (now - t <= 30 * 86400000) reviewsLast30d += 1;

    const s = byLocStats.get(r.location_id);
    if (!s) continue;
    s.count += 1;
    s.sum += r.star_rating;
    if (r.reply_status === "none") s.unanswered += 1;
    if (r.star_rating <= 2) s.critical += 1;
    if (!s.lastAt || r.review_create_time > s.lastAt) {
      s.lastAt = r.review_create_time;
    }
  }

  const allProfiles: ProfileRow[] = locations.map((l) => {
    const client = Array.isArray(l.grm_clients) ? l.grm_clients[0] : l.grm_clients;
    const clientName = (client as { name?: string } | null)?.name ?? null;
    const s = byLocStats.get(l.id)!;
    const row = {
      id: l.id,
      title: l.location_title,
      clientId: l.client_id,
      clientName,
      reviewCount: s.count,
      unanswered: s.unanswered,
      critical: s.critical,
      avgRating: s.count > 0 ? s.sum / s.count : null,
      lastReviewAt: s.lastAt,
      attentionScore: 0,
    };
    row.attentionScore = attentionScore(row);
    return row;
  });

  const profilesNeedingReply = allProfiles.filter((p) => p.unanswered > 0).length;

  const kpis: DashboardKpis = {
    totalReviews: reviewsLite.length,
    unanswered,
    drafts,
    approved,
    failed,
    published,
    avgRating: reviewsLite.length > 0 ? ratingSum / reviewsLite.length : null,
    ratingDistribution,
    clientsActive: (allClients ?? []).length,
    locationsActive: locations.length,
    reviewsLast7d,
    reviewsLast30d,
    profilesNeedingReply,
    criticalReviews,
  };

  // Attention queue — top N only (not all profiles)
  const attentionQueue = [...allProfiles]
    .filter((p) => p.attentionScore > 0)
    .sort((a, b) => b.attentionScore - a.attentionScore)
    .slice(0, ATTENTION_LIMIT);

  // Profile directory — search + sort + paginate
  const pq = filters.profileQ.trim().toLowerCase();
  let directory = allProfiles.filter((p) => {
    if (filters.clientId && p.clientId !== filters.clientId) return false;
    if (!pq) return true;
    return (
      p.title.toLowerCase().includes(pq) ||
      (p.clientName?.toLowerCase().includes(pq) ?? false)
    );
  });

  switch (filters.profileSort) {
    case "name":
      directory.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "rating":
      directory.sort(
        (a, b) => (a.avgRating ?? 99) - (b.avgRating ?? 99)
      );
      break;
    case "reviews":
      directory.sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    case "unanswered":
      directory.sort((a, b) => b.unanswered - a.unanswered);
      break;
    case "attention":
    default:
      directory.sort((a, b) => {
        if (b.attentionScore !== a.attentionScore)
          return b.attentionScore - a.attentionScore;
        return a.title.localeCompare(b.title);
      });
      break;
  }

  const profileTotal = directory.length;
  const profilePageSize = PROFILE_PAGE_SIZE;
  const profilePage = Math.max(1, filters.profilePage);
  const profileFrom = (profilePage - 1) * profilePageSize;
  const profileDirectory = directory.slice(
    profileFrom,
    profileFrom + profilePageSize
  );

  // AI insight ONLY for the selected location — never for all profiles
  let selectedInsight: LocationInsight | null = null;
  let selectedHeuristic: string | null = null;
  let selectedProfile: ProfileRow | null = null;

  if (filters.locationId && /^[0-9a-f-]{36}$/i.test(filters.locationId)) {
    selectedProfile = allProfiles.find((p) => p.id === filters.locationId) ?? null;
    if (selectedProfile) {
      const statsMap = await LocationInsightService.buildLocationReviewStats(
        workspaceId,
        [filters.locationId]
      );
      const stats = statsMap.get(filters.locationId);
      selectedHeuristic = stats?.heuristic.summary ?? null;
      if (stats) {
        const cached = await LocationInsightService.getCachedInsights(
          workspaceId,
          [filters.locationId],
          new Map([[filters.locationId, stats.fingerprint]])
        );
        selectedInsight = cached.get(filters.locationId) ?? null;
      }
    }
  }

  // Filter dropdown options: for scale, pass clients always; locations only
  // for the selected client (or empty → directory handles discovery)
  const clients = (allClients ?? []).map((c) => ({ id: c.id, name: c.name }));
  const locationsForFilters = filters.clientId
    ? locations
        .filter((l) => l.client_id === filters.clientId)
        .map((l) => ({
          id: l.id,
          location_title: l.location_title,
          clientId: l.client_id,
        }))
    : selectedProfile
      ? [
          {
            id: selectedProfile.id,
            location_title: selectedProfile.title,
            clientId: selectedProfile.clientId,
          },
        ]
      : [];

  // Inbox
  const rangeFrom = (filters.page - 1) * INBOX_PAGE_SIZE;
  const rangeTo = rangeFrom + INBOX_PAGE_SIZE - 1;
  const since = periodStart(filters.period);

  let locationFilterIds: string[] | null = null;
  if (filters.locationId && /^[0-9a-f-]{36}$/i.test(filters.locationId)) {
    locationFilterIds = [filters.locationId];
  } else if (filters.clientId && /^[0-9a-f-]{36}$/i.test(filters.clientId)) {
    locationFilterIds = locations
      .filter((l) => l.client_id === filters.clientId)
      .map((l) => l.id);
  }

  const emptyInbox = {
    kpis,
    attentionQueue,
    profileDirectory,
    profileTotal,
    profilePageSize,
    selectedProfile,
    selectedInsight,
    selectedHeuristic,
    reviews: [] as DashboardReviewRow[],
    replies: {} as Record<string, never>,
    totalReviewCount: 0,
    pageSize: INBOX_PAGE_SIZE,
    clients,
    locations: locationsForFilters,
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
       location_id,
       grm_google_locations!inner(
         id, location_title, client_id,
         grm_clients(name)
       )`,
      { count: "exact" }
    )
    .eq("workspace_id", workspaceId)
    .order("review_create_time", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (locationFilterIds) {
    reviewQuery = reviewQuery.in("location_id", locationFilterIds);
  }
  if (since) reviewQuery = reviewQuery.gte("review_create_time", since);

  switch (filters.filter) {
    case "unanswered":
      reviewQuery = reviewQuery.eq("reply_status", "none");
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
    default:
      break;
  }

  if (filters.rating !== undefined) {
    reviewQuery = reviewQuery.eq("star_rating", filters.rating);
  } else if (filters.ratingBucket === "negative") {
    reviewQuery = reviewQuery.lte("star_rating", 2);
  } else if (filters.ratingBucket === "positive") {
    reviewQuery = reviewQuery.gte("star_rating", 4);
  }

  if (filters.hasComment === true) {
    reviewQuery = reviewQuery.not("comment", "is", null).neq("comment", "");
  }

  if (filters.q) {
    const escaped = filters.q.replace(/[%_\\]/g, (c) => `\\${c}`);
    reviewQuery = reviewQuery.or(
      `comment.ilike.%${escaped}%,reviewer_display_name.ilike.%${escaped}%`
    );
  }

  const { data: rawReviews, count: totalReviewCount } = await reviewQuery;

  const reviews: DashboardReviewRow[] = (rawReviews ?? []).map((r) => {
    const loc = Array.isArray(r.grm_google_locations)
      ? r.grm_google_locations[0]
      : r.grm_google_locations;
    const locTyped = loc as {
      location_title?: string;
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
      location_title: locTyped?.location_title ?? "Unknown",
      client_name: clientName,
      location_id: r.location_id,
    };
  });

  const repliesMap: Record<
    string,
    {
      id: string;
      content: string;
      source: string;
      status: string;
      created_at: string;
      approved_at: string | null;
      published_at: string | null;
      last_error: string | null;
      failure_count: number;
    }
  > = {};

  const reviewIds = reviews.map((r) => r.id);
  if (reviewIds.length > 0) {
    const { data: repliesData } = await admin
      .from("grm_review_replies")
      .select(
        "id, review_id, content, source, status, created_at, approved_at, published_at, last_error, failure_count"
      )
      .eq("workspace_id", workspaceId)
      .in("review_id", reviewIds)
      .in("status", [
        "draft",
        "approved",
        "pending_publish",
        "published",
        "failed",
      ]);

    for (const row of repliesData ?? []) {
      repliesMap[row.review_id] = {
        id: row.id,
        content: row.content,
        source: row.source as string,
        status: row.status as string,
        created_at: row.created_at,
        approved_at: row.approved_at,
        published_at: row.published_at,
        last_error: row.last_error,
        failure_count: row.failure_count,
      };
    }
  }

  return {
    kpis,
    attentionQueue,
    profileDirectory,
    profileTotal,
    profilePageSize,
    selectedProfile,
    selectedInsight,
    selectedHeuristic,
    reviews,
    replies: repliesMap,
    totalReviewCount: totalReviewCount ?? 0,
    pageSize: INBOX_PAGE_SIZE,
    clients,
    locations: locationsForFilters,
    hasConnections: (connections?.length ?? 0) > 0,
  };
}
