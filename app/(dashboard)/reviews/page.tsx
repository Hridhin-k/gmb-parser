import { redirect } from "next/navigation";
import { workspaceDateRange } from "@/lib/services/date-range";
import { after } from "next/server";
import { getDashboardData, type DashboardFilters } from "@/lib/services/dashboard";
import { COMPLAINT_THEMES, REVIEW_LANGUAGES, type InboxSort } from "@/lib/review-inbox";
import { readPageScope } from "@/lib/services/scope-catalog";
import { EscalationContactStore, EscalationService } from "@/lib/services/escalations";
import { canApproveReplies, canSyncWorkspace, getWorkspaceRoster } from "@/lib/services/workspace";
import { allows, draftsWithAiOnly, workspaceGrant } from "@/lib/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SyncButton } from "@/components/sync-button";
import { ReviewFilters, ReviewSortMenu } from "@/components/review-filters";
import {
  TO_REPLY_STATUS_OPTIONS,
  inboxNarrowing,
  inboxStatuses,
  parseFollowUpQueue,
  parseInboxTab,
  plural,
  statusLabel,
  type InboxTab,
} from "@/components/reviews-status";
import { InboxTabs } from "@/components/reviews-inbox-tabs";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { ReviewList } from "@/components/review-list";
import { EscalationBoard } from "@/components/escalation-board";
import { PaginationBar } from "@/components/pagination-bar";
import Link from "next/link";
import { CheckCircle2, Download, MessageSquareText, SearchX } from "lucide-react";
import { validatePage, validateFilterString } from "@/lib/validation";
import {
  parseAllowedParams,
  parseRatingParams,
  parseStatusParams,
  serializeParamValues,
  splitParamValues,
} from "@/lib/review-filter-params";
import { dateRangeParams, parseFocusWindow } from "@/lib/date-range";
import { canReceiveEscalation, canReassignEscalation, formatInTimezone, slaClock } from "@/lib/escalations";
import { overviewQueryKey } from "@/lib/overview-board";
import { logger } from "@/lib/logger";

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const FOLLOW_UP_PAGE_SIZE = 30;
/** A case counts as "due soon" when its SLA ends within this window. */
const DUE_SOON_MS = 8 * 3_600_000;

