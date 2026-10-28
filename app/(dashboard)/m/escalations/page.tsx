import { Suspense } from "react";
import { MobileComplaintView } from "@/components/mobile-complaint";
import { SectionLoading } from "@/components/section-loading";
import { draftsWithAiOnly } from "@/lib/access";
import { loadMobileComplaint } from "@/lib/services/mobile-work";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MobileEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, { user, workspaceId }, role] = await Promise.all([
    searchParams,
    getActiveWorkspace(),
    getActiveRole(),
  ]);

  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-xl font-medium text-ink">Needs your reply</h1>
          <SectionLoading page="escalations" variant="panel" />
        </div>
      }
    >
      <MobileComplaintSection userId={user.id} workspaceId={workspaceId} role={role} params={params} />
    </Suspense>
  );
}

async function MobileComplaintSection({
  userId,
  workspaceId,
  role,
  params,
}: {
  userId: string;
  workspaceId: string;
  role: Awaited<ReturnType<typeof getActiveRole>>;
  params: SearchParams;
}) {
  const data = await loadMobileComplaint({
    workspaceId,
    userId,
    clientParam: first(params.client),
    groupParam: first(params.group),
    locationParam: first(params.location),
    idParam: first(params.id),
  });
  return <MobileComplaintView key={data.card?.id ?? "empty"} data={data} aiOnly={draftsWithAiOnly(role)} />;
}
