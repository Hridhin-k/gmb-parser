import { Suspense } from "react";
import { after } from "next/server";
import { FreshMetrics } from "@/components/fresh-metrics";
import { PageHeader } from "@/components/page-header";
import { SectionLoading } from "@/components/section-loading";
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

function stampQueue<T extends { dueAt: string }>(items: T[], timezone: string) {
  const now = Date.now();
  return items.map((item) => ({
    ...item,
    ...slaClock(item.dueAt, now),
    dueLabel: formatInTimezone(item.dueAt, timezone),
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

  return (
    <TransitionScope>
      <PageHeader
        title="Escalations"
        description="Each case opens on its own page. Assign it, comment, and resolve it there. Resolving emails the organisation resolution address. A published reply does not close the case."
      />
      <FreshMetrics
        rendered={overviewQueryKey((key) => (Array.isArray(params[key]) ? params[key][0] : params[key]))}
        surface="escalations"
      >
        <PendingRegion label="Updating escalations…">
          <div className="mt-6">
            <Suspense fallback={<SectionLoading page="escalations" variant="rows" />}>
              <EscalationsBoardSection
                workspaceId={workspaceId}
                role={role}
                bucket={bucket}
                scope={scope}
                search={search}
                sort={sort}
                page={page}
                query={query.toString()}
              />
            </Suspense>
          </div>
        </PendingRegion>
      </FreshMetrics>
    </TransitionScope>
  );
}

async function EscalationsBoardSection({
  workspaceId,
  role,
  bucket,
  scope,
  search,
  sort,
  page,
  query,
}: {
  workspaceId: string;
  role: Awaited<ReturnType<typeof getActiveRole>>;
  bucket: (typeof BUCKETS)[number];
  scope: {
    clientId: string | null;
    locationId: string | null;
    groupId: string | null;
    since: string | null;
    until: string | null;
  };
  search: string;
  sort: "opened" | "due";
  page: number;
  query: string;
}) {
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

  return (
    <>
      {assignmentReady ? null : (
        <p className="mb-4 rounded-xl border border-[#e6ebf2] bg-white px-4 py-3 text-sm text-ink" role="status">
          Manager assignment and the one-step SLA move are not stored yet. The queue still follows the complaint rules. Apply the escalation assignment migration before those owners are recorded.
        </p>
      )}
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
        canManage={canApproveReplies(role)}
        query={query}
        page={page}
        totalPages={Math.max(1, Math.ceil(queue.total / PAGE_SIZE))}
      />
    </>
  );
}
