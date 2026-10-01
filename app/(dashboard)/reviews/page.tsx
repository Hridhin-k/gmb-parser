import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/services/dashboard";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters } from "@/components/review-filters";
import { ReviewList } from "@/components/review-list";
import { MessageSquareText } from "lucide-react";
import {
  validatePage,
  validateRatingFilter,
  validateFilterString,
} from "@/lib/validation";

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function PaginationBar({
  currentPage,
  totalPages,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  searchParams: URLSearchParams;
}) {
  function hrefFor(page: number) {
    const p = new URLSearchParams(searchParams.toString());
    if (page <= 1) p.delete("page");
    else p.set("page", String(page));
    const qs = p.toString();
    return qs ? `/reviews?${qs}` : "/reviews";
  }

  const prev = currentPage > 1 ? currentPage - 1 : null;
  const next = currentPage < totalPages ? currentPage + 1 : null;

  return (
    <div className="flex items-center justify-center gap-3 py-2 text-sm text-gray-600">
      {prev ? (
        <a
          href={hrefFor(prev)}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50"
        >
          Previous
        </a>
      ) : (
        <span className="rounded border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">
          Previous
        </span>
      )}
      <span>
        Page {currentPage} of {totalPages}
      </span>
      {next ? (
        <a
          href={hrefFor(next)}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50"
        >
          Next
        </a>
      ) : (
        <span className="rounded border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">
          Next
        </span>
      )}
    </div>
  );
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("grm_workspace_members")
    .select("workspace_id")
    .eq("user_id", user!.id)
    .limit(1)
    .single();

  if (!membership) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reviews" />
        <EmptyState
          icon={MessageSquareText}
          title="No workspace found"
          description="Contact support to set up your workspace."
        />
      </div>
    );
  }

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

  const data = await getDashboardData(membership.workspace_id, {
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
  });

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
    <div className="space-y-5">
      <PageHeader
        title="Reviews"
        description="Full review inbox with the same filters and actions as the dashboard."
      >
        {data.hasConnections && (
          <SyncButton syncAll label="Sync all" size="sm" />
        )}
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
          <p className="text-[12px] tabular-nums text-gray-400">
            {data.totalReviewCount} matching
          </p>
          <ReviewList reviews={data.reviews} replies={data.replies} />
          {totalPages > 1 && (
            <PaginationBar
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
