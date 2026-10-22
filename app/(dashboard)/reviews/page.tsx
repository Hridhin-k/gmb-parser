import { getDashboardData } from "@/lib/services/dashboard";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES, type InboxSort } from "@/lib/review-inbox";
import { readPageScope } from "@/lib/services/scope-catalog";
import { EscalationContactStore } from "@/lib/services/escalations";
import { canApproveReplies, canSyncWorkspace, getWorkspaceRoster } from "@/lib/services/workspace";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters } from "@/components/review-filters";
import { FreshMetrics } from "@/components/fresh-metrics";
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
import { overviewQueryKey } from "@/lib/overview-board";

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([
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
    "reopened",
    "escalated",
  ].includes(typeof params.filter === "string" ? params.filter : "")
    ? (params.filter as string)
    : "all";

  const ratingParam = validateRatingFilter(params.rating);
  const starsParam =
    params.stars === "negative" || params.stars === "positive" || params.stars === "low"
      ? params.stars
      : "";
  const searchParam = validateFilterString(params.q);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientParam = resolved.clientId ?? "";
  const locationParam = resolved.locationId ?? "";
  const range = parseDateRange(params, "all");
  const hasRange = range.key !== "all";
  const hasComment = params.comment === "1" || params.comment === "true";
  const textParam = params.text === "0" || params.text === "none" ? "none" : params.text === "1" || params.text === "has" ? "has" : "";
  const languageParam = REVIEW_LANGUAGES.some((item) => item.id === params.language) ? String(params.language) : "";
  const themeParam = COMPLAINT_THEMES.some((item) => item.id === params.theme) ? String(params.theme) : "";
  const assigneeParam =
    params.assignee === "unassigned" ||
    (typeof params.assignee === "string" && /^[0-9a-f-]{36}$/i.test(params.assignee))
      ? params.assignee
      : "";
  const groupParam = resolved.groupId ?? "";
  const sortParam: InboxSort =
    params.sort === "oldest" || params.sort === "highest" || params.sort === "lowest" ? params.sort : "newest";
  const currentPage = validatePage(params.page);

  const [role, data, roster, contact] = await Promise.all([
    getActiveRole(),
    getDashboardData(workspaceId, {
      filter: filterParam,
      rating: ratingParam,
      ratingBucket: starsParam === "low" ? "escalation" : starsParam || undefined,
      q: searchParam,
      clientId: clientParam,
      locationId: locationParam,
      since: range.start?.toISOString() ?? null,
      until: range.end?.toISOString() ?? null,
      hasComment: hasComment || textParam === "has" || undefined,
      text: textParam || undefined,
      language: languageParam || undefined,
      theme: themeParam || undefined,
      assignee: assigneeParam || undefined,
      groupId: groupParam || undefined,
      sort: sortParam,
      page: currentPage,
      profileQ: "",
      profileSort: "attention",
      profilePage: 1,
    }),
    getWorkspaceRoster(workspaceId),
    EscalationContactStore.read(workspaceId),
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
    text: textParam === "has" ? "1" : textParam === "none" ? "0" : "",
    language: languageParam,
    theme: themeParam,
    assignee: assigneeParam,
    group: groupParam,
    sort: sortParam !== "newest" ? sortParam : "",
    ...dateRangeParams(range, "all"),
  })) {
    if (v) queryForPagination.set(k, v);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
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
          hideScope
          showInboxFilters
          currentLanguage={languageParam}
          currentTheme={themeParam}
          currentAssignee={assigneeParam}
          currentGroupId={groupParam}
          currentSort={sortParam}
          currentText={textParam}
          groups={data.groups}
          members={roster.members.map((member) => ({ id: member.userId, email: member.email }))}
          statusFilters={[
            { key: "all", label: "All" },
            { key: "unanswered", label: "Needs reply" },
            { key: "escalated", label: "Escalated" },
            { key: "draft", label: "Draft ready" },
            { key: "approved", label: "Ready to publish" },
            { key: "failed", label: "Failed" },
            { key: "published", label: "Replied" },
            { key: "reopened", label: "Reopened" },
            { key: "answered", label: "Any reply" },
          ]}
        />

        <FreshMetrics
          rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
          surface="reviews"
        >
        <PendingRegion label="Fetching reviews for the selected locations…" className="space-y-4">
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
                hasComment ||
                textParam ||
                languageParam ||
                themeParam ||
                assigneeParam ||
                groupParam
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
                hasComment ||
                textParam ||
                languageParam ||
                themeParam ||
                assigneeParam ||
                groupParam
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
                contact={contact}
                members={roster.members.map((member) => ({ id: member.userId, email: member.email }))}
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
        </FreshMetrics>
      </TransitionScope>
    </div>
  );
}
