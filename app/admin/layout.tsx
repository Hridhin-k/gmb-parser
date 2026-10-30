import { redirect } from "next/navigation";
import { PlatformAdminSidebar } from "@/components/platform-admin-sidebar";
import { getCurrentUser } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user)) redirect("/overview");
  return (
    <div className="flex min-h-dvh flex-col bg-paper lg:flex-row">
      <PlatformAdminSidebar email={user.email ?? "Platform admin"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden min-h-[52px] items-center gap-3 border-b border-line bg-white px-5 lg:flex">
          <span className="text-[13px] font-medium text-ink">RevuPilot platform</span>
          <span className="text-xs text-ink-3">Invite-only tenancy · changes here affect customer workspaces</span>
          <form action="/admin" method="get" role="search" className="ml-auto">
            <label htmlFor="admin-tenant-search" className="sr-only">Search tenants or owners</label>
            <input
              id="admin-tenant-search"
              name="q"
              type="search"
              placeholder="Search tenants or owner email…"
              className="h-8 w-80 rounded-md border border-line bg-paper px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-brand-line"
            />
          </form>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
