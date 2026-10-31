import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db/client";
import { allows, workspaceGrant } from "@/lib/access";
import { authMethodsFromEnv } from "@/lib/auth-methods";
import { FollowUpSettings } from "@/components/follow-up-settings";
import { SettingsBoard } from "@/components/settings-board";
import { AiConfigPanel } from "@/components/ai-config-panel";
import { GoogleConnectionCard } from "@/components/google-connection-card";
import { PageHeader } from "@/components/page-header";
import { SettingsNav, type SettingsNavItem } from "@/components/settings-nav";
import { SettingsScopePicker } from "@/components/settings-scope-picker";
import { SettingsAiTabs } from "@/components/settings-ai-tabs";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { EscalationContactStore, EscalationService } from "@/lib/services/escalations";
import { ResolutionContactForm } from "@/components/resolution-contact-form";
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
  ["templates", "Reply templates"],
  ["sla", "Customer follow-ups"],
  ["notifications", "Notifications"],
  ["integrations", "Google integrations"],
  ["branding", "Agency branding"],
  ["plan", "Plan and usage"],
  ["security", "Security"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

const SECTION_GROUP: Record<SectionId, SettingsNavItem["group"]> = {
  tone: "Replies and AI",
  templates: "Replies and AI",
  sla: "Replies and AI",
  notifications: "Replies and AI",
  integrations: "Replies and AI",
  branding: "Workspace",
  plan: "Workspace",
  security: "Workspace",
};

/** Settings that can be overridden per business, group or location. */
const SCOPED_SECTIONS: readonly string[] = ["tone", "templates"];

function Panel({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

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
  const googleReturn = typeof params.google_error === "string" || params.google_connected === "true";
  const requested =
    typeof params.section === "string" ? params.section : googleReturn ? "integrations" : "tone";
  const canBill = allows(role, "manage_people");
  const section: SectionId = SECTIONS.some(([id]) => id === requested) ? (requested as SectionId) : "tone";
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
  const [settings, scopes, policy, contact, connections, branding, aiBoard] = await Promise.all([
    loadReplySettings(workspaceId, target),
    listScopeChoices(workspaceId),
    EscalationService.policy(workspaceId),
    EscalationContactStore.read(workspaceId),
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

  const navItems: SettingsNavItem[] = SECTIONS.filter(([id]) => (id !== "plan" && id !== "branding") || canBill).map(
    ([id, label]) => ({
      id,
      label,
      group: SECTION_GROUP[id],
      href: `/settings?section=${id}${SCOPED_SECTIONS.includes(id) ? scopeQuery : ""}`,
    })
  );
  const sectionLabel = SECTIONS.find(([id]) => id === section)?.[1] ?? "Settings";
  const scoped = SCOPED_SECTIONS.includes(section);
  const scopeLabel = settings.label === "the organization" ? "the workspace" : settings.label;
  const connectionRows = (connections.data ?? []).map((connection) => ({ ...connection, status: connection.status as string }));
  const ownFields = [...Object.values(settings.tone), ...Object.values(settings.automation)].filter((field) => field.overridden).length;
  const totalFields = Object.keys(settings.tone).length + Object.keys(settings.automation).length;

  const descriptions: Record<SectionId, ReactNode> = {
    tone: `How AI drafts are written for ${scopeLabel}. Businesses, groups and locations can override individual settings; each row says where its value comes from.`,
    templates: `Hand-written replies your team can insert in one click, for ${scopeLabel}. Templates work with AI off.`,
    sla: "Choose which reviews need extra care and how soon to handle them. We’ll keep them in one to-do list.",
    notifications: "What reaches you and where. Alert rules for reports live in Reports.",
    integrations: "Google accounts that give access to your Business Profiles, and how to recover when one breaks.",
    branding: "How your agency appears to your team and clients.",
    plan: "What this workspace is counted on, and where to see usage.",
    security: "How people sign in to this workspace.",
  };

  const headerAction: Partial<Record<SectionId, ReactNode>> = {
    sla: (
      <Link href="/escalations" className={buttonVariants({ variant: "outline" })}>
        Open follow-ups
      </Link>
    ),
    plan: (
      <Link href="/portfolio/usage" className={buttonVariants({ variant: "default" })}>
        Open usage
      </Link>
    ),
  };

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      <SettingsNav items={navItems} active={section} />
      <div className="min-w-0 flex-1 space-y-4">
        <PageHeader
          title={sectionLabel}
          breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: sectionLabel }]}
          description={descriptions[section]}
        >
          {headerAction[section]}
        </PageHeader>

        {scoped ? (
          <SettingsScopePicker
            section={section}
            current={target}
            choices={visibleScopes}
            appliesTo={settings.appliesTo.replace(/\bbrand\b/g, "business")}
          />
        ) : null}

        {section === "tone" && aiBoard ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <SettingsAiTabs
                tabs={(() => {
                  const props = {
                    canEdit,
                    target,
                    active: {
                      version: aiBoard.active.version,
                      label: aiBoard.active.label,
                      snapshot: {
                        org: aiBoard.active.snapshot.org,
                      },
                    },
                    versions: aiBoard.versions.map((row) => ({
                      version: row.version,
                      status: row.status,
                      label: row.label,
                      createdAt: row.createdAt,
                    })),
                    knowledge: aiBoard.knowledge
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
                      })),
                  };
                  const board = {
                    target,
                    canEdit,
                    tone: settings.tone,
                    automation: settings.automation,
                    templates: settings.templates,
                  };
                  return [
                    { id: "voice", label: "Voice and automation", content: <SettingsBoard section="tone" {...board} /> },
                    { id: "knowledge", label: "Knowledge", count: props.knowledge.length, content: <AiConfigPanel {...props} part="knowledge" /> },
                    { id: "context", label: "Workspace context", content: <AiConfigPanel {...props} part="context" /> },
                    {
                      id: "preview",
                      label: "Preview",
                      content: (
                        <div className="space-y-4">
                          <AiConfigPanel {...props} part="preview" />
                          <SettingsBoard section="preview" {...board} />
                        </div>
                      ),
                    },
                    { id: "history", label: "History", count: props.versions.length, content: <AiConfigPanel {...props} part="versions" /> },
                  ];
                })()}
              />
            </div>
            <aside className="space-y-3">
              <Panel title="How inheritance works">
                <div className="space-y-2 text-xs text-ink-3">
                  <p>
                    Workspace defaults apply everywhere. A business, group or location can override any single setting; the
                    nearest override wins.
                  </p>
                  {target.kind !== "workspace" ? (
                    <p>
                      <b className="font-medium text-ink">{ownFields}</b> of {totalFields} reply settings are set for{" "}
                      {scopeLabel}. The rest are inherited. Use “Reset to inherited” to clear them.
                    </p>
                  ) : null}
                  {!allowedClients ? (
                    <p>
                      <b className="font-medium text-ink">{settings.overrides}</b>{" "}
                      {settings.overrides === 1 ? "business, group or location has" : "businesses, groups or locations have"} their
                      own reply settings.
                    </p>
                  ) : null}
                </div>
              </Panel>
              {!canEdit ? (
                <Banner tone="neutral">You can view these settings. Saving needs permission to edit rules for this place.</Banner>
              ) : null}
            </aside>
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
          <>
            <FollowUpSettings policy={policy} canEdit={canEditWorkspace} />
            <Panel title="Your everyday routine">
              <ol className="grid gap-3 text-[13px] text-ink-2 sm:grid-cols-3">
                <li><b className="block text-ink">1. Check To do</b>Reviews needing extra care appear automatically.</li>
                <li><b className="block text-ink">2. Help the customer</b>Reply, then handle any issue behind the review.</li>
                <li><b className="block text-ink">3. Mark it done</b>Add a short note about what you did. A reply alone does not finish the follow-up.</li>
              </ol>
            </Panel>
            <details className="rounded-lg border border-line bg-white p-4">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">Optional: contact details customers can use</summary>
              <div className="mt-4"><ResolutionContactForm contact={contact} canEdit={canEditWorkspace} /></div>
            </details>
          </>
        ) : null}

        {section === "notifications" ? (
          <>
            <Panel title="What you're told about" description="The bell lists each profile you cover: reviews with no reply, drafts, failed publishes and open escalations.">
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="border-b border-line bg-paper text-xs text-ink-3">
                    <tr>
                      <th className="px-3 py-2 font-medium">Event</th>
                      <th className="px-3 py-2 font-medium">In app</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[
                      ["New review on a profile you cover", false],
                      ["Complaint assigned to you", true],
                      ["Escalation reminder due", false],
                      ["Reply failed to publish", false],
                    ].map(([event, email]) => (
                      <tr key={String(event)}>
                        <td className="px-3 py-2.5 text-ink">{event}</td>
                        <td className="px-3 py-2.5"><Badge variant="ok">On</Badge></td>
                        <td className="px-3 py-2.5 text-xs text-ink-3">
                          {email ? (emailDelivery ? "When the person turned email on" : "Mail provider not configured") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-3">
                {emailDelivery
                  ? "Email is sent for an assignment when that person turned email on."
                  : "Email preferences can be saved on Team and roles. Mail is not delivered until a mail provider is configured."}
              </p>
              {canOpenPath("/team", role) ? (
                <Link href="/team" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Notification preferences
                </Link>
              ) : (
                <p className="text-xs text-ink-3">Your own alert preferences are on Team and roles when that page is available for your role.</p>
              )}
            </Panel>
            <Panel title="Other channels">
              <ul className="divide-y divide-line rounded-md border border-line">
                {["Slack", "WhatsApp"].map((name) => (
                  <li key={name} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="text-[13px] text-ink">{name}</span>
                    <Badge variant="default">Not configured</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        ) : null}

        {section === "integrations" ? (
          <>
            <GoogleConnectionCard
              connections={connectionRows}
              initialMessage={googleError ? ERROR_MESSAGES[googleError] ?? ERROR_MESSAGES.unknown : null}
              initialSuccess={params.google_connected === "true"}
            />
            <Panel title="Other integrations">
              <ul className="divide-y divide-line rounded-md border border-line">
                {["Slack", "WhatsApp"].map((name) => (
                  <li key={name} className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="text-[13px] text-ink">{name}</span>
                    <Badge variant="default">Not configured</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
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
          <>
            <Panel title="Plan">
              <p className="text-[13px] text-ink-2">
                Usage is counted from locations and reviews. There is no separate checkout in this workspace.
              </p>
              <Link href="/portfolio/usage" className={buttonVariants({ variant: "outline", size: "sm" })}>
                See usage by business
              </Link>
            </Panel>
            <Banner tone="neutral" title="Coming soon.">
              Invoices, payment methods and AI budget caps aren&apos;t managed here yet.
            </Banner>
          </>
        ) : null}

        {section === "security" ? (
          <>
            <Panel title="Sign-in methods" description="Sign-in methods turned on for this app.">
              {methods.length ? (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {methods.map((method) => (
                    <li key={method.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">{method.label}</p>
                        <p className="text-xs text-ink-3">{method.detail}</p>
                      </div>
                      <Badge variant="ok">On</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Banner tone="warn">No sign-in method is configured on the server.</Banner>
              )}
            </Panel>
            <Banner tone="neutral" title="Coming soon.">
              Session controls, allowed email domains and workspace data export aren&apos;t available yet.
            </Banner>
          </>
        ) : null}
      </div>
    </div>
  );
}
