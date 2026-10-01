import { getDashboardData } from "@/lib/services/dashboard";
import { canApproveReplies } from "@/lib/services/workspace";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters } from "@/components/review-filters";
import { ReviewList } from "@/components/review-list";
import { PaginationBar } from "@/components/pagination-bar";
import { Download, MessageSquareText } from "lucide-react";
import {
  validatePage,
  validateRatingFilter,
  validateFilterString,
} from "@/lib/validation";

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
  const periodParam =
    params.period === "7d" ||
    params.period === "30d" ||
    params.period === "90d"
      ? params.period
      : "all";
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
      period: periodParam,
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
    Math.ceil(data.totalReviewCount / data.pageSize)
  );

  const queryForPagination = new URLSearchParams();
  for (const [k, v] of Object.entries({
    filter: filterParam !== "all" ? filterParam : "",
    rating: ratingParam != null ? String(ratingParam) : "",
    stars: starsParam,
    q: searchParam,
    client: clientParam,
    location: locationParam,
    period: periodParam !== "all" ? periodParam : "",
    comment: hasComment ? "1" : "",
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
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#d9d2ff] bg-white px-4 text-sm font-medium text-[#18161a] hover:border-[#4823ff]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </a>
          )}
          {data.hasConnections && (
            <SyncButton syncAll label="Sync all" size="sm" />
          )}
        </div>
      </PageHeader>

      <ReviewFilters
        currentFilter={filterParam}
        currentRating={ratingParam !== undefined ? String(ratingParam) : ""}
        currentRatingBucket={starsParam}
        currentSearch={searchParam}
        currentPeriod={periodParam}
        currentHasComment={hasComment}
        clients={data.clients}
        locations={data.locations}
        currentClientId={clientParam}
        currentLocationId={locationParam}
      />

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
            periodParam !== "all" ||
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
            locationParam
              ? "Try adjusting your filters or search terms."
              : data.hasConnections
                ? "Sync reviews from the dashboard to pull Google reviews here."
                : "Connect a Google account in Settings first."
          }
        />
      ) : (
        <>
          <p className="text-[12px] tabular-nums text-[#898b91]">
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
    </div>
  );
}
