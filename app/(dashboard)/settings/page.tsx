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
import {
  SettingsAction,
  SettingsDetail,
  SettingsSection,
  SettingsToggleRow,
  SettingsValueRow,
} from "@/components/settings-section";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { EscalationService } from "@/lib/services/escalations";
import { ContactSection } from "./contact-section";
import { getMemberAccess, listScopeChoices, visibleClientIds } from "@/lib/services/access";
import { loadReplySettings, type SettingsTarget } from "@/lib/services/reply-settings";
import { loadAiBoard } from "@/lib/services/ai-config";
import { getActiveRole, getActiveWorkspace } from "@/lib/services/session";
import { canOpenPath, canOpenTeam, type ShellRole } from "@/lib/shell";
import { loadAgencyBranding } from "@/lib/services/agency-branding";
import { domainStatus, senderStatus } from "@/lib/agency-portal";
import { BrandingForm } from "@/components/branding-form";
import { relativeTime } from "@/lib/mobile-work";
import { formatFriendlyDate } from "@/lib/format-date";
import type { AiKnowledgeKind } from "@/lib/ai-config";
import { TeamSection } from "./team-section";
import { AuditLogSection, countAuditEvents } from "./audit-section";
import { UsageSection } from "./usage-section";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You denied access to your Google account. You can try again when ready.",
  auth_failed: "Google authorization failed. Please try again.",
  unknown: "An unexpected error occurred. Please try again.",
};

// Section ids are the ones links and emails already use (?section=tone, sla, integrations…).
const SECTIONS = [
  { id: "tone", label: "Reply style", group: "Replies" },
  { id: "templates", label: "Templates", group: "Replies" },
  { id: "sla", label: "Follow-up rules", group: "Replies" },
  { id: "team", label: "Team", group: "Workspace" },
  { id: "notifications", label: "Notifications", group: "Workspace" },
  { id: "integrations", label: "Google connection", group: "Workspace" },
  { id: "branding", label: "Branding", group: "Workspace" },
  { id: "plan", label: "Plan and usage", group: "Account" },
  { id: "security", label: "Security and audit log", group: "Account" },
] as const satisfies ReadonlyArray<Pick<SettingsNavItem, "id" | "label" | "group">>;

type SectionId = (typeof SECTIONS)[number]["id"];

/** Names used on the redesign board, so either spelling opens the section. */
const ALIASES: Record<string, SectionId> = {
  style: "tone",
  "follow-ups": "sla",
  google: "integrations",
  usage: "plan",
  audit: "security",
};

/** Settings that can be overridden per business, group or location. */
const SCOPED_SECTIONS: readonly SectionId[] = ["tone", "templates"];

/** Every section needs Settings access; these need more. Hidden sections are left out of the nav. */
function canOpenSection(section: SectionId, role: ShellRole): boolean {
  if (section === "team") return canOpenTeam(role);
  if (section === "branding" || section === "plan") return allows(role, "manage_people");
  return true;
}

function parseTarget(raw: string | undefined): SettingsTarget {
  if (!raw || raw === "workspace") return { kind: "workspace" };
  const [kind, id] = raw.split(":");
  if ((kind === "client" || kind === "group" || kind === "location") && id && /^[0-9a-f-]{36}$/i.test(id)) {
    return { kind, id };
  }
  return { kind: "workspace" };
}

