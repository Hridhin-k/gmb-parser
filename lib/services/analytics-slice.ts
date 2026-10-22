import { createAdminClient } from "@/lib/supabase/admin";
import {
  inReviewWindow,
  splitOnboarding,
  summarizeSamples,
  type OnboardingComparison,
  type ReviewSample,
  type SampleSummary,
} from "@/lib/analytics-metrics";

const PAGE = 1000;
const WINDOW_CAP = 8000;
/** Onboarding before/after does not need the full history — keep it bounded. */
const ONBOARDING_CAP = 3000;
const LOCATION_CHUNK = 80;
const CONCURRENCY = 3;

export interface AnalyticsSlice {
  window: SampleSummary;
  onboarding: OnboardingComparison;
  truncated: boolean;
}

interface ReviewRow {
  id: string;
  star_rating: number;
  review_create_time: string;
  google_reply_update_time: string | null;
  google_reply_comment: string | null;
  reply_status: string;
  review_language: string | null;
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function readLocationChunk(
  workspaceId: string,
  locationIds: string[],
  start: string | null,
  end: string | null,
  cap: number
): Promise<{ rows: ReviewRow[]; truncated: boolean }> {
  const admin = createAdminClient();
  const rows: ReviewRow[] = [];
  let from = 0;
  while (rows.length < cap) {
    let query = admin
      .from("grm_reviews")
      .select(
        "id, star_rating, review_create_time, google_reply_update_time, google_reply_comment, reply_status, review_language"
      )
      .eq("workspace_id", workspaceId)
      .is("missing_on_google_at", null)
      .in("location_id", locationIds)
      .order("review_create_time", { ascending: true })
      .range(from, from + PAGE - 1);
    if (start) query = query.gte("review_create_time", start);
    if (end) query = query.lt("review_create_time", end);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load analytics reviews: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (rows.length >= cap) return { rows: rows.slice(0, cap), truncated: true };
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return { rows, truncated: false };
}

async function readReviews(
  workspaceId: string,
  locationIds: string[],
  start: string | null,
  end: string | null,
  cap = WINDOW_CAP
): Promise<{ rows: ReviewRow[]; truncated: boolean }> {
  if (locationIds.length === 0) return { rows: [], truncated: false };
  const chunks: string[][] = [];
  for (let offset = 0; offset < locationIds.length; offset += LOCATION_CHUNK) {
    chunks.push(locationIds.slice(offset, offset + LOCATION_CHUNK));
  }
  const rows: ReviewRow[] = [];
  let truncated = false;
  // Process location chunks in small parallel batches, stopping once the shared cap is filled.
  for (let offset = 0; offset < chunks.length; offset += CONCURRENCY) {
    const remaining = cap - rows.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const batch = chunks.slice(offset, offset + CONCURRENCY);
    const parts = await Promise.all(
      batch.map((ids) => readLocationChunk(workspaceId, ids, start, end, remaining))
    );
    for (const part of parts) {
      for (const row of part.rows) {
        if (rows.length >= cap) {
          truncated = true;
          break;
        }
        rows.push(row);
      }
      if (part.truncated) truncated = true;
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  return { rows: rows.slice(0, cap), truncated };
}

async function autoReplyIds(reviewIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (reviewIds.length === 0) return result;
  const admin = createAdminClient();
  const chunks: string[][] = [];
  for (let offset = 0; offset < reviewIds.length; offset += LOCATION_CHUNK) {
    chunks.push(reviewIds.slice(offset, offset + LOCATION_CHUNK));
  }
  const pages = await mapPool(chunks, CONCURRENCY, async (ids) => {
    const { data, error } = await admin
      .from("grm_review_replies")
      .select("review_id, source")
      .in("review_id", ids)
      .eq("status", "published");
    if (error) throw new Error(`Failed to load published replies: ${error.message}`);
    return data ?? [];
  });
  for (const page of pages) {
    for (const row of page) {
      const current = result.get(row.review_id) ?? false;
      result.set(row.review_id, current || row.source === "ai");
    }
  }
  return result;
}

function toSamples(rows: ReviewRow[], auto: Map<string, boolean>): ReviewSample[] {
  return rows.map((row) => ({
    createdAt: row.review_create_time,
    stars: row.star_rating,
    hasReply: Boolean(row.google_reply_comment) || row.reply_status === "published",
    replyAt: row.google_reply_update_time,
    language: row.review_language,
    autoReply: auto.has(row.id) ? auto.get(row.id)! : null,
  }));
}

export async function loadAnalyticsSlice(input: {
  workspaceId: string;
  locationIds: string[];
  start: string | null;
  end: string | null;
}): Promise<AnalyticsSlice> {
  const admin = createAdminClient();
  const { data: onboardingRow, error: onboardingError } = await admin
    .from("grm_onboarding")
    .select("completed_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (onboardingError) throw new Error(`Failed to load onboarding: ${onboardingError.message}`);
  const completedAt = onboardingRow?.completed_at ?? null;
  const empty = { rows: [] as ReviewRow[], truncated: false };

  // Window + bounded history for the onboarding card — in parallel, not back-to-back.
  const [windowRows, historyRows] = await Promise.all([
    readReviews(input.workspaceId, input.locationIds, input.start, input.end, WINDOW_CAP),
    completedAt
      ? readReviews(input.workspaceId, input.locationIds, null, null, ONBOARDING_CAP)
      : Promise.resolve(empty),
  ]);

  // Autoreply only for the visible window — never for full history.
  const auto = await autoReplyIds(windowRows.rows.map((row) => row.id));
  const windowSamples = toSamples(windowRows.rows, auto).filter((row) =>
    inReviewWindow(row.createdAt, input.start, input.end)
  );

  const emptyAuto = new Map<string, boolean>();
  const onboarding: OnboardingComparison = splitOnboarding(
    toSamples(historyRows.rows, emptyAuto),
    completedAt
  );

  return {
    window: summarizeSamples(windowSamples),
    onboarding,
    truncated: windowRows.truncated || historyRows.truncated,
  };
}
