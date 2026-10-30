import { getDashboardData } from "@/lib/services/dashboard";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES, type InboxSort } from "@/lib/review-inbox";
import { readPageScope } from "@/lib/services/scope-catalog";
import { EscalationContactStore } from "@/lib/services/escalations";
import { canApproveReplies, canSyncWorkspace, getWorkspaceRoster } from "@/lib/services/workspace";
import { draftsWithAiOnly } from "@/lib/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader, PageTabs } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters, ReviewSortMenu } from "@/components/review-filters";
import { REVIEW_STATUS_OPTIONS, REVIEW_STATUS_TABS, activeStatusTab, statusLabel } from "@/components/reviews-status";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { ReviewList } from "@/components/review-list";
import { PaginationBar } from "@/components/pagination-bar";
import Link from "next/link";
import { Download, MessageSquareText, SearchX } from "lucide-react";
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

  // Local filters only. Scope and period come from the top bar and are not
  // "filters" the user can clear here.
  const hasLocalFilter =
    statusParams.length > 0 ||
    ratingParams.length > 0 ||
    !!starsParam ||
    !!searchParam ||
    focus !== null ||
    hasComment ||
    !!textParam ||
    languageParams.length > 0 ||
    themeParams.length > 0 ||
    assigneeParams.length > 0;
  const hasAnyFilter = hasLocalFilter || !!clientParam || !!locationParam || hasRange || !!groupParam;

  const hrefWith = (mutate: (query: URLSearchParams) => void) => {
    const query = new URLSearchParams(queryForPagination);
    mutate(query);
    return query.size ? `/reviews?${query.toString()}` : "/reviews";
  };
  const activeTab = activeStatusTab(statusParams);
  const tabs = REVIEW_STATUS_TABS.map((tab) => {
    const active = activeTab === tab.key;
    return {
      label: tab.label,
      href: hrefWith((query) => {
        if (tab.key === "all") query.delete("filter");
        else query.set("filter", tab.key);
      }),
      active,
      count: active ? data.totalReviewCount : null,
      tone: tab.key === "failed" ? ("bad" as const) : ("default" as const),
    };
  });
  // Keep scope and period; drop every local filter (and the status tab).
  const clearFiltersHref = hrefWith((query) => {
    for (const key of [
      "filter",
      "rating",
      "stars",
      "q",
      "comment",
      "text",
      "language",
      "theme",
      "assignee",
      "sort",
      "focusFrom",
      "focusTo",
    ]) {
      query.delete(key);
    }
  });
  const wholePeriodHref = hrefWith((query) => {
    query.delete("range");
    query.delete("from");
    query.delete("to");
    query.delete("focusFrom");
    query.delete("focusTo");
  });
  const members = roster.members.map((member) => ({ id: member.userId, email: member.email }));
  const canSync = data.hasConnections && canSyncWorkspace(role);
  const firstShown = (currentPage - 1) * data.pageSize + 1;
  const lastShown = Math.min(data.totalReviewCount, firstShown + data.reviews.length - 1);
  const filterSummary = [
    statusParams.length > 0 ? statusParams.map(statusLabel).join(" or ") : null,
    shownRatings.length > 0 ? `${[...shownRatings].sort((a, b) => a - b).join(", ")}★` : null,
    searchParam ? `“${searchParam}”` : null,
    textParam === "has" || hasComment ? "Has review text" : textParam === "none" ? "Rating only" : null,
    languageParams.length > 0 ? `${languageParams.length} language${languageParams.length === 1 ? "" : "s"}` : null,
    themeParams.length > 0 ? `${themeParams.length} theme${themeParams.length === 1 ? "" : "s"}` : null,
    assigneeParams.length > 0 ? `${assigneeParams.length} assignee${assigneeParams.length === 1 ? "" : "s"}` : null,
    focus ? focus.label : null,
    range.label,
    resolved.title,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Reviews"
        description={
          <>
            {resolved.title} · {range.label}
            {data.totalReviewCount > 0 ? (
              <>
                {" · "}
                <span className="tabular-nums">{data.totalReviewCount.toLocaleString("en-US")}</span> matching
              </>
            ) : null}
          </>
        }
      >
        {data.totalReviewCount > 0 && (
          <a
            href={`/api/reviews/export?${queryForPagination.toString()}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </a>
        )}
        {canSync ? <SyncButton syncAll label="Sync all" size="default" /> : null}
      </PageHeader>

      <TransitionScope>
        <PageTabs tabs={tabs} />

        <ReviewFilters
          currentFilters={statusParams}
          currentRatings={shownRatings}
          currentSearch={searchParam}
          currentHasComment={hasComment}
          currentLanguages={languageParams}
          currentThemes={themeParams}
          currentAssignees={assigneeParams}
          currentSort={sortParam}
          currentText={textParam}
          members={members}
          statusFilters={REVIEW_STATUS_OPTIONS}
          resultCount={data.totalReviewCount}
        />

        {focus ? (
          <Banner
            tone="info"
            title={`This list is ${focus.label}.`}
            actions={
              <Link href={periodHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Show the whole period
              </Link>
            }
          >
            The period in the top bar stays {range.label}.
          </Banner>
        ) : null}

        <FreshMetrics
          rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
          surface="reviews"
        >
          <PendingRegion label="Fetching reviews for the selected locations…" className="flex flex-col gap-3">
            {data.reviews.length === 0 ? (
              hasAnyFilter && (hasLocalFilter || data.hasConnections) ? (
                <EmptyState
                  icon={SearchX}
                  title="No reviews match these filters"
                  description={
                    <>
                      <span className="block">{filterSummary.join(" · ")}</span>
                      <span className="mt-1 block">Clear a filter, or widen the period in the top bar.</span>
                    </>
                  }
                >
                  {hasLocalFilter ? (
                    <Link href={clearFiltersHref} className={buttonVariants({ size: "sm" })}>
                      Clear filters
                    </Link>
                  ) : null}
                  {hasRange || focus ? (
                    <Link href={wholePeriodHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      Show all time
                    </Link>
                  ) : null}
                </EmptyState>
              ) : data.hasConnections ? (
                <EmptyState
                  icon={MessageSquareText}
                  title="No reviews synced yet"
                  description="Reviews appear here once Google sends them. Sync now to pull the latest reviews for your connected locations."
                >
                  {canSync ? <SyncButton syncAll label="Sync reviews now" size="sm" /> : null}
                </EmptyState>
              ) : (
                <EmptyState
                  icon={MessageSquareText}
                  title="No reviews yet"
                  description="Connect a Google Business Profile account to bring your reviews into this list."
                >
                  <Link href="/settings" className={buttonVariants({ size: "sm" })}>
                    Connect Google in Settings
                  </Link>
                </EmptyState>
              )
            ) : (
              <>
                <ReviewList
                  reviews={data.reviews}
                  replies={data.replies}
                  canApprove={canApprove}
                  aiOnly={draftsWithAiOnly(role)}
                  contact={contact}
                  members={members}
                  sortControl={<ReviewSortMenu currentSort={sortParam} />}
                  rangeLabel={`${firstShown.toLocaleString("en-US")}–${lastShown.toLocaleString("en-US")} of ${data.totalReviewCount.toLocaleString("en-US")}`}
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
