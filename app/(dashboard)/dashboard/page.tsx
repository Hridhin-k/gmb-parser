import { AgencyHomeView } from "@/components/agency-home";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getActiveWorkspace } from "@/lib/services/session";
import { validateFilterString, validatePage } from "@/lib/validation";

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [params, { workspaceId }] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
  ]);

  const clientParam = validateFilterString(params.client);
  const clientId = UUID.test(clientParam) ? clientParam : "";
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const query = validateFilterString(params.q);
  const page = validatePage(params.page);

  const data = await getAgencyHome(workspaceId, {
    clientId,
    range,
    q: query,
    page,
  });

  return (
    <AgencyHomeView
      workspaceId={workspaceId}
      data={data}
      clientId={clientId}
      rangeParams={dateRangeParams(range, AGENCY_DEFAULT_RANGE)}
      query={query}
    />
  );
}
