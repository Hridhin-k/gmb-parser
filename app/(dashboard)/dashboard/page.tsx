import { redirect } from "next/navigation";
import { AgencyHomeView } from "@/components/agency-home";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { workspaceGrant } from "@/lib/access";
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
  const clientId = resolved.clientId ?? "";
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const query = validateFilterString(params.q);
  const page = validatePage(params.page);

  const access = await getMemberAccess(user.id, workspaceId);
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
      showUsage={workspaceGrant(role, "manage_people")}
    />
  );
}
