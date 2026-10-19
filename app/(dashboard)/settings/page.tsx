import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { allows, workspaceGrant } from "@/lib/access";
import { authMethodsFromEnv } from "@/lib/auth-methods";
import { SettingsBoard } from "@/components/settings-board";
import { AiConfigPanel } from "@/components/ai-config-panel";
import { GoogleConnectionCard } from "@/components/google-connection-card";
import { PageHeader } from "@/components/page-header";
import { EscalationService } from "@/lib/services/escalations";
import { listScopeChoices } from "@/lib/services/access";
import { getMemberAccess } from "@/lib/services/access";
import { loadReplySettings, type SettingsTarget } from "@/lib/services/reply-settings";
import { loadAiBoard } from "@/lib/services/ai-config";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canOpenPath } from "@/lib/shell";
import { visibleClientIds } from "@/lib/services/access";
import { loadAgencyBranding } from "@/lib/services/agency-branding";
import { domainStatus, senderStatus } from "@/lib/agency-portal";
import { BrandingForm } from "@/components/branding-form";
import type { AiKnowledgeKind } from "@/lib/ai-config";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You denied access to your Google account. You can try again when ready.",
  auth_failed: "Google authorization failed. Please try again.",
  unknown: "An unexpected error occurred. Please try again.",
};

const SECTIONS = [
  ["tone", "AI configuration"],
  ["templates", "Templates"],
  ["sla", "SLAs and routing"],
  ["notifications", "Notifications"],
  ["integrations", "Integrations"],
  ["branding", "Branding"],
  ["plan", "Plan and billing"],
  ["security", "Security"],
] as const;

