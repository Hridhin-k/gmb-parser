import { Suspense } from "react";
import { MobileOverviewView } from "@/components/mobile-overview";
import { SectionLoading } from "@/components/section-loading";
import { loadMobileOverview } from "@/lib/services/mobile-work";
import { getActiveWorkspace } from "@/lib/services/session";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MobileOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);

  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-xl font-medium text-ink">Overview</h1>
          <SectionLoading page="overview" variant="tiles" />
        </div>
      }
    >
      <MobileOverviewSection userId={user.id} workspaceId={workspaceId} params={params} />
    </Suspense>
  );
}

async function MobileOverviewSection({
  userId,
  workspaceId,
  params,
}: {
  userId: string;
  workspaceId: string;
  params: SearchParams;
}) {
  const data = await loadMobileOverview({
    workspaceId,
    userId,
    clientParam: first(params.client),
    groupParam: first(params.group),
    locationParam: first(params.location),
    rangeParam: first(params.range),
  });
  return <MobileOverviewView data={data} />;
}
