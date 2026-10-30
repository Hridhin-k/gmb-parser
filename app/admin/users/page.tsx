import { PlatformUsersBoard } from "@/components/platform-users-board";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        description={`${data ? `${data.total.toLocaleString("en-US")} sign-in identities across all tenants. ` : ""}A user can belong to several workspaces. Blocking is platform-wide and separate from a tenant turning off someone's access.`}
      />
      {failure || !data ? (
        <Banner tone="bad" title="Users could not be loaded.">{failure ?? null}</Banner>
      ) : (
        <PlatformUsersBoard users={data.users} blocked={data.blocked} initialQuery={q} total={data.total} page={data.page} pageSize={data.pageSize} />
      )}
    </div>
  );
}
