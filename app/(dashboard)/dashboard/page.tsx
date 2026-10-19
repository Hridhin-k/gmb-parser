import { redirect } from "next/navigation";
import { AgencyHomeView } from "@/components/agency-home";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace, getWorkspaceRoster } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { isOrgScope, workspaceGrant } from "@/lib/access";
import { canOpenPath } from "@/lib/shell";
import { validateFilterString, validatePage } from "@/lib/validation";

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const role = await getActiveRole();
  if (!canOpenPath("/dashboard", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const clientParam = validateFilterString(params.client);
  const clientId = UUID.test(clientParam) ? clientParam : "";
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const query = validateFilterString(params.q);
  const page = validatePage(params.page);

  const access = await getMemberAccess(user.id, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const canAddClient = Boolean(access?.enabled && isOrgScope(access.scope) && workspaceGrant(role, "manage_locations"));
  const [data, roster] = await Promise.all([
    getAgencyHome(workspaceId, {
      clientId,
      range,
      q: query,
      page,
      allowedClientIds,
    }),
    canAddClient ? getWorkspaceRoster(workspaceId) : Promise.resolve(null),
  ]);

  return (
    <AgencyHomeView
      workspaceId={workspaceId}
      canSync={canSyncWorkspace(role)}
      data={data}
      clientId={clientId}
      rangeParams={dateRangeParams(range, AGENCY_DEFAULT_RANGE)}
      query={query}
      showUsage={workspaceGrant(role, "manage_people")}
      canAddClient={canAddClient}
      managers={(roster?.members ?? [])
        .filter((member) => member.accessEnabled)
        .map((member) => ({ id: member.userId, email: member.email }))}
    />
  );
}
