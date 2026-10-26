import { MobileComplaintView } from "@/components/mobile-complaint";
import { draftsWithAiOnly } from "@/lib/access";
import { loadMobileComplaint } from "@/lib/services/mobile-work";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";

export default async function MobileEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);
  const data = await loadMobileComplaint({
    workspaceId,
    userId: user.id,
    clientParam: Array.isArray(params.client) ? params.client[0] : params.client,
    groupParam: Array.isArray(params.group) ? params.group[0] : params.group,
    locationParam: Array.isArray(params.location) ? params.location[0] : params.location,
    idParam: Array.isArray(params.id) ? params.id[0] : params.id,
  });
  return <MobileComplaintView key={data.card?.id ?? "empty"} data={data} aiOnly={draftsWithAiOnly(role)} />;
}
