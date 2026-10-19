import { MobileApprovalView } from "@/components/mobile-approval";
import { loadMobileApproval } from "@/lib/services/mobile-work";
import { getActiveWorkspace } from "@/lib/services/session";

export default async function MobileApprovalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const data = await loadMobileApproval({
    workspaceId,
    userId: user.id,
    clientParam: Array.isArray(params.client) ? params.client[0] : params.client,
    groupParam: Array.isArray(params.group) ? params.group[0] : params.group,
    locationParam: Array.isArray(params.location) ? params.location[0] : params.location,
    skipParam: Array.isArray(params.skip) ? params.skip[0] : params.skip,
  });
  return <MobileApprovalView key={data.card?.reviewId ?? "empty"} data={data} />;
}
