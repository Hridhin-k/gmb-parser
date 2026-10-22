import { PlatformAdminBoard } from "@/components/platform-admin-board";
import { getCurrentUser } from "@/lib/services/session";
import { loadPlatformOverview } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";
import { validatePage } from "@/lib/validation";

interface PageProps { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function AdminPage({ searchParams }: PageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const q = typeof params.q === "string" ? params.q : "";
  const page = validatePage(params.page);
  const invitePage = validatePage(params.ipage);
  // Layout already gated; user is present and a super admin here.
  let overview: Awaited<ReturnType<typeof loadPlatformOverview>> | null = null;
  let failure: string | null = null;
  try {
    overview = await loadPlatformOverview(user!, { query: q, page, invitePage });
  } catch (error) {
    failure = toUserMessage(error);
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Platform dashboard</h1>
        <p className="mt-1 text-sm font-light text-slate">Manage SaaS tenants. Only invited tenant owners can create a workspace; suspended and deleted tenants are blocked at sign-in.</p>
      </div>
      {failure || !overview ? (
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite" role="alert">
          {failure ?? "Platform data could not be loaded."} Apply migration <code>20261022001_platform_invite_only.sql</code> if this is a new database.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Tenants", overview.stats.tenants],
              ["Active", overview.stats.active],
              ["Suspended", overview.stats.suspended],
              ["Deleted", overview.stats.deleted],
              ["Pending invites", overview.stats.pendingInvites],
              ["Reviews", overview.stats.reviews.toLocaleString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-silver bg-white px-4 py-3">
                <p className="text-2xl font-medium text-graphite">{value}</p>
                <p className="text-xs text-slate">{label}</p>
              </div>
            ))}
          </div>
          <PlatformAdminBoard
            invites={overview.invites}
            inviteTotal={overview.inviteTotal}
            invitePage={overview.invitePage}
            invitePageSize={overview.invitePageSize}
            tenants={overview.tenants}
            tenantTotal={overview.tenantTotal}
            page={overview.page}
            pageSize={overview.pageSize}
            initialQuery={q}
          />
        </>
      )}
    </div>
  );
}
