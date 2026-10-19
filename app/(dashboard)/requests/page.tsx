import Link from "next/link";
import { Link2 } from "lucide-react";
import { CopyReviewLink } from "@/components/copy-review-link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RequestBoard } from "@/components/request-board";
import { ensureLocationQr, loadRequestBoard, type QrSummary } from "@/lib/services/request-campaigns";
import { listReviewRequestLocations } from "@/lib/services/review-requests";
import { getMemberAccess } from "@/lib/services/access";
import { clampListScope } from "@/lib/access";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { isManager } from "@/lib/shell";
import { validateFilterString } from "@/lib/validation";

interface RequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const [params, { user, workspaceId }, role] = await Promise.all([searchParams, getActiveWorkspace(), getActiveRole()]);
  const clientParam = validateFilterString(params.client);
  const access = await getMemberAccess(user.id, workspaceId);
  const bounded = clampListScope(
    { clientId: UUID.test(clientParam) ? clientParam : "", groupId: "", locationId: "" },
    access?.scope ?? { clientId: null, groupId: null, locationId: null }
  );
  const clientId = bounded.clientId;
  const campaignParam = validateFilterString(params.campaign);
  const locations = await listReviewRequestLocations(workspaceId, clientId || null, {
    locationId: bounded.locationId || null,
    groupId: bounded.groupId || null,
  });
  if (locations.length > 0) await ensureLocationQr(workspaceId, locations.map((location) => location.id));
  const board = await loadRequestBoard(workspaceId);
  const locationIds = new Set(locations.map((location) => location.id));
  const campaigns = clientId || bounded.locationId || bounded.groupId
    ? board.campaigns.filter((campaign) => campaign.locationIds.some((id) => locationIds.has(id)))
    : board.campaigns;
  const qrByLocation: Record<string, QrSummary> = {};
  for (const location of locations) {
    const qr = board.qrByLocation.get(location.id);
    if (qr) qrByLocation[location.id] = qr;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review requests"
        description="Ask customers to review a location, or to send a private note. Both choices are on the same page. WhatsApp, SMS, and email send only when that provider is configured."
      />

      {locations.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={clientId ? "No locations for this client" : "No locations yet"}
          description={
            clientId
              ? "Choose all clients in the header, or sync this client’s Google profiles."
              : "Connect Google and sync profiles. Each location can then have a request page and a QR code."
          }
        >
          <Link href="/clients" className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-graphite">
            Open locations
          </Link>
        </EmptyState>
      ) : (
        <RequestBoard
          canManage={isManager(role)}
          channels={board.channels}
          metrics={board.metrics}
          campaigns={campaigns}
          locations={locations.map((location) => ({
            id: location.id,
            name: location.name,
            storeCode: location.storeCode,
            url: location.url,
          }))}
          qrByLocation={qrByLocation}
          policyDays={board.policyDays}
          reviewId={UUID.test(campaignParam) ? campaignParam : null}
          clientId={clientId}
        />
      )}

      {locations.some((location) => location.url) ? (
        <section className="rounded-xl bg-white p-4 shadow-card sm:p-5">
          <h2 className="text-sm font-semibold text-graphite">Google review links</h2>
          <p className="mt-1 text-sm text-slate">These open Google’s review form directly. They do not record a visit in GRM.</p>
          <ul className="mt-3 divide-y divide-silver">
            {locations.filter((location) => location.url).map((location) => (
              <li key={location.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="truncate text-sm font-medium text-graphite">{location.name}</p>
                {location.url ? <CopyReviewLink url={location.url} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
