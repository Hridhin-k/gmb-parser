import Link from "next/link";
import { ExportUsageButton } from "@/components/export-usage-button";
import { SettingsDetail, SettingsSection, SettingsValueRow } from "@/components/settings-section";
import { Banner } from "@/components/ui/banner";
import { AGENCY_DEFAULT_RANGE, dateRangeParams, parseDateRange } from "@/lib/date-range";
import { getMemberAccess, visibleClientIds } from "@/lib/services/access";
import { getAgencyHome } from "@/lib/services/agency-home";
import { readPageScope } from "@/lib/services/scope-catalog";

type Params = Record<string, string | string[] | undefined>;

function n(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Settings › Plan and usage. Was /portfolio/usage: the counts per business that the
 * invoice export contains, for the scope and period in the URL. No price is calculated.
 */
export async function UsageSection({ params, userId, workspaceId }: { params: Params; userId: string; workspaceId: string }) {
  const resolved = await readPageScope(userId, workspaceId, params);
  const clientId = resolved.clientId ?? "";
  const range = parseDateRange(params, AGENCY_DEFAULT_RANGE);
  const access = await getMemberAccess(userId, workspaceId);
  const allowedClientIds = await visibleClientIds(workspaceId, access?.scope);
  const data = await getAgencyHome(workspaceId, {
    clientId,
    range,
    q: "",
    page: 1,
    allowedClientIds,
    locationIds: resolved.locationIds,
  });
  const rangeParams = dateRangeParams(range, AGENCY_DEFAULT_RANGE);
  const exportParams = new URLSearchParams(rangeParams);
  if (clientId) exportParams.set("client", clientId);
  const exportHref = `/api/usage/export${exportParams.size ? `?${exportParams}` : ""}`;
  const totals = data.usage.reduce(
    (sum, row) => ({
      locations: sum.locations + row.locations,
      reviews: sum.reviews + row.reviews,
      published: sum.published + row.publishedReplies,
      events: sum.events + row.recordedEvents,
    }),
    { locations: 0, reviews: 0, published: 0, events: 0 }
  );

  return (
    <>
      <SettingsSection
        title="Plan and usage"
        description={`What this workspace is counted on. ${range.label ?? data.usageHeading}.`}
        aside={<ExportUsageButton href={exportHref} variant="outline" />}
      >
        <SettingsValueRow
          label="Plan"
          hint="Usage is counted from locations and reviews. There is no separate checkout in this workspace."
          value="Counted by usage"
        />
        <SettingsValueRow label="Locations" hint="Google profiles assigned to your businesses." value={n(totals.locations)} action={{ label: "Details", href: "/locations" }} />
        <SettingsValueRow label="Reviews stored" hint={data.usageHeading} value={n(totals.reviews)} />
        <SettingsValueRow label="Replies published" hint={data.usageHeading} value={n(totals.published)} />
        <SettingsValueRow label="Recorded events" hint="Activity logged for each business." value={n(totals.events)} />
      </SettingsSection>

      <SettingsDetail id="usage-detail" title="Usage by business">
        {data.usage.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-6 text-center text-[13px] text-ink-3">
            No usage in this period. Pick a longer period or another place.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="bg-[#fafbfc] text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Business</th>
                  <th className="px-3 py-2 text-right font-medium">Locations</th>
                  <th className="px-3 py-2 text-right font-medium">Reviews stored</th>
                  <th className="px-3 py-2 text-right font-medium">Replies published</th>
                  <th className="px-4 py-2 text-right font-medium">Recorded events</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((row) => (
                  <tr key={row.id} className="border-b border-line-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/businesses/${row.id}`} className="font-semibold text-ink hover:text-brand">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{n(row.locations)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{n(row.reviews)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{n(row.publishedReplies)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{n(row.recordedEvents)}</td>
                  </tr>
                ))}
                <tr className="bg-[#fafbfc] font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.locations)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.reviews)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{n(totals.published)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{n(totals.events)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <Banner tone="neutral" title="Coming soon.">
          Invoices, payment methods and AI budget caps aren&apos;t managed here yet. The counts above are what the invoice export
          contains.
        </Banner>
      </SettingsDetail>
    </>
  );
}
