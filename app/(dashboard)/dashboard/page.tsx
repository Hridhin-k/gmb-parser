import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AgencyHomeView } from "@/components/agency-home";
import { SectionLoading } from "@/components/section-loading";
import type { ResolvedScope } from "@/lib/scope";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange, type DateRange } from "@/lib/date-range";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { canOpenPath } from "@/lib/shell";
import { validateFilterString, validatePage } from "@/lib/validation";

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const role = await getActiveRole();
  if (!canOpenPath("/dashboard", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const resolved = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const query = validateFilterString(params.q);
  const page = validatePage(params.page);

  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="font-heading text-heading text-ink">All clients</h1>
          <SectionLoading page="clients" variant="rows" />
        </div>
      }
    >
      <AgencyHomeSection
        userId={user.id}
        workspaceId={workspaceId}
        role={role}
        resolved={resolved}
        range={range}
        query={query}
        page={page}
      />
    </Suspense>
  );
}

async function AgencyHomeSection({
  userId,
  workspaceId,
  role,
  resolved,
  range,
  query,
  page,
}: {
  userId: string;
  workspaceId: string;
  role: Awaited<ReturnType<typeof getActiveRole>>;
  resolved: ResolvedScope;
  range: DateRange;
  query: string;
  page: number;
}) {
  const clientId = resolved.clientId ?? "";
  const access = await getMemberAccess(userId, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const data = await getAgencyHome(workspaceId, {
    clientId,
    range,
    q: query,
    page,
    allowedClientIds,
    locationIds: resolved.locationIds,
  });

  return (
    <AgencyHomeView
      workspaceId={workspaceId}
      canSync={canSyncWorkspace(role)}
      data={data}
      clientId={clientId}
      rangeParams={dateRangeParams(range, AGENCY_DEFAULT_RANGE)}
      query={query}
    />
  );
}