function stampCase<T extends { dueAt: string }>(item: T, timezone: string) {
  const now = Date.now();
  const left = Date.parse(item.dueAt) - now;
  return {
    ...item,
    ...slaClock(item.dueAt, now),
    dueLabel: formatInTimezone(item.dueAt, timezone),
    dueSoon: left >= 0 && left <= DUE_SOON_MS,
  };
}

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);

  const statusParams = parseStatusParams(params.filter);
  const tab: InboxTab = parseInboxTab(params.tab, statusParams);
  const narrowing = inboxNarrowing(tab, statusParams);
  const ratingParams = parseRatingParams(params.rating);
  const starsParam =
    params.stars === "negative" || params.stars === "positive" || params.stars === "low"
      ? params.stars
      : "";
  const searchParam = validateFilterString(params.q);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientParam = resolved.clientId ?? "";
  const locationParam = resolved.locationId ?? "";
  const groupParam = resolved.groupId ?? "";
  const range = await workspaceDateRange(workspaceId, params, "all", new Date(), resolved.locationId);
  const focus = parseFocusWindow(params);
  const window = focus ?? range;
  const hasRange = range.key !== "all";
  const hasComment = params.comment === "1" || params.comment === "true";
  const textParam = params.text === "0" || params.text === "none" ? "none" : params.text === "1" || params.text === "has" ? "has" : "";
  const languageParams = parseAllowedParams(params.language, REVIEW_LANGUAGES.map((item) => item.id));
  const themeParams = parseAllowedParams(params.theme, COMPLAINT_THEMES.map((item) => item.id));
  const assigneeParams = splitParamValues(params.assignee).filter(
    (value) => value === "unassigned" || /^[0-9a-f-]{36}$/i.test(value)
  );
  // Stars shown as selected in the filter bar: explicit picks, else the
  // bucket an inbound link (stars=negative etc.) asked for.
  const bucketRatings =
    starsParam === "negative" ? [1, 2] : starsParam === "positive" ? [4, 5] : starsParam === "low" ? [1, 2, 3] : [];
  const shownRatings = ratingParams.length > 0 ? ratingParams : bucketRatings;
  const sortParam: InboxSort =
    params.sort === "oldest" || params.sort === "highest" || params.sort === "lowest" ? params.sort : "newest";
  const currentPage = validatePage(params.page);
  const selectedReviewId =
    typeof params.review === "string" && /^[0-9a-f-]{36}$/i.test(params.review) ? params.review : null;

  const baseFilters: DashboardFilters = {
    filters: [],
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
    page: 1,
    profileQ: "",
    profileSort: "attention",
    profilePage: 1,
  };
  const caseScope = {
    clientId: resolved.clientId,
    locationId: resolved.locationId,
    groupId: resolved.groupId,
    since: range.start?.toISOString() ?? null,
    until: range.end?.toISOString() ?? null,
  };
  const reviewTab = tab === "follow-ups" ? null : tab;

  const [role, toReply, sent, caseCounts, roster, contact] = await Promise.all([
    getActiveRole(),
    getDashboardData(workspaceId, {
      ...baseFilters,
      filters: inboxStatuses("to-reply", narrowing),
      page: reviewTab === "to-reply" ? currentPage : 1,
    }),
    getDashboardData(workspaceId, {
      ...baseFilters,
      filters: inboxStatuses("sent", []),
      page: reviewTab === "sent" ? currentPage : 1,
    }),
    EscalationService.counts(workspaceId, caseScope),
    getWorkspaceRoster(workspaceId),
    EscalationContactStore.read(workspaceId),
  ]);
  const data = reviewTab === "sent" ? sent : toReply;
  const canApprove = canApproveReplies(role);
  const aiOnly = draftsWithAiOnly(role);
  const openCases = caseCounts.needs_human + caseCounts.in_progress + caseCounts.past_sla;

  // Query that every tab link and the pagination carry: scope, period and
  // local filters. Status narrowing, paging and selection belong to one tab.
  const carried = new URLSearchParams();
  for (const [k, v] of Object.entries({
    rating: serializeParamValues(ratingParams) ?? "",
    stars: ratingParams.length > 0 ? "" : starsParam,
    q: searchParam,
    client: clientParam,
    location: locationParam,
    group: groupParam,
    comment: hasComment ? "1" : "",
    text: textParam === "has" ? "1" : textParam === "none" ? "0" : "",
    language: serializeParamValues(languageParams) ?? "",
    theme: serializeParamValues(themeParams) ?? "",
    assignee: serializeParamValues(assigneeParams) ?? "",
    sort: sortParam !== "newest" ? sortParam : "",
    ...dateRangeParams(range, "all"),
    focusFrom: focus?.from ?? "",
    focusTo: focus?.to ?? "",
  })) {
    if (v) carried.set(k, v);
  }
  const hrefWith = (mutate: (query: URLSearchParams) => void) => {
    const query = new URLSearchParams(carried);
    mutate(query);
    return query.size ? `/reviews?${query.toString()}` : "/reviews";
  };
  const tabHref = (key: InboxTab) =>
    hrefWith((query) => {
      if (key !== "to-reply") query.set("tab", key);
    });
  const tabCounts: Record<InboxTab, number> = {
    "to-reply": toReply.totalReviewCount,
    "follow-ups": openCases,
    sent: sent.totalReviewCount,
  };

  const members = roster.members.map((member) => ({ id: member.userId, email: member.email }));
  const canSyncRole = data.hasConnections && canSyncWorkspace(role);
  // Syncing follows the scope selector: one outlet, one group or one business
  // syncs only its locations. The organisation view syncs everything.
  const scoped = resolved.level !== "organisation";
  const syncIds = scoped && resolved.locationIds.length > 0 ? resolved.locationIds : undefined;
  // A scope that matches no locations must not fall back to syncing everything.
  const canSync = canSyncRole && (!scoped || resolved.locationIds.length > 0);
  const syncLabel = !scoped
    ? "Sync all"
    : resolved.locationIds.length === 1
      ? "Sync this location"
      : `Sync ${resolved.locationIds.length} locations`;

  const exportQuery = new URLSearchParams(carried);
  if (reviewTab) exportQuery.set("filter", inboxStatuses(reviewTab, narrowing).join(","));

  const headline =
    tab === "follow-ups"
      ? openCases === 0
        ? "No call-backs waiting."
        : `${plural(openCases, "customer needs", "customers need")} a call back`
      : toReply.totalReviewCount === 0
        ? "All caught up."
        : `${plural(toReply.totalReviewCount, "review needs", "reviews need")} a reply`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reviews"
        description={
          <>
            {headline} · {resolved.title}
            {hasRange ? ` · ${range.label}` : ""}
          </>
        }
      >
        {reviewTab && data.totalReviewCount > 0 ? (
          <a
            href={`/api/reviews/export?${exportQuery.toString()}`}
            className={buttonVariants({ variant: "outline" })}
          >
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </a>
        ) : null}
        {tab === "follow-ups" && workspaceGrant(role, "edit_rules") ? (
          <Link href="/settings?section=sla" className={buttonVariants({ variant: "outline" })}>
            Follow-up settings
          </Link>
        ) : null}
        {canSync ? <SyncButton key={syncIds?.join(",") ?? "all"} syncAll locationIds={syncIds} label={syncLabel} size="default" /> : null}
      </PageHeader>

      <TransitionScope>
        {reviewTab ? (
          <ReviewFilters
            currentFilters={narrowing}
            currentRatings={shownRatings}
            currentSearch={searchParam}
            currentHasComment={hasComment}
            currentLanguages={languageParams}
            currentThemes={themeParams}
            currentAssignees={assigneeParams}
            currentSort={sortParam}
            currentText={textParam}
            members={members}
            statusFilters={reviewTab === "to-reply" ? TO_REPLY_STATUS_OPTIONS : []}
            resultCount={data.totalReviewCount}
          />
        ) : null}

        <InboxTabs
          className="mt-4"
          tabs={[
            { key: "to-reply", label: "To reply" },
            { key: "follow-ups", label: "Follow-ups" },
            { key: "sent", label: "Sent" },
          ].map((item) => ({
            label: item.label,
            href: tabHref(item.key as InboxTab),
            active: item.key === tab,
            count: tabCounts[item.key as InboxTab],
          }))}
        />

        {focus ? (
          <Banner
            tone="info"
            className="mt-3"
            title={`This list is ${focus.label}.`}
            actions={
              <Link
                href={hrefWith((query) => {
                  query.delete("focusFrom");
                  query.delete("focusTo");
                  if (tab !== "to-reply") query.set("tab", tab);
                })}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Show the whole period
              </Link>
            }
          >
            The rest of the period is one click away.
          </Banner>
        ) : null}

        <FreshMetrics
          rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
          surface="reviews"
        >
          <PendingRegion label="Fetching reviews for the selected locations…" className="mt-4 flex flex-col gap-3">
            {reviewTab ? (
              <ReviewTabBody
                tab={reviewTab}
                data={data}
                carried={carried}
                narrowing={narrowing}
                currentPage={currentPage}
                filterState={{
                  hasLocal:
                    narrowing.length > 0 ||
                    ratingParams.length > 0 ||
                    !!starsParam ||
                    !!searchParam ||
                    focus !== null ||
                    hasComment ||
                    !!textParam ||
                    languageParams.length > 0 ||
                    themeParams.length > 0 ||
                    assigneeParams.length > 0,
                  hasScope: !!clientParam || !!locationParam || hasRange || !!groupParam,
                  summary: [
                    narrowing.length > 0 ? narrowing.map(statusLabel).join(" or ") : null,
                    shownRatings.length > 0 ? `${[...shownRatings].sort((a, b) => a - b).join(", ")}★` : null,
                    searchParam ? `“${searchParam}”` : null,
                    focus ? focus.label : null,
                    hasRange ? range.label : null,
                    resolved.title,
                  ].filter((item): item is string => Boolean(item)),
                  clearHref: hrefWith((query) => {
                    for (const key of ["rating", "stars", "q", "comment", "text", "language", "theme", "assignee", "sort", "focusFrom", "focusTo"]) {
                      query.delete(key);
                    }
                    if (tab !== "to-reply") query.set("tab", tab);
                  }),
                }}
                canSync={canSync}
                syncIds={syncIds}
                listProps={{
                  canApprove,
                  canPublishPositive: allows(role, "publish_positive"),
                  aiOnly,
                  contact,
                  members,
                  workspaceId,
                  selectedReviewId,
                }}
              />
            ) : (
              <FollowUpsBody
                params={params}
                workspaceId={workspaceId}
                role={role}
                caseScope={caseScope}
                counts={caseCounts}
                carried={carried}
                contact={contact}
                roster={roster.members}
              />
            )}
          </PendingRegion>
        </FreshMetrics>
      </TransitionScope>
    </div>
  );
}

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

