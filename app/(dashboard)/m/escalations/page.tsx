import { MobileComplaintView } from "@/components/mobile-complaint";
import { loadMobileComplaint } from "@/lib/services/mobile-work";
import { getActiveWorkspace } from "@/lib/services/session";

export default async function MobileEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const data = await loadMobileComplaint({
    workspaceId,
    userId: user.id,
    clientParam: Array.isArray(params.client) ? params.client[0] : params.client,
    locationParam: Array.isArray(params.location) ? params.location[0] : params.location,
    idParam: Array.isArray(params.id) ? params.id[0] : params.id,
  });
  return <MobileComplaintView key={data.card?.id ?? "empty"} data={data} />;
}