function sentence(values: string[], empty: string): string {
  if (values.length === 0) return empty;
  return values.length > 3 ? `${values.slice(0, 3).join(", ")} +${values.length - 3}` : values.join(", ");
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
  const raw = typeof params.section === "string" ? params.section : googleReturn ? "integrations" : "tone";
  const requested = ALIASES[raw] ?? raw;
  const section: SectionId = SECTIONS.some(({ id }) => id === requested) ? (requested as SectionId) : "tone";
  if (!canOpenSection(section, role)) redirect("/settings?section=tone");

  const target = SCOPED_SECTIONS.includes(section)
    ? parseTarget(typeof params.scope === "string" ? params.scope : undefined)
    : ({ kind: "workspace" } as const);
  const access = await getMemberAccess(user.id, workspaceId);
  const canEditWorkspace = workspaceGrant(role, "edit_rules");
  const canEdit = target.kind === "workspace" ? canEditWorkspace : Boolean(access?.enabled && allows(role, "edit_rules"));

  const allowedClients = await visibleClientIds(workspaceId, access?.scope);
  if (target.kind === "client" && allowedClients && !allowedClients.includes(target.id)) {
    redirect(`/settings?section=${section}`);
  }
  if (allowedClients && target.kind === "location") {
    const place = await createAdminClient()
      .from("grm_google_locations")
      .select("client_id")
      .eq("workspace_id", workspaceId)
      .eq("id", target.id)
      .maybeSingle();
    if (!place.data?.client_id || !allowedClients.includes(place.data.client_id)) {
      redirect(`/settings?section=${section}`);
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
      redirect(`/settings?section=${section}`);
    }
  }

  const scopeQuery = target.kind === "workspace" ? "" : `&scope=${target.kind}:${target.id}`;
  const navItems: SettingsNavItem[] = SECTIONS.filter(({ id }) => canOpenSection(id, role)).map(({ id, label, group }) => ({
    id,
    label,
    group,
    href: `/settings?section=${id}${SCOPED_SECTIONS.includes(id) ? scopeQuery : ""}`,
  }));

  let content: ReactNode = null;
  if (section === "tone" || section === "templates") {
    content = await replySection(section, { workspaceId, userId: user.id, target, canEdit, allowedClients });
  } else if (section === "sla") {
    content = await followUpSection(workspaceId, user.id, canEditWorkspace);
  } else if (section === "team") {
    content = <TeamSection params={params} role={role} userId={user.id} workspaceId={workspaceId} />;
  } else if (section === "notifications") {
    content = notificationsSection(canOpenTeam(role));
  } else if (section === "integrations") {
    content = await googleSection(workspaceId, allowedClients, {
      googleError: typeof params.google_error === "string" ? params.google_error : null,
      connected: params.google_connected === "true",
    });
  } else if (section === "branding") {
    content = await brandingSection(workspaceId);
  } else if (section === "plan") {
    content = <UsageSection params={params} userId={user.id} workspaceId={workspaceId} />;
  } else {
    content = await securitySection(params, workspaceId, canOpenTeam(role));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <SettingsNav items={navItems} active={section} />
        <div className="min-w-0 flex-1 space-y-5">{content}</div>
      </div>
    </div>
  );
}

