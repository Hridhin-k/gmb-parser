import { AppShell } from "@/components/app-shell";
import { ExitSupportButton } from "@/components/exit-support-button";
import { loadDashboardChrome } from "@/lib/services/dashboard-chrome";
import { isSuperAdmin } from "@/lib/services/platform";
import { timed } from "@/lib/timing";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { canOpenPath, homePath } from "@/lib/shell";

export async function generateMetadata(): Promise<Metadata> {
  const chrome = await loadDashboardChrome();
  const name = chrome.workspaceName;
  if (chrome.branding.hideProductName) return { title: name };
  return { title: "RevuPilot — Google review management" };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const chrome = await timed("layout.chrome", () => loadDashboardChrome());
  const { user, workspaceId, role, access, maintenance, announcement, supportTenantId } = chrome;
  if (maintenance.enabled && !isSuperAdmin(user)) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-medium text-graphite">RevuPilot is under maintenance</h1>
        <p className="mt-3 text-sm text-slate">{maintenance.message ?? "We're making improvements. Please check back shortly."}</p>
      </main>
    );
  }
  if (access && !access.enabled) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-medium text-graphite">Access is turned off</h1>
        <p className="mt-3 text-sm text-slate">
          An organization admin has to turn your access back on before you can open this workspace.
        </p>
      </main>
    );
  }
  const path = (await headers()).get("x-grm-path") ?? "";
  if (path && !canOpenPath(path, role)) redirect(homePath(role));

  return (
    <>
      {chrome.localDemo ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950" role="status">
          <strong>Local demo · sample reviews.</strong> Google sync and publishing are disabled. AI drafts and analysis use your configured provider.
        </div>
      ) : null}
      {supportTenantId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
          <span>Support view (read-only) — you are viewing <strong>{chrome.workspaceName}</strong> as a super admin. Changes are blocked.</span>
          <ExitSupportButton />
        </div>
      ) : null}
      {announcement ? (
        <div className={`px-4 py-2 text-sm ${announcement.tone === "warning" ? "bg-amber-100 text-amber-900" : "bg-paper text-graphite"}`}>
          <strong>{announcement.title}</strong> — {announcement.body}
        </div>
      ) : null}
    <AppShell
      user={user}
      role={role}
      workspaceName={chrome.workspaceName}
      workspaces={chrome.workspaces}
      activeWorkspaceId={workspaceId}
      clients={chrome.clients}
      catalog={chrome.catalog}
      summary={chrome.summary}
      logoUrl={chrome.branding.logoUrl}
      productTitle={chrome.branding.hideProductName ? chrome.workspaceName : "RevuPilot"}
    >
      {children}
    </AppShell>
    </>
  );
}
