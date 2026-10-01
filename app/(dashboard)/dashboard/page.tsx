import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/services/dashboard";
import { ensurePersonalWorkspace, canApproveReplies, getMemberRole } from "@/lib/services/workspace";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { DashboardStats } from "@/components/dashboard-stats";
import { AttentionQueue } from "@/components/attention-queue";
import { ProfileDirectory } from "@/components/profile-directory";
import { ProfileInsightPanel } from "@/components/profile-insight-panel";
import { ReviewFilters } from "@/components/review-filters";
import { ReviewList } from "@/components/review-list";
import { MessageSquareText, Building2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  validatePage,
  validateRatingFilter,
  validateFilterString,
} from "@/lib/validation";

interface DashboardPageProps {
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
    return qs ? `/dashboard?${qs}` : "/dashboard";
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

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const membership = await ensurePersonalWorkspace(user!);
  const canApprove = canApproveReplies(
    await getMemberRole(user!.id, membership.workspace_id)
  );

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
  const profileQ = validateFilterString(params.pq);
  const profileSort = [
    "attention",
    "unanswered",
    "rating",
    "name",
    "reviews",
  ].includes(typeof params.psort === "string" ? params.psort : "")
    ? (params.psort as
        | "attention"
        | "unanswered"
        | "rating"
        | "name"
        | "reviews")
    : "attention";
  const profilePage = validatePage(params.pp);

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
    profileQ,
    profileSort,
    profilePage,
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
    pq: profileQ,
    psort: profileSort !== "attention" ? profileSort : "",
    pp: profilePage > 1 ? String(profilePage) : "",
  })) {
    if (v) queryForPagination.set(k, v);
  }

  const empty =
    data.kpis.totalReviews === 0 && data.kpis.locationsActive === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Built for scale — find what needs work across hundreds of profiles, then act in place."
      >
        {data.hasConnections && (
          <SyncButton syncAll label="Sync reviews" size="sm" />
        )}
      </PageHeader>

      {empty ? (
        <EmptyState
          icon={MessageSquareText}
          title="No reviews yet"
          description={
            data.hasConnections
              ? data.kpis.clientsActive > 0
                ? "Sync reviews to populate insights and your reply inbox."
                : "Sync profiles on Clients to auto-create clients, then sync reviews."
              : "Connect Google in Settings to get started."
          }
        >
          <div className="flex gap-2">
            {!data.hasConnections && (
              <Link href="/settings">
                <Button variant="outline" size="sm">
                  Connect Google
                </Button>
              </Link>
            )}
            {data.hasConnections && data.kpis.clientsActive === 0 && (
              <Link href="/clients">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Building2 className="h-3.5 w-3.5" aria-hidden />
                  Sync profiles
                </Button>
              </Link>
            )}
            {data.hasConnections && data.kpis.clientsActive > 0 && (
              <SyncButton syncAll label="Sync reviews now" size="sm" />
            )}
          </div>
        </EmptyState>
      ) : (
        <>
          <DashboardStats kpis={data.kpis} basePath="/dashboard" />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="space-y-5">
              <AttentionQueue
                profiles={data.attentionQueue}
                totalNeedingReply={data.kpis.profilesNeedingReply}
              />
              <ProfileDirectory
                profiles={data.profileDirectory}
                total={data.profileTotal}
                pageSize={data.profilePageSize}
                currentPage={profilePage}
                currentSort={profileSort}
                currentQuery={profileQ}
                selectedLocationId={locationParam}
              />
            </div>

            <div className="space-y-4">
              {data.selectedProfile ? (
                <ProfileInsightPanel
                  profile={data.selectedProfile}
                  insight={data.selectedInsight}
                  heuristicSummary={data.selectedHeuristic}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-4 py-6 text-center">
                  <p className="text-[13px] font-medium text-gray-700">
                    Select a profile
                  </p>
                  <p className="mt-1 text-[12px] text-gray-500">
                    Open one from Needs attention or the directory to see its AI
                    summary and scoped inbox — never loads AI for all{" "}
                    {data.kpis.locationsActive} profiles at once.
                  </p>
                </div>
              )}

              <section id="inbox" className="scroll-mt-4 space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      Review inbox
                      {data.selectedProfile
                        ? ` · ${data.selectedProfile.title}`
                        : ""}
                    </h2>
                    <p className="text-[12px] text-gray-500">
                      Draft, approve, and publish without leaving the dashboard.
                    </p>
                  </div>
                  <p className="text-[12px] tabular-nums text-gray-400">
                    {data.totalReviewCount} matching
                  </p>
                </div>

                <ReviewFilters
                  currentFilter={filterParam}
                  currentRating={
                    ratingParam !== undefined ? String(ratingParam) : ""
                  }
                  currentRatingBucket={starsParam}
                  currentSearch={searchParam}
                  currentPeriod={periodParam}
                  currentHasComment={hasComment}
                  clients={data.clients}
                  locations={data.locations}
                  currentClientId={clientParam}
                  currentLocationId={locationParam}
                  compact
                />

                {data.reviews.length === 0 ? (
                  <EmptyState
                    icon={MessageSquareText}
                    title="No reviews match these filters"
                    description="Clear filters, pick another profile, or sync more reviews."
                  />
                ) : (
                  <>
                    <ReviewList
                      reviews={data.reviews}
                      replies={data.replies}
                      canApprove={canApprove}
                    />
                    {totalPages > 1 && (
                      <PaginationBar
                        currentPage={currentPage}
                        totalPages={totalPages}
                        searchParams={queryForPagination}
                      />
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
