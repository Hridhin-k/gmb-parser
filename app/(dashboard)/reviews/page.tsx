import { getDashboardData } from "@/lib/services/dashboard";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES, type InboxSort } from "@/lib/review-inbox";
import { readPageScope } from "@/lib/services/scope-catalog";
import { EscalationContactStore } from "@/lib/services/escalations";
import { canApproveReplies, canSyncWorkspace, getWorkspaceRoster } from "@/lib/services/workspace";
import { draftsWithAiOnly } from "@/lib/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters } from "@/components/review-filters";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { ReviewList } from "@/components/review-list";
import { PaginationBar } from "@/components/pagination-bar";
import Link from "next/link";
import { Download, MessageSquareText } from "lucide-react";
import {
  validatePage,
  validateFilterString,
} from "@/lib/validation";
import {
  parseAllowedParams,
  parseRatingParams,
  parseStatusParams,
  serializeParamValues,
  splitParamValues,
} from "@/lib/review-filter-params";
import { dateRangeParams, parseDateRange, parseFocusWindow } from "@/lib/date-range";
import { overviewQueryKey } from "@/lib/overview-board";

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const statusParams = parseStatusParams(params.filter);
  const ratingParams = parseRatingParams(params.rating);
  const starsParam =
    params.stars === "negative" || params.stars === "positive" || params.stars === "low"
      ? params.stars
      : "";
  const searchParam = validateFilterString(params.q);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientParam = resolved.clientId ?? "";
  const locationParam = resolved.locationId ?? "";
  const range = parseDateRange(params, "all");
  const focus = parseFocusWindow(params);
  const window = focus ?? range;
  const hasRange = range.key !== "all";
  const hasComment = params.comment === "1" || params.comment === "true";
  const textParam = params.text === "0" || params.text === "none" ? "none" : params.text === "1" || params.text === "has" ? "has" : "";
  const languageParams = parseAllowedParams(
    params.language,
    REVIEW_LANGUAGES.map((item) => item.id)
  );
  const themeParams = parseAllowedParams(
    params.theme,
    COMPLAINT_THEMES.map((item) => item.id)
  );
  const assigneeParams = splitParamValues(params.assignee).filter(
    (value) => value === "unassigned" || /^[0-9a-f-]{36}$/i.test(value)
  );
  const groupParam = resolved.groupId ?? "";
  // Stars shown as selected in the filter bar: explicit picks, else the
  // bucket an inbound link (stars=negative etc.) asked for.
  const bucketRatings =
    starsParam === "negative"
      ? [1, 2]
      : starsParam === "positive"
        ? [4, 5]
        : starsParam === "low"
          ? [1, 2, 3]
          : [];
  const shownRatings = ratingParams.length > 0 ? ratingParams : bucketRatings;
  const sortParam: InboxSort =
    params.sort === "oldest" || params.sort === "highest" || params.sort === "lowest" ? params.sort : "newest";
  const currentPage = validatePage(params.page);

  const [role, data, roster, contact] = await Promise.all([
    getActiveRole(),
    getDashboardData(workspaceId, {
      filters: statusParams,
      ratings: ratingParams.length > 0 ? ratingParams : undefined,
      ratingBucket: starsParam === "low" ? "escalation" : starsParam || undefined,
      q: searchParam,
      clientId: clientParam,
      locationId: locationParam,
      since: window.start?.toISOString() ?? null,
      until: window.end?.toISOString() ?? null,
      hasComment: hasComment || textParam === "has" || undefined,
      text: textParam || undefined,
      languages: languageParams.length > 0 ? languageParams : undefined,
      themes: themeParams.length > 0 ? themeParams : undefined,
      assignees: assigneeParams.length > 0 ? assigneeParams : undefined,
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
    filter: serializeParamValues(statusParams) ?? "",
    rating: serializeParamValues(ratingParams) ?? "",
    stars: ratingParams.length > 0 ? "" : starsParam,
    q: searchParam,
    client: clientParam,
    location: locationParam,
    comment: hasComment ? "1" : "",
    text: textParam === "has" ? "1" : textParam === "none" ? "0" : "",
    language: serializeParamValues(languageParams) ?? "",
    theme: serializeParamValues(themeParams) ?? "",
    assignee: serializeParamValues(assigneeParams) ?? "",
    group: groupParam,
    sort: sortParam !== "newest" ? sortParam : "",
    ...dateRangeParams(range, "all"),
    focusFrom: focus?.from ?? "",
    focusTo: focus?.to ?? "",
  })) {
    if (v) queryForPagination.set(k, v);
  }
  const periodQuery = new URLSearchParams(queryForPagination);
  periodQuery.delete("focusFrom");
  periodQuery.delete("focusTo");
  const periodHref = periodQuery.size ? `/reviews?${periodQuery.toString()}` : "/reviews";

  const hasAnyFilter =
    statusParams.length > 0 ||
    ratingParams.length > 0 ||
    !!starsParam ||
    !!searchParam ||
    !!clientParam ||
    !!locationParam ||
    hasRange ||
    focus !== null ||
    hasComment ||
    !!textParam ||
    languageParams.length > 0 ||
    themeParams.length > 0 ||
    assigneeParams.length > 0 ||
    !!groupParam;

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
          currentFilters={statusParams}
          currentRatings={shownRatings}
          currentSearch={searchParam}
          currentRange={{ key: range.key, from: range.from, to: range.to }}
          currentHasComment={hasComment}
          clients={data.clients}
          locations={data.locations}
          currentClientId={clientParam}
          currentLocationId={locationParam}
          hideScope
          showInboxFilters
          currentLanguages={languageParams}
          currentThemes={themeParams}
          currentAssignees={assigneeParams}
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

        {focus ? (
          <p className="text-sm text-slate">
            This list is {focus.label}. The date above stays {range.label}.{" "}
            <Link href={periodHref} className="font-medium text-ink underline">
              Show the whole period
            </Link>
          </p>
        ) : null}

        <FreshMetrics
          rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
          surface="reviews"
        >
        <PendingRegion label="Fetching reviews for the selected locations…" className="space-y-4">
          {data.reviews.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title={
                hasAnyFilter
                  ? "No reviews match your filters"
                  : "No reviews synced"
              }
              description={
                hasAnyFilter
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
                aiOnly={draftsWithAiOnly(role)}
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
