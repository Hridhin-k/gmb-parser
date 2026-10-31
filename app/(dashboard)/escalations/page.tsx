import { workspaceGrant } from "@/lib/access";
import Link from "next/link";
import { after } from "next/server";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { EscalationBoard } from "@/components/escalation-board";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { formatInTimezone, slaClock } from "@/lib/escalations";
import { EscalationService } from "@/lib/services/escalations";
import { readPageScope } from "@/lib/services/scope-catalog";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canApproveReplies, getWorkspaceRoster } from "@/lib/services/workspace";
import { overviewQueryKey } from "@/lib/overview-board";
import { validatePage } from "@/lib/validation";
import { logger } from "@/lib/logger";

interface EscalationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const BUCKETS = ["needs_human", "in_progress", "past_sla", "resolved"] as const;
const PAGE_SIZE = 20;
/** A case counts as "due soon" when its SLA ends within this window. */
const DUE_SOON_MS = 8 * 3_600_000;

function stampQueue<T extends { dueAt: string }>(items: T[], timezone: string) {
  const now = Date.now();
  return items.map((item) => ({
    ...item,
    ...slaClock(item.dueAt, now),
    dueLabel: formatInTimezone(item.dueAt, timezone),
    dueSoon: (() => {
      const left = Date.parse(item.dueAt) - now;
      return left >= 0 && left <= DUE_SOON_MS;
    })(),
  }));
}

export default async function EscalationsPage({ searchParams }: EscalationsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const requested = typeof params.queue === "string" ? params.queue : "needs_human";
  const bucket = BUCKETS.includes(requested as (typeof BUCKETS)[number])
    ? (requested as (typeof BUCKETS)[number])
    : "needs_human";
  const resolved = await readPageScope(user.id, workspaceId, params);
  const clientId = resolved.clientId;
  const locationId = resolved.locationId;
  const groupId = resolved.groupId;
  const range = parseDateRange(params, "all");
  const page = validatePage(params.page);
  const scope = {
    clientId,
    locationId,
    groupId,
    since: range.start?.toISOString() ?? null,
    until: range.end?.toISOString() ?? null,
  };

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

  const search = typeof params.q === "string" ? params.q : "";
  const sort = params.sort === "opened" ? "opened" : "due";
  const [assignmentReady, queue, counts, policy, pauses, scopes, roster] = await Promise.all([
    EscalationService.assignmentColumnsReady(),
    EscalationService.queue({
      workspaceId,
      bucket,
      ...scope,
      query: search || null,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    EscalationService.counts(workspaceId, scope),
    EscalationService.policy(workspaceId),
    EscalationService.pausedTargets(workspaceId),
    EscalationService.scopes(workspaceId),
    getWorkspaceRoster(workspaceId),
  ]);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    client: clientId ?? "",
    location: locationId ?? "",
    group: groupId ?? "",
    ...dateRangeParams(range, "all"),
    q: search,
    sort: sort === "opened" ? "opened" : "",
  })) {
    if (value) query.set(key, value);
  }

  const open = counts.needs_human + counts.in_progress + counts.past_sla;
  const canManage = canApproveReplies(role);

  return (
    <TransitionScope>
      <PageHeader
        title="Customer follow-ups"
        description={`${open.toLocaleString("en-US")} ${open === 1 ? "customer needs" : "customers need"} extra care. Reply, take any action needed, then mark the follow-up done. Everything else stays in Reviews.`}
      >
        {workspaceGrant(role, "edit_rules") ? (
          <Link href="/settings?section=sla" className={buttonVariants({ variant: "outline" })}>
            Follow-up settings
          </Link>
        ) : null}
      </PageHeader>
      <FreshMetrics
        rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
        surface="escalations"
      >
        <PendingRegion label="Updating follow-ups…">
          <div className="mt-5 space-y-4">
            {assignmentReady ? null : (
              <Banner tone="warn" title="Owners are not stored yet.">
                Manager assignment and the one-step SLA move need the escalation assignment migration. Until it is
                applied, the queue still follows the complaint rules but owners are not recorded.
              </Banner>
            )}
            <div className="rounded-lg border border-line bg-white px-4 py-3 text-[13px] text-ink-2">
              <p><b className="font-medium text-ink">Added automatically:</b> {policy.maxStars === 5 ? "all reviews" : `reviews with ${policy.maxStars} ${policy.maxStars === 1 ? "star" : "stars"} or less`}{policy.flagLegalSafety || policy.flagProfanity || policy.extraKeywords.length ? ", plus reviews matching your other watch rules" : ""}.</p>
              <p className="mt-1 text-xs text-ink-3">Default deadline: {policy.dueHours} hours from when the review was posted, including nights and weekends. If you work alone, follow-ups come to you.</p>
            </div>
            <EscalationBoard
              bucket={bucket}
              counts={counts}
              items={stampQueue(queue.items, policy.timezone)}
              policy={policy}
              pauses={pauses}
              clients={scopes.clients}
              locations={scopes.locations}
              members={roster.members
                .filter((member) => member.accessEnabled)
                .map((member) => ({
                  userId: member.userId,
                  email: member.email,
                  role: member.role,
                  scopeLabel: member.scopeLabel,
                }))}
              canManage={canManage}
              canEditRules={workspaceGrant(role, "edit_rules")}
              query={query.toString()}
              search={search}
              page={page}
              total={queue.total}
              totalPages={Math.max(1, Math.ceil(queue.total / PAGE_SIZE))}
            />
          </div>
        </PendingRegion>
      </FreshMetrics>
    </TransitionScope>
  );
}