function parseTarget(raw: string | undefined): SettingsTarget {
  if (!raw || raw === "workspace") return { kind: "workspace" };
  const [kind, id] = raw.split(":");
  if ((kind === "client" || kind === "group" || kind === "location") && id && /^[0-9a-f-]{36}$/i.test(id)) {
    return { kind, id };
  }
  return { kind: "workspace" };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await getActiveRole();
  if (!canOpenPath("/settings", role)) redirect("/overview");

  const [params, { user, workspaceId }] = await Promise.all([searchParams, getActiveWorkspace()]);
  const requested = typeof params.section === "string" ? params.section : "tone";
  const canBill = allows(role, "manage_people");
  const section = SECTIONS.some(([id]) => id === requested) ? requested : "tone";
  if ((section === "plan" || section === "branding") && !canBill) redirect("/settings?section=tone");
  const target = parseTarget(typeof params.scope === "string" ? params.scope : undefined);
  const access = await getMemberAccess(user.id, workspaceId);
  const canEditWorkspace = workspaceGrant(role, "edit_rules");
  const canEdit = target.kind === "workspace" ? canEditWorkspace : Boolean(access?.enabled && allows(role, "edit_rules"));

  const allowedClients = await visibleClientIds(workspaceId, access?.scope);
  if (target.kind === "client" && allowedClients && !allowedClients.includes(target.id)) {
    redirect("/settings?section=tone");
  }
  if (allowedClients && target.kind === "location") {
    const place = await createAdminClient()
      .from("grm_google_locations")
      .select("client_id")
      .eq("workspace_id", workspaceId)
      .eq("id", target.id)
      .maybeSingle();
    if (!place.data?.client_id || !allowedClients.includes(place.data.client_id)) {
      redirect("/settings?section=tone");
    }
  }
  if (allowedClients && target.kind === "group") {
    const group = await createAdminClient()
      .from("grm_groups")
      .select("client_id, brand_id")
      .eq("workspace_id", workspaceId)
      .eq("id", target.id)
      .maybeSingle();
    const groupClient = group.data?.client_id || group.data?.brand_id;
    if (!groupClient || !allowedClients.includes(groupClient)) {
      redirect("/settings?section=tone");
    }
  }
  const [settings, scopes, policy, connections, branding, aiBoard] = await Promise.all([
    loadReplySettings(workspaceId, target),
    listScopeChoices(workspaceId),
    EscalationService.policy(workspaceId),
    createAdminClient()
      .from("grm_google_connections")
      .select("id, google_email, status, created_at, last_refreshed_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked")
      .order("created_at", { ascending: false }),
    canBill ? loadAgencyBranding(workspaceId) : Promise.resolve(null),
    section === "tone" ? loadAiBoard(workspaceId, user.id) : Promise.resolve(null),
  ]);

  const googleError = typeof params.google_error === "string" ? params.google_error : null;
  const methods = authMethodsFromEnv();
  const emailDelivery = Boolean(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL);
  const scopeQuery = target.kind === "workspace" ? "" : `&scope=${target.kind}:${target.id}`;
  const visibleScopes = allowedClients
    ? scopes.filter((choice) => choice.kind === "client" && allowedClients.includes(choice.id))
    : scopes;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Editing for ${settings.label}. Applies to ${settings.appliesTo}.`}
      />
      <div className="flex flex-wrap gap-2">
        <Link href={`/settings?section=${section}`} className={`rounded-full border px-3 py-1 text-sm ${target.kind === "workspace" ? "border-ink bg-ink text-white" : "border-silver text-graphite"}`}>
          Organization
        </Link>
        {visibleScopes.slice(0, 12).map((scope) => {
          const active = target.kind === scope.kind && "id" in target && target.id === scope.id;
          return (
            <Link key={scope.id} href={`/settings?section=${section}&scope=${scope.kind}:${scope.id}`} className={`rounded-full border px-3 py-1 text-sm ${active ? "border-ink bg-ink text-white" : "border-silver text-graphite"}`}>
              {scope.label}
            </Link>
          );
        })}
      </div>
      <nav className="flex flex-wrap gap-2 border-b border-silver pb-3">
        {SECTIONS.filter(([id]) => (id !== "plan" && id !== "branding") || canBill).map(([id, label]) => (
          <Link key={id} href={`/settings?section=${id}${scopeQuery}`} className={`rounded-full px-3 py-1 text-sm ${section === id ? "bg-ink text-white" : "text-graphite"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {section === "tone" && aiBoard ? (
        <div className="space-y-8">
          <AiConfigPanel
            canEdit={canEdit}
            target={target}
            active={{
              version: aiBoard.active.version,
              label: aiBoard.active.label,
              snapshot: {
                org: aiBoard.active.snapshot.org,
                insights: aiBoard.active.snapshot.insights,
              },
            }}
            versions={aiBoard.versions.map((row) => ({
              version: row.version,
              status: row.status,
              label: row.label,
              createdAt: row.createdAt,
            }))}
            knowledge={aiBoard.knowledge
              .filter((row) => {
                if (target.kind === "workspace") {
                  return !row.clientId && !row.groupId && !row.locationId;
                }
                if (target.kind === "client") return row.clientId === target.id;
                if (target.kind === "group") return row.groupId === target.id;
                return row.locationId === target.id;
              })
              .map((row) => ({
                id: row.id,
                kind: row.kind as AiKnowledgeKind,
                title: row.title,
                body: row.body,
                enabled: row.enabled,
                clientId: row.clientId,
                groupId: row.groupId,
                locationId: row.locationId,
                metadata: row.metadata,
              }))}
          />
          <SettingsBoard
            section="tone"
            target={target}
            canEdit={canEdit}
            tone={settings.tone}
            automation={settings.automation}
            templates={settings.templates}
          />
        </div>
      ) : null}

      {section === "templates" ? (
        <SettingsBoard
          section="templates"
          target={target}
          canEdit={canEdit}
          tone={settings.tone}
          automation={settings.automation}
          templates={settings.templates}
        />
      ) : null}

      {section === "sla" ? (
        <section className="space-y-3 rounded-xl border border-silver bg-white p-4 text-sm text-graphite">
          <p>Complaints at {policy.maxStars} stars or below open an escalation. The due time is {policy.dueHours} hours in {policy.timezone}.</p>
          <p>Reminders are recorded in the app at {policy.reminderHours.join(" and ")} hours. No email or text is sent.</p>
          <p>Brand, group, and location SLA overrides stay on Locations and groups. A nearer override replaces this organization rule.</p>
          <Link href="/escalations" className="font-medium text-ink underline underline-offset-4">Open escalations</Link>
        </section>
      ) : null}

      {section === "notifications" ? (
        <section className="space-y-2 rounded-xl border border-silver bg-white p-4 text-sm text-slate">
          <p>In-app alerts are on for people in this workspace.</p>
          <p>{emailDelivery ? "Email delivery is configured." : "Email preferences can be saved on Team and roles. Mail is not delivered until a mail provider is configured."}</p>
          <p>WhatsApp and Slack are not configured.</p>
          {canOpenPath("/team", role) ? (
            <Link href="/team" className="font-medium text-ink underline underline-offset-4">Notification preferences</Link>
          ) : (
            <p>Your own alert preferences are on Team and roles when that page is available for your role.</p>
          )}
        </section>
      ) : null}

      {section === "integrations" ? (
        <GoogleConnectionCard
          connections={(connections.data ?? []).map((connection) => ({ ...connection, status: connection.status as string }))}
          initialMessage={googleError ? ERROR_MESSAGES[googleError] ?? ERROR_MESSAGES.unknown : null}
          initialSuccess={params.google_connected === "true"}
        />
      ) : null}

      {section === "branding" && canBill && branding ? (
        <BrandingForm
          logoUrl={branding.logoUrl ?? ""}
          hideProductName={branding.hideProductName}
          customDomain={branding.customDomain ?? ""}
          domainToken={branding.domainToken}
          domainLabel={domainStatus({ domain: branding.customDomain, verifiedAt: branding.domainVerifiedAt }).label}
          domainActive={domainStatus({ domain: branding.customDomain, verifiedAt: branding.domainVerifiedAt }).active}
          senderEmail={branding.senderEmail ?? ""}
          senderLabel={senderStatus({
            email: branding.senderEmail,
            mailConfigured: emailDelivery,
            configuredFrom: process.env.REPORT_FROM_EMAIL ?? null,
          }).label}
          senderActive={senderStatus({
            email: branding.senderEmail,
            mailConfigured: emailDelivery,
            configuredFrom: process.env.REPORT_FROM_EMAIL ?? null,
          }).active}
        />
      ) : null}

      {section === "plan" && canBill ? (
        <section className="space-y-2 rounded-xl border border-silver bg-white p-4 text-sm text-slate">
          <p>Usage is counted from locations and reviews. There is no separate checkout in this workspace.</p>
          <Link href="/dashboard#usage" className="font-medium text-ink underline underline-offset-4">Open usage</Link>
        </section>
      ) : null}

      {section === "security" ? (
        <section className="space-y-2 rounded-xl border border-silver bg-white p-4 text-sm text-slate">
          <p>Sign-in methods turned on for this app:</p>
          <ul className="space-y-1">
            {methods.map((method) => (
              <li key={method.id}>{method.label}</li>
            ))}
          </ul>
        </section>
      ) : null}

    </div>
  );
}