async function ReviewTabBody({
  tab,
  data,
  carried,
  narrowing,
  currentPage,
  filterState,
  canSync,
  syncIds,
  listProps,
}: {
  tab: "to-reply" | "sent";
  data: DashboardData;
  carried: URLSearchParams;
  narrowing: string[];
  currentPage: number;
  filterState: { hasLocal: boolean; hasScope: boolean; summary: string[]; clearHref: string };
  canSync: boolean;
  syncIds: string[] | undefined;
  listProps: {
    canApprove: boolean;
    canPublishPositive: boolean;
    aiOnly: boolean;
    contact: Awaited<ReturnType<typeof EscalationContactStore.read>>;
    members: Array<{ id: string; email: string }>;
    workspaceId: string;
    selectedReviewId: string | null;
  };
}) {
  if (data.reviews.length === 0 && data.totalReviewCount > 0 && currentPage > 1) {
    const query = new URLSearchParams(carried);
    if (tab !== "to-reply") query.set("tab", tab);
    if (narrowing.length > 0) query.set("filter", narrowing.join(","));
    query.set("page", String(Math.max(1, Math.ceil(data.totalReviewCount / data.pageSize))));
    redirect(`/reviews?${query.toString()}`);
  }
  if (data.reviews.length === 0) {
    if (filterState.hasLocal || (filterState.hasScope && data.hasConnections && tab === "sent")) {
      return (
        <EmptyState
          icon={SearchX}
          title="No reviews match these filters"
          description={
            <>
              <span className="block">{filterState.summary.join(" · ")}</span>
              <span className="mt-1 block">Clear a filter, or choose a wider place in the sidebar.</span>
            </>
          }
        >
          {filterState.hasLocal ? (
            <Link href={filterState.clearHref} className={buttonVariants({ size: "sm" })}>
              Clear filters
            </Link>
          ) : null}
        </EmptyState>
      );
    }
    if (!data.hasConnections) {
      return (
        <EmptyState
          icon={MessageSquareText}
          title="No reviews yet"
          description="Connect a Google Business Profile account to bring your reviews into this list."
        >
          <Link href="/settings" className={buttonVariants({ size: "sm" })}>
            Connect Google in Settings
          </Link>
        </EmptyState>
      );
    }
    return tab === "to-reply" ? (
      <EmptyState
        icon={CheckCircle2}
        title="Every review has a reply"
        description="New reviews land here as soon as Google sends them."
      >
        {canSync ? <SyncButton key={syncIds?.join(",") ?? "all"} syncAll locationIds={syncIds} label="Sync reviews now" size="sm" /> : null}
      </EmptyState>
    ) : (
      <EmptyState icon={MessageSquareText} title="Nothing sent yet" description="Replies you send show here." />
    );
  }

  const openCases = await EscalationService.openForReviews(
    listProps.workspaceId,
    data.reviews.map((review) => review.id)
  );
  const totalPages = Math.max(1, Math.ceil(data.totalReviewCount / data.pageSize));
  const firstShown = (currentPage - 1) * data.pageSize + 1;
  const lastShown = Math.min(data.totalReviewCount, firstShown + data.reviews.length - 1);
  const pageQuery = new URLSearchParams(carried);
  if (tab !== "to-reply") pageQuery.set("tab", tab);
  if (narrowing.length > 0) pageQuery.set("filter", narrowing.join(","));

  return (
    <>
      <ReviewList
        key={`${tab}:${carried.toString()}:${narrowing.join(",")}:${currentPage}`}
        tab={tab}
        reviews={data.reviews}
        replies={data.replies}
        followUps={openCases}
        canApprove={listProps.canApprove}
        canPublishPositive={listProps.canPublishPositive}
        aiOnly={listProps.aiOnly}
        contact={listProps.contact}
        members={listProps.members}
        initialSelectedId={listProps.selectedReviewId}
        totalCount={data.totalReviewCount}
        sortControl={<ReviewSortMenu currentSort={pageQuery.get("sort") ?? "newest"} />}
        rangeLabel={`${firstShown.toLocaleString("en-US")}–${lastShown.toLocaleString("en-US")} of ${data.totalReviewCount.toLocaleString("en-US")}`}
      />
      {totalPages > 1 ? (
        <PaginationBar basePath="/reviews" currentPage={currentPage} totalPages={totalPages} searchParams={pageQuery} />
      ) : null}
    </>
  );
}

