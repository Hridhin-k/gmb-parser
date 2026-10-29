import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UsageBoard } from "@/components/usage-board";
import { SectionLoading } from "@/components/section-loading";
import type { ResolvedScope } from "@/lib/scope";
import { getAgencyHome } from "@/lib/services/agency-home";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange, type DateRange } from "@/lib/date-range";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { readPageScope } from "@/lib/services/scope-catalog";
import { canOpenPath } from "@/lib/shell";
import { validateFilterString } from "@/lib/validation";

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/usage", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const resolved = await readPageScope(user.id, workspaceId, params);
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const query = validateFilterString(params.q);

  return (
    <Suspense fallback={<SectionLoading page="clients" variant="rows" />}>
      <UsageSection userId={user.id} workspaceId={workspaceId} resolved={resolved} range={range} query={query} />
    </Suspense>
  );
}

async function UsageSection({
  userId,
  workspaceId,
  resolved,
  range,
  query,
}: {
  userId: string;
  workspaceId: string;
  resolved: ResolvedScope;
  range: DateRange;
  query: string;
}) {
  const access = await getMemberAccess(userId, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const data = await getAgencyHome(workspaceId, {
    clientId: resolved.clientId ?? "",
    range,
    q: query,
    page: 1,
    allowedClientIds,
    locationIds: resolved.locationIds,
  });
  const rangeParams = dateRangeParams(range, AGENCY_DEFAULT_RANGE);
  const exportParams = new URLSearchParams();
  if (resolved.clientId) exportParams.set("client", resolved.clientId);
  for (const [key, value] of Object.entries(rangeParams)) exportParams.set(key, value);
  if (query) exportParams.set("q", query);
  const exportHref = `/api/usage/export${exportParams.size ? `?${exportParams}` : ""}`;

  return <UsageBoard heading={data.usageHeading} rows={data.usage} exportHref={exportHref} />;
}
