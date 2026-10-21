import { PlatformUsersBoard } from "@/components/platform-users-board";
import { getCurrentUser } from "@/lib/services/session";
import { listGlobalUsers } from "@/lib/services/platform";
import { toUserMessage } from "@/lib/errors";
import { validatePage } from "@/lib/validation";

interface PageProps { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function PlatformUsersPage({ searchParams }: PageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const q = typeof params.q === "string" ? params.q : "";
  const page = validatePage(params.page);
  let data: Awaited<ReturnType<typeof listGlobalUsers>> | null = null;
  let failure: string | null = null;
  try {
    data = await listGlobalUsers(user!, q, page);
  } catch (error) {
    failure = toUserMessage(error);
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Users</h1>
        <p className="mt-1 text-sm font-light text-slate">Every auth user across tenants, paged from the auth service. Blocking is platform-wide by email and is checked at login — memberships and data are kept.</p>
      </div>
      {failure || !data ? (
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-graphite" role="alert">{failure ?? "Users could not be loaded."}</p>
      ) : (
        <>
          {data.blocked.length > 0 ? <p className="text-sm text-slate">Currently blocked: {data.blocked.map((b) => b.email).join(", ")}</p> : null}
          <PlatformUsersBoard users={data.users} initialQuery={q} total={data.total} page={data.page} pageSize={data.pageSize} />
        </>
      )}
    </div>
  );
}