async function FollowUpsBody({
  params,
  workspaceId,
  role,
  caseScope,
  counts,
  carried,
  contact,
  roster,
}: {
  params: Record<string, string | string[] | undefined>;
  workspaceId: string;
  role: string | null;
  caseScope: { clientId: string | null; locationId: string | null; groupId: string | null; since: string | null; until: string | null };
  counts: Awaited<ReturnType<typeof EscalationService.counts>>;
  carried: URLSearchParams;
  contact: Awaited<ReturnType<typeof EscalationContactStore.read>>;
  roster: Awaited<ReturnType<typeof getWorkspaceRoster>>["members"];
}) {
  const queue = parseFollowUpQueue(params.queue);
  const page = validatePage(params.page);
  const requestedId = typeof params.id === "string" && /^[0-9a-f-]{36}$/i.test(params.id) ? params.id : null;
  const search = typeof params.q === "string" ? params.q : "";

  // Heavy ensure/reminder/SLA work must not block first paint — cron also runs it.
  after(async () => {
    try {
      await EscalationService.ensure(workspaceId);
      await Promise.all([
        EscalationService.processReminders(workspaceId),
        EscalationService.advanceOverdue(workspaceId),
      ]);
    } catch (error) {
      logger.error("escalations.page_maintenance_failed", {
        workspaceId,
        message: error instanceof Error ? error.message : "Unknown",
      });
    }
  });

  const [list, policy, pauses, scopes] = await Promise.all([
    EscalationService.queue({
      workspaceId,
      bucket: queue,
      ...caseScope,
      query: search || null,
      sort: params.sort === "opened" ? "opened" : "due",
      page,
      pageSize: FOLLOW_UP_PAGE_SIZE,
    }),
    EscalationService.policy(workspaceId),
    EscalationService.pausedTargets(workspaceId),
    EscalationService.scopes(workspaceId),
  ]);
  const selectedId = requestedId ?? list.items[0]?.id ?? null;
  if (selectedId) await EscalationService.settleOpenAssignments(workspaceId, selectedId);
  const selected = selectedId ? await EscalationService.get(workspaceId, selectedId) : null;
  const members = roster
    .filter((member) => member.accessEnabled)
    .map((member) => ({ userId: member.userId, email: member.email, role: member.role, scopeLabel: member.scopeLabel }));
  const assignees = selected
    ? roster
        .filter(
          (member) =>
            member.accessEnabled &&
            canReceiveEscalation(
              { userId: member.userId, role: member.role, enabled: true, scope: member.scope },
              {
                workspaceId,
                clientId: selected.clientId,
                groupId: selected.groupId ?? null,
                parentGroupId: selected.parentGroupId ?? null,
                locationId: selected.locationId,
              }
            )
        )
        .map((member) => member.userId)
    : [];
  const query = new URLSearchParams(carried);
  query.set("tab", "follow-ups");

  return (
    <EscalationBoard
      bucket={queue}
      counts={counts}
      items={list.items.map((item) => stampCase(item, policy.timezone))}
      selected={selected ? stampCase(selected, policy.timezone) : null}
      contact={contact}
      policy={policy}
      pauses={pauses}
      clients={scopes.clients}
      locations={scopes.locations}
      members={members}
      assignees={assignees}
      canManage={canApproveReplies(role)}
      canEditRules={workspaceGrant(role, "edit_rules")}
      canReassign={canReassignEscalation(role)}
      aiOnly={draftsWithAiOnly(role)}
      query={query.toString()}
      search={search}
      page={page}
      total={list.total}
      totalPages={Math.max(1, Math.ceil(list.total / FOLLOW_UP_PAGE_SIZE))}
    />
  );
}
