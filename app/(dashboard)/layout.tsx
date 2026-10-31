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
      <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <div className="w-full max-w-md rounded-xl border border-line bg-white p-8">
        <span className="inline-flex h-[22px] items-center rounded-sm bg-info-tint px-2 text-xs font-medium text-info">Maintenance</span>
        <h1 className="mt-3 text-lg font-semibold text-ink">RevuPilot is under maintenance</h1>
        <p className="mt-2 text-[13px] text-ink-3">{maintenance.message ?? "We're making improvements. Queued actions resume automatically afterwards. Please check back shortly."}</p>
        </div>
      </main>
    );
  }
  if (access && !access.enabled) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <div className="w-full max-w-md rounded-xl border border-line bg-white p-8">
          <span className="inline-flex h-[22px] items-center rounded-sm bg-bad-tint px-2 text-xs font-medium text-bad">Access disabled</span>
          <h1 className="mt-3 text-lg font-semibold text-ink">Your access to {chrome.workspaceName} is turned off</h1>
          <p className="mt-2 text-[13px] text-ink-3">
            A workspace admin has to turn your access back on before you can open this workspace. Your history is kept.
          </p>
          <a href="/login" className="mt-4 inline-flex h-[34px] items-center rounded-md border border-line px-3 text-[13px] font-medium text-ink hover:bg-paper">
            Use a different account
          </a>
        </div>
      </main>
    );
  }
  const path = (await headers()).get("x-grm-path") ?? "";
  if (path && !canOpenPath(path, role)) redirect(homePath(role));

  return (
    <>
      {chrome.localDemo ? (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f59e0b] bg-demo px-4 py-2 text-[13px] text-demo-ink" role="status">
          <span className="inline-flex h-[22px] items-center rounded-sm border border-dashed border-[#f59e0b] px-2 text-xs font-semibold">Demo workspace</span>
          <span>Start empty and add sample data during setup. Google sync and publishing are off; AI actions use your configured provider.</span>
        </div>
      ) : null}
      {supportTenantId ? (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f59e0b] bg-[#fde68a] px-4 py-2 text-[13px] font-medium text-demo-ink" role="status">
          <span className="inline-flex h-[22px] items-center rounded-sm bg-white/60 px-2 text-xs font-semibold">Read-only support view</span>
          <span className="min-w-0 flex-1">You are viewing <strong>{chrome.workspaceName}</strong> as platform support. Every action is disabled and page views are logged.</span>
          <ExitSupportButton />
        </div>
      ) : null}
      {announcement ? (
        <div className={`border-b px-4 py-2 text-[13px] ${announcement.tone === "warning" ? "border-warn-line bg-warn-tint text-[#7c3a06]" : "border-info-line bg-info-tint text-[#0b5a6f]"}`} role="status">
          <strong className="font-semibold">{announcement.title}</strong> {announcement.body}
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
