import { getDashboardData } from "@/lib/services/dashboard";
import { canApproveReplies, canSyncWorkspace } from "@/lib/services/workspace";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters } from "@/components/review-filters";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { ReviewList } from "@/components/review-list";
import { PaginationBar } from "@/components/pagination-bar";
import { Download, MessageSquareText } from "lucide-react";
import {
  validatePage,
  validateRatingFilter,
  validateFilterString,
} from "@/lib/validation";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const [params, { workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const filterParam = [
    "all",
    "unanswered",
    "answered",
    "draft",
    "approved",
    "failed",
    "published",
  ].includes(typeof params.filter === "string" ? params.filter : "")
    ? (params.filter as string)
    : "all";

  const ratingParam = validateRatingFilter(params.rating);
  const starsParam =
    params.stars === "negative" || params.stars === "positive"
      ? params.stars
      : "";
  const searchParam = validateFilterString(params.q);
  const clientParam = validateFilterString(params.client);
  const locationParam = validateFilterString(params.location);
  const range = parseDateRange(params, "all");
  const hasRange = range.key !== "all";
  const hasComment = params.comment === "1" || params.comment === "true";
  const currentPage = validatePage(params.page);

  const [role, data] = await Promise.all([
    getActiveRole(),
    getDashboardData(workspaceId, {
      filter: filterParam,
      rating: ratingParam,
      ratingBucket: starsParam || undefined,
      q: searchParam,
      clientId: clientParam,
      locationId: locationParam,
      since: range.start?.toISOString() ?? null,
      until: range.end?.toISOString() ?? null,
      hasComment: hasComment || undefined,
      page: currentPage,
      profileQ: "",
      profileSort: "attention",
      profilePage: 1,
    }),
  ]);
  const canApprove = canApproveReplies(role);

  const totalPages = Math.max(
    1,
    Math.ceil(data.totalReviewCount / data.pageSize),
  );

  const queryForPagination = new URLSearchParams();
  for (const [k, v] of Object.entries({
    filter: filterParam !== "all" ? filterParam : "",
    rating: ratingParam != null ? String(ratingParam) : "",
    stars: starsParam,
    q: searchParam,
    client: clientParam,
    location: locationParam,
    comment: hasComment ? "1" : "",
    ...dateRangeParams(range, "all"),
  })) {
    if (v) queryForPagination.set(k, v);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        description="Every review across your locations. Filter, draft, approve, and publish."
      >
        <div className="flex flex-wrap gap-2">
          {data.totalReviewCount > 0 && (
            <a
              href={`/api/reviews/export?${queryForPagination.toString()}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-silver bg-white px-4 text-sm font-medium text-graphite hover:border-ink"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </a>
          )}
          {data.hasConnections && canSyncWorkspace(role) ? (
            <SyncButton syncAll label="Sync all" size="sm" />
          ) : null}
        </div>
      </PageHeader>

      <TransitionScope>
        <ReviewFilters
          currentFilter={filterParam}
          currentRating={ratingParam !== undefined ? String(ratingParam) : ""}
          currentRatingBucket={starsParam}
          currentSearch={searchParam}
          currentRange={{ key: range.key, from: range.from, to: range.to }}
          currentHasComment={hasComment}
          clients={data.clients}
          locations={data.locations}
          currentClientId={clientParam}
          currentLocationId={locationParam}
        />

        <PendingRegion label="Updating reviews…" className="space-y-4">
          {data.reviews.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title={
                filterParam !== "all" ||
                ratingParam !== undefined ||
                starsParam ||
                searchParam ||
                clientParam ||
                locationParam ||
                hasRange ||
                hasComment
                  ? "No reviews match your filters"
                  : "No reviews synced"
              }
              description={
                filterParam !== "all" ||
                ratingParam !== undefined ||
                starsParam ||
                searchParam ||
                clientParam ||
                locationParam ||
                hasRange ||
                hasComment
                  ? "Try a wider time range, or clear the filters."
                  : data.hasConnections
                    ? "Sync reviews from the dashboard to pull Google reviews here."
                    : "Connect a Google account in Settings first."
              }
            />
          ) : (
            <>
              <p className="text-[12px] tabular-nums text-slate">
                {data.totalReviewCount} matching
              </p>
              <ReviewList
                reviews={data.reviews}
                replies={data.replies}
                canApprove={canApprove}
              />
              {totalPages > 1 && (
                <PaginationBar
                  basePath="/reviews"
                  currentPage={currentPage}
                  totalPages={totalPages}
                  searchParams={queryForPagination}
                />
              )}
            </>
          )}
        </PendingRegion>
      </TransitionScope>
    </div>
  );
}
