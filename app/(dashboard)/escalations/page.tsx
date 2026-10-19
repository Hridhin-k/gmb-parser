import { PageHeader } from "@/components/page-header";
import { EscalationBoard } from "@/components/escalation-board";
import { PendingRegion, TransitionScope } from "@/components/transition-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { formatInTimezone, slaClock } from "@/lib/escalations";
import { EscalationService } from "@/lib/services/escalations";
import { clampListScope } from "@/lib/access";
import { getMemberAccess } from "@/lib/services/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canApproveReplies, getWorkspaceRoster } from "@/lib/services/workspace";
import { validateFilterString, validatePage } from "@/lib/validation";

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
  const access = await getMemberAccess(user.id, workspaceId);

  const requested = typeof params.queue === "string" ? params.queue : "needs_human";
  const bucket = BUCKETS.includes(requested as (typeof BUCKETS)[number])
    ? (requested as (typeof BUCKETS)[number])
    : "needs_human";
  const clientId = validateFilterString(params.client) || null;
  const locationId = validateFilterString(params.location) || null;
  const groupId = validateFilterString(params.group) || null;
  const range = parseDateRange(params, "all");
  const page = validatePage(params.page);
  const bounded = clampListScope(
    { clientId: clientId ?? "", locationId: locationId ?? "", groupId: groupId ?? "" },
    access?.scope ?? { clientId: null, groupId: null, locationId: null }
  );
  const scope = {
    clientId: bounded.clientId || null,
    locationId: bounded.locationId || null,
    groupId: bounded.groupId || null,
    since: range.start?.toISOString() ?? null,
    until: range.end?.toISOString() ?? null,
  };

  await EscalationService.ensure(workspaceId);
  await EscalationService.processReminders(workspaceId);

  const [queue, counts, policy, pauses, scopes, roster] = await Promise.all([
    EscalationService.queue({ workspaceId, bucket, ...scope, page, pageSize: PAGE_SIZE }),
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
  })) {
    if (value) query.set(key, value);
  }

  return (
    <TransitionScope>
      <PageHeader
        title="Escalations"
        description="Complaints that need a person. Reminders are stored here. No email or text is sent. A published reply does not close the escalation."
      />
        <PendingRegion label="Updating escalations…">
        <div className="mt-6">
          <EscalationBoard
            bucket={bucket}
            counts={counts}
            items={stampQueue(queue.items, policy.timezone)}
            policy={policy}
            pauses={pauses}
            clients={scopes.clients}
            locations={scopes.locations}
            members={roster.members.map((member) => ({ userId: member.userId, email: member.email }))}
            canManage={canApproveReplies(role)}
            query={query.toString()}
            page={page}
            totalPages={Math.max(1, Math.ceil(queue.total / PAGE_SIZE))}
          />
        </div>
      </PendingRegion>
    </TransitionScope>
  );
}
