import { MobileOverviewView } from "@/components/mobile-overview";
import { loadMobileOverview } from "@/lib/services/mobile-work";
import { getActiveWorkspace } from "@/lib/services/session";

export default async function MobileOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const data = await loadMobileOverview({
    workspaceId,
    userId: user.id,
    clientParam: Array.isArray(params.client) ? params.client[0] : params.client,
    groupParam: Array.isArray(params.group) ? params.group[0] : params.group,
    locationParam: Array.isArray(params.location) ? params.location[0] : params.location,
    rangeParam: Array.isArray(params.range) ? params.range[0] : params.range,
  });
  return <MobileOverviewView data={data} />;
}
