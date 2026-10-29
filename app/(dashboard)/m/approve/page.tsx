import { Suspense } from "react";
import { MobileApprovalView } from "@/components/mobile-approval";
import { SectionLoading } from "@/components/section-loading";
import { loadMobileApproval } from "@/lib/services/mobile-work";
import { getActiveWorkspace } from "@/lib/services/session";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MobileApprovalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);

  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-xl font-medium text-ink">Approve replies</h1>
          <SectionLoading page="reviews" variant="reviews" />
        </div>
      }
    >
      <MobileApprovalSection userId={user.id} workspaceId={workspaceId} params={params} />
    </Suspense>
  );
}

async function MobileApprovalSection({
  userId,
  workspaceId,
  params,
}: {
  userId: string;
  workspaceId: string;
  params: SearchParams;
}) {
  const data = await loadMobileApproval({
    workspaceId,
    userId,
    clientParam: first(params.client),
    groupParam: first(params.group),
    locationParam: first(params.location),
    skipParam: first(params.skip),
  });
  return <MobileApprovalView key={data.card?.reviewId ?? "empty"} data={data} />;
}