async function replySection(
  section: "tone" | "templates",
  input: {
    workspaceId: string;
    userId: string;
    target: SettingsTarget;
    canEdit: boolean;
    allowedClients: string[] | null;
  }
) {
  const { workspaceId, target, canEdit, allowedClients } = input;
  const [settings, scopes, aiBoard] = await Promise.all([
    loadReplySettings(workspaceId, target),
    listScopeChoices(workspaceId),
    section === "tone" ? loadAiBoard(workspaceId, input.userId) : Promise.resolve(null),
  ]);
  const visibleScopes = allowedClients
    ? scopes.filter((choice) => choice.kind === "client" && allowedClients.includes(choice.id))
    : scopes;
  const picker = <SettingsScopePicker section={section} current={target} choices={visibleScopes} />;
  const scopeLabel = settings.label === "the organization" ? "the workspace" : settings.label;
  const board = { target, canEdit, tone: settings.tone, automation: settings.automation, templates: settings.templates };
  const readOnly = !canEdit ? (
    <Banner tone="neutral">You can view these settings. Saving needs permission to edit rules for this place.</Banner>
  ) : null;

  if (section === "templates") {
    return (
      <>
        <SettingsSection
          title="Templates"
          description={`Saved replies you can drop in and edit, for ${scopeLabel}. Templates work with AI off.`}
          aside={
            <>
              {picker}
              {canEdit ? <SettingsAction href={`#templates-editor`}>New template</SettingsAction> : null}
            </>
          }
        >
          {settings.templates.length === 0 ? (
            <SettingsValueRow label="No templates yet" hint="Write one below. It shows up in the reply box on Reviews." value="" />
          ) : (
            settings.templates.map((template) => (
              <SettingsValueRow
                key={template.id}
                label={template.name}
                hint={template.body.length > 90 ? `${template.body.slice(0, 90)}…` : template.body}
                value={template.scopeLabel}
                action={{ label: canEdit ? "Edit" : "View", href: "#templates-editor" }}
              />
            ))
          )}
        </SettingsSection>
        {readOnly}
        <SettingsDetail id="templates-editor">
          <SettingsBoard section="templates" {...board} />
        </SettingsDetail>
      </>
    );
  }

  const { tone, automation } = settings;
  // Only this place's own values are sent, so flipping one switch keeps everything else inherited.
  const own = <T,>(field: { value: T; overridden: boolean }) => (field.overridden ? field.value : null);
  const toneBody = {
    greeting: own(tone.greeting),
    signoff: own(tone.signoff),
    warmth: own(tone.warmth),
    length: own(tone.length),
    languages: own(tone.languages),
    neverSay: own(tone.neverSay),
    spellings: own(tone.spellings),
  };
  const automationBody = {
    enabled: own(automation.enabled),
    minStars: own(automation.minStars),
    excludeQuestions: own(automation.excludeQuestions),
    dailyCap: own(automation.dailyCap),
    holdbackMinutes: own(automation.holdbackMinutes),
    windowStart: own(automation.windowStart),
    windowEnd: own(automation.windowEnd),
    shadowMode: own(automation.shadowMode),
    varyWording: own(automation.varyWording),
  };
  const automationToggle = (field: "enabled" | "shadowMode") => ({
    on: { action: "save", target, tone: toneBody, automation: { ...automationBody, [field]: true } },
    off: { action: "save", target, tone: toneBody, automation: { ...automationBody, [field]: false } },
  });
  const knowledge = (aiBoard?.knowledge ?? []).filter((row) => {
    if (target.kind === "workspace") return !row.clientId && !row.groupId && !row.locationId;
    if (target.kind === "client") return row.clientId === target.id;
    if (target.kind === "group") return row.groupId === target.id;
    return row.locationId === target.id;
  });
  const inherited = (field: { overridden: boolean; source: string }) =>
    field.overridden || target.kind === "workspace" ? null : ` Inherited from ${field.source === "the organization" ? "the workspace" : field.source}.`;
  const warmth = tone.warmth.value === "formal" ? "Formal" : "Friendly";
  const length = { brief: "brief", standard: "standard length", detailed: "detailed" }[tone.length.value];

  return (
    <>
      <SettingsSection
        title="Reply style"
        description="How replies sound and what AI is allowed to do. Each business can override it."
        aside={picker}
      >
        <SettingsValueRow
          label="Tone"
          hint={<>Shapes every AI draft.{inherited(tone.warmth)}</>}
          value={`${warmth}, ${length}`}
          action={{ label: "Change", href: "#reply-editor" }}
        />
        <SettingsValueRow
          label="Greeting"
          hint="How each reply opens."
          value={tone.greeting.value || "None"}
          action={{ label: "Change", href: "#reply-editor" }}
        />
        <SettingsValueRow
          label="Sign-off"
          hint={<>Added to the end of each reply.{inherited(tone.signoff)}</>}
          value={tone.signoff.value || "None"}
          action={{ label: "Change", href: "#reply-editor" }}
        />
        <SettingsToggleRow
          label={`Publish ${automation.minStars.value === 5 ? "5 star" : "4 and 5 star"} replies without approval`}
          hint={<>Critical reviews always wait for a person.{inherited(automation.enabled)}</>}
          on={automation.enabled.value}
          endpoint="/api/settings/reply"
          bodies={automationToggle("enabled")}
          disabled={!canEdit}
        />
        <SettingsToggleRow
          label="Shadow mode"
          hint="Save drafts and post nothing, to see what automation would do."
          on={automation.shadowMode.value}
          endpoint="/api/settings/reply"
          bodies={automationToggle("shadowMode")}
          disabled={!canEdit}
        />
        <SettingsValueRow
          label="Business facts"
          hint="Hours, parking, offers. AI uses these in replies."
          value={`${knowledge.length.toLocaleString("en-US")} ${knowledge.length === 1 ? "fact" : "facts"}`}
          action={{ label: "Manage", href: "#reply-editor" }}
        />
        <SettingsValueRow
          label="Never mention"
          hint="Words and topics AI must avoid."
          value={sentence(tone.neverSay.value, "Nothing set")}
          action={{ label: "Edit", href: "#reply-editor" }}
        />
      </SettingsSection>
      {readOnly}

      {aiBoard ? (
        <SettingsDetail id="reply-editor" title="Edit reply style">
          <p className="text-xs text-ink-3">
            Workspace defaults apply everywhere. A business, group or location can override any single setting; the nearest
            override wins. These apply to {settings.appliesTo.replace(/\bbrand\b/g, "business")}.
            {!allowedClients && settings.overrides > 0
              ? ` ${settings.overrides.toLocaleString("en-US")} ${settings.overrides === 1 ? "place has" : "places have"} their own reply settings.`
              : ""}
          </p>
          <SettingsAiTabs
            tabs={(() => {
              const props = {
                canEdit,
                target,
                active: {
                  version: aiBoard.active.version,
                  label: aiBoard.active.label,
                  snapshot: { org: aiBoard.active.snapshot.org },
                },
                versions: aiBoard.versions.map((row) => ({
                  version: row.version,
                  status: row.status,
                  label: row.label,
                  createdAt: row.createdAt,
                })),
                knowledge: knowledge.map((row) => ({
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
              return [
                { id: "voice", label: "Voice and automation", content: <SettingsBoard section="tone" {...board} /> },
                { id: "knowledge", label: "Business facts", count: props.knowledge.length, content: <AiConfigPanel {...props} part="knowledge" /> },
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
        </SettingsDetail>
      ) : null}
    </>
  );
}

async function followUpSection(workspaceId: string, userId: string, canEdit: boolean) {
  const policy = await EscalationService.policy(workspaceId);
  const stars = policy.maxStars <= 1 ? "1 star" : `1 to ${policy.maxStars} star`;
  return (
    <>
      <SettingsSection
        title="Follow-up rules"
        description="When an unhappy customer needs a call, not just a reply. A reply alone does not finish a follow-up."
        aside={<SettingsAction href="/escalations">Open follow-ups</SettingsAction>}
      >
        <SettingsValueRow
          label={`Flag ${stars} reviews for follow-up`}
          hint="They show up in Reviews › Follow-ups."
          value={`${policy.maxStars} stars or fewer`}
          action={{ label: canEdit ? "Change" : "View", href: "#follow-up-editor" }}
        />
        <SettingsValueRow
          label="Also flag"
          hint="Reviews that mention these, whatever the rating."
          value={sentence(
            [
              ...(policy.flagProfanity ? ["Profanity"] : []),
              ...(policy.flagLegalSafety ? ["Legal or safety"] : []),
              ...policy.extraKeywords,
            ],
            "Nothing else"
          )}
          action={{ label: canEdit ? "Change" : "View", href: "#follow-up-editor" }}
        />
        <SettingsValueRow
          label="Due within"
          hint="After that it shows as overdue on Today."
          value={`${policy.dueHours} hours`}
          action={{ label: canEdit ? "Change" : "View", href: "#follow-up-editor" }}
        />
        <SettingsValueRow
          label="Check-in reminders"
          hint="Hours after a follow-up opens."
          value={sentence(policy.reminderHours.map((hour) => `${hour}h`), "None")}
          action={{ label: canEdit ? "Change" : "View", href: "#follow-up-editor" }}
        />
      </SettingsSection>
      <SettingsDetail id="follow-up-editor" title="Edit follow-up rules">
        <FollowUpSettings policy={policy} canEdit={canEdit} />
        <ContactSection workspaceId={workspaceId} userId={userId} />
      </SettingsDetail>
    </>
  );
}

function notificationsSection(canOpenTeamSection: boolean) {
  const emailDelivery = Boolean(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL);
  const preferences = canOpenTeamSection ? { label: "Preferences", href: "/settings?section=team" } : null;
  return (
    <>
      <SettingsSection title="Notifications" description="Where alerts go. Reports and alert rules live in Insights.">
        <SettingsValueRow
          label="In-app alerts"
          hint="Reviews with no reply, drafts, failed publishes and open follow-ups on the profiles you cover."
          value="On"
        />
        <SettingsValueRow
          label="Email"
          hint="Sent when someone is assigned a complaint and has email turned on."
          value={emailDelivery ? "Each person chooses" : "Mail provider not configured"}
          action={preferences}
        />
        <SettingsValueRow label="Slack" hint="Send alerts to a channel." value="Not available yet" />
        <SettingsValueRow label="WhatsApp" hint="Send alerts to a phone." value="Not available yet" />
      </SettingsSection>
      <SettingsDetail id="notification-events" title="What you're told about">
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="border-b border-line bg-paper text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">In app</th>
                <th className="px-3 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(
                [
                  ["New review on a profile you cover", false],
                  ["Complaint assigned to you", true],
                  ["Escalation reminder due", false],
                  ["Reply failed to publish", false],
                ] as const
              ).map(([event, email]) => (
                <tr key={event}>
                  <td className="px-3 py-2.5 text-ink">{event}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="ok">On</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-3">
                    {email ? (emailDelivery ? "When the person turned email on" : "Mail provider not configured") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsDetail>
    </>
  );
}

async function googleSection(
  workspaceId: string,
  allowedClients: string[] | null,
  state: { googleError: string | null; connected: boolean }
) {
  const admin = createAdminClient();
  let locations = admin
    .from("grm_google_locations")
    .select("id, last_synced_at, total_review_count")
    .eq("workspace_id", workspaceId);
  if (allowedClients) locations = locations.in("client_id", allowedClients.length ? allowedClients : ["00000000-0000-0000-0000-000000000000"]);
  const [connections, places] = await Promise.all([
    admin
      .from("grm_google_connections")
      .select("id, google_email, status, created_at, last_refreshed_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "revoked")
      .order("created_at", { ascending: false }),
    locations,
  ]);
  const rows = (connections.data ?? []).map((connection) => ({ ...connection, status: connection.status as string }));
  const placeRows = places.data ?? [];
  const lastSync = placeRows.reduce<string | null>(
    (latest, row) => (row.last_synced_at && (!latest || row.last_synced_at > latest) ? row.last_synced_at : latest),
    null
  );
  const reviewTotal = placeRows.reduce((sum, row) => sum + (row.total_review_count ?? 0), 0);
  const statusLabel = (status: string) =>
    status === "active" ? "Connected" : status === "expired" ? "Access expired" : status.replaceAll("_", " ");

  return (
    <>
      <SettingsSection
        title="Google connection"
        description="The Google account that can read and reply to your Business Profiles. This is separate from how you sign in."
      >
        {rows.length === 0 ? (
          <SettingsValueRow
            label="Business Profile account"
            hint="Powers sync and publishing."
            value="Not connected"
            action={{ label: "Connect", href: "#google-accounts" }}
          />
        ) : (
          rows.map((connection) => (
            <SettingsValueRow
              key={connection.id}
              label={connection.google_email}
              hint={`Connected ${formatFriendlyDate(connection.created_at)}. Powers sync and publishing.`}
              value={statusLabel(connection.status)}
              action={{ label: connection.status === "active" ? "Manage" : "Reconnect", href: "#google-accounts" }}
            />
          ))
        )}
        <SettingsValueRow
          label="Last sync"
          hint={`${placeRows.length.toLocaleString("en-US")} ${placeRows.length === 1 ? "location" : "locations"}, ${reviewTotal.toLocaleString("en-US")} reviews on Google.`}
          value={lastSync ? relativeTime(lastSync) : "Never"}
          action={{ label: "Sync now", href: "/locations" }}
        />
      </SettingsSection>
      <SettingsDetail id="google-accounts" title="Google accounts">
        <GoogleConnectionCard
          connections={rows}
          initialMessage={state.googleError ? ERROR_MESSAGES[state.googleError] ?? ERROR_MESSAGES.unknown : null}
          initialSuccess={state.connected}
        />
      </SettingsDetail>
    </>
  );
}

async function brandingSection(workspaceId: string) {
  const branding = await loadAgencyBranding(workspaceId);
  const emailDelivery = Boolean(process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL);
  const domain = domainStatus({ domain: branding.customDomain, verifiedAt: branding.domainVerifiedAt });
  const sender = senderStatus({
    email: branding.senderEmail,
    mailConfigured: emailDelivery,
    configuredFrom: process.env.REPORT_FROM_EMAIL ?? null,
  });
  const saveBody = (hideProductName: boolean) => ({
    action: "save",
    logoUrl: branding.logoUrl ?? "",
    hideProductName,
    customDomain: branding.customDomain ?? "",
    senderEmail: branding.senderEmail ?? "",
  });
  return (
    <>
      <SettingsSection title="Branding" description="How the app and client reports look.">
        <SettingsValueRow
          label="Logo"
          hint="Shown in the sidebar and on reports."
          value={branding.logoUrl ? branding.logoUrl.replace(/^https?:\/\//, "").split("/").pop() || "Set" : "None"}
          action={{ label: branding.logoUrl ? "Replace" : "Add", href: "#branding-editor" }}
        />
        <SettingsValueRow
          label="Custom domain"
          hint="Where clients open their reports and review request pages."
          value={branding.customDomain ? `${branding.customDomain} · ${domain.label}` : "None"}
          action={{ label: "Change", href: "#branding-editor" }}
        />
        <SettingsValueRow
          label="Sender email"
          hint="Reports and invites are sent from this address."
          value={branding.senderEmail ? `${branding.senderEmail} · ${sender.label}` : sender.label}
          action={{ label: "Change", href: "#branding-editor" }}
        />
        <SettingsToggleRow
          label="Hide the RevuPilot name"
          hint="Clients only see your brand."
          on={branding.hideProductName}
          endpoint="/api/settings/branding"
          bodies={{ on: saveBody(true), off: saveBody(false) }}
        />
      </SettingsSection>
      <SettingsDetail id="branding-editor" title="Edit branding">
        <BrandingForm
          logoUrl={branding.logoUrl ?? ""}
          hideProductName={branding.hideProductName}
          customDomain={branding.customDomain ?? ""}
          domainToken={branding.domainToken}
          domainLabel={domain.label}
          domainActive={domain.active}
          senderEmail={branding.senderEmail ?? ""}
          senderLabel={sender.label}
          senderActive={sender.active}
        />
      </SettingsDetail>
    </>
  );
}

async function securitySection(
  params: Record<string, string | string[] | undefined>,
  workspaceId: string,
  canSeeAudit: boolean
) {
  const methods = authMethodsFromEnv();
  const events = canSeeAudit ? await countAuditEvents(workspaceId) : 0;
  return (
    <>
      <SettingsSection title="Security and audit log" description="Sign-in rules and a record of every action.">
        <SettingsValueRow
          label="Sign-in methods"
          hint="How your team signs in."
          value={methods.length ? methods.map((method) => method.label).join(", ") : "None configured on the server"}
        />
        <SettingsValueRow
          label="Two-step verification"
          hint="Set by each person's Google account. Session controls and allowed email domains aren't available yet."
          value="Managed by Google"
        />
        {canSeeAudit ? (
          <SettingsValueRow
            label="Audit log"
            hint="Every connection, sync, draft, approval and publish. Read-only."
            value={`${events.toLocaleString("en-US")} ${events === 1 ? "event" : "events"}`}
            action={{ label: "View", href: "#audit-log" }}
          />
        ) : null}
      </SettingsSection>
      {canSeeAudit ? (
        <SettingsDetail id="audit-log" title="Audit log">
          <AuditLogSection params={params} workspaceId={workspaceId} />
        </SettingsDetail>
      ) : null}
    </>
  );
}
