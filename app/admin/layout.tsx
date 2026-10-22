import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/services/session";
import { isSuperAdmin } from "@/lib/services/platform";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user)) redirect("/overview");
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">G</div>
            <div>
              <p className="text-sm font-medium text-graphite">RevuPilot Platform</p>
              <p className="text-xs text-slate">Super admin · invite-only tenancy</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate sm:inline">{user.email}</span>
            <Link href="/admin" className="text-ink underline underline-offset-4">Tenants</Link>
            <Link href="/admin/health" className="text-ink underline underline-offset-4">Health</Link>
            <Link href="/admin/users" className="text-ink underline underline-offset-4">Users</Link>
            <Link href="/admin/ops" className="text-ink underline underline-offset-4">Ops</Link>
            <a href="/api/auth/signout" className="text-ink underline underline-offset-4">Sign out</a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
