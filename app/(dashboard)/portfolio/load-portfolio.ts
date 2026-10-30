import { redirect } from "next/navigation";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canSyncWorkspace } from "@/lib/services/workspace";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { workspaceGrant } from "@/lib/access";
import { canOpenPath } from "@/lib/shell";
import { validateFilterString, validatePage } from "@/lib/validation";

export type PortfolioSearchParams = Record<string, string | string[] | undefined>;

/**
 * Shared loader for the Portfolio tabs (Businesses and Usage & budgets).
 * Same role check, scope, access filter and agency-home call for both tabs.
 */
export async function loadPortfolio(searchParams: Promise<PortfolioSearchParams>, path: "/portfolio" | "/portfolio/usage") {
  const role = await getActiveRole();
  if (!canOpenPath(path, role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);

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

  return {
    workspaceId,
    canSync: canSyncWorkspace(role),
    data,
    clientId,
    rangeLabel: range.label,
    rangeParams: dateRangeParams(range, AGENCY_DEFAULT_RANGE),
    query,
    showUsage: workspaceGrant(role, "manage_people"),
  };
}
