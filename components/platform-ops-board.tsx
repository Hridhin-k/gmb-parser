"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminCard, formatAdminDate } from "@/components/platform-admin-ui";
import type { AccessRequestRow, PlatformAnnouncementRow } from "@/lib/services/platform";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; results?: Array<{ email: string; ok: boolean; detail: string }> };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

function requestBadge(status: string) {
  const variant = status === "pending" ? "info" : status === "approved" ? "ok" : status === "denied" ? "default" : "default";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

function Preview({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-line-2">
      <p className="border-b border-line-2 bg-paper px-3 py-1.5 text-xs text-ink-3"><span className="font-semibold text-ink-2">Preview</span> · {caption}</p>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

export function PlatformOpsBoard({ requests, announcements, maintenance }: {
  requests: AccessRequestRow[];
  announcements: PlatformAnnouncementRow[];
  maintenance: { enabled: boolean; message: string | null };
}) {
  const router = useRouter();
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [tone, setTone] = useState("info");
  const [maintOn, setMaintOn] = useState(maintenance.enabled);
  const [maintMsg, setMaintMsg] = useState(maintenance.message ?? "");

  const bulkCount = bulk.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean).length;
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const maintDirty = maintOn !== maintenance.enabled || (maintMsg.trim() || null) !== (maintenance.message ?? null);

  async function handleBulk(event: FormEvent) {
    event.preventDefault();
    const emails = bulk.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setBusy("bulk");
    setError(null);
    try {
      const data = await send("/api/platform/invites/bulk", { emails });
      const ok = (data.results ?? []).filter((r) => r.ok).length;
      toast.success(`${ok}/${emails.length} tenant invites saved`, { description: "Failures are listed on this page. Emails are only sent when Resend is configured." });
      const failed = (data.results ?? []).filter((r) => !r.ok);
      if (failed.length) setError(failed.map((f) => `${f.email}: ${f.detail}`).join(" · "));
      setBulk("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk invite failed.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(request: AccessRequestRow, approve: boolean) {
    setBusy(request.id);
    setError(null);
    try {
      await send(`/api/platform/access-requests/${request.id}`, { approve });
      toast.success(approve ? `Approved — tenant invite created for ${request.email}` : "Request denied");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decide that request.");
    } finally {
      setBusy(null);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy("announce");
    try {
      await send("/api/platform/announcements", { title, body: bodyText, tone });
      toast.success("Announcement published to all tenants");
      setTitle(""); setBodyText("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAnnouncement(a: PlatformAnnouncementRow) {
    setBusy(`ann-${a.id}`);
    try {
      await send(`/api/platform/announcements/${a.id}`, { active: !a.active });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that announcement.");
    } finally {
      setBusy(null);
    }
  }

  async function saveMaintenance() {
    setBusy("maint");
    try {
      await send("/api/platform/settings", { enabled: maintOn, message: maintMsg.trim() || null });
      toast.success(maintOn ? "Maintenance mode ON for tenants" : "Maintenance mode off");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update maintenance mode.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Banner tone="bad" title="Something needs a look.">{error}</Banner> : null}
      {maintenance.enabled ? (
        <Banner tone="warn" title="Maintenance mode is on.">Tenants are blocked from the app until you turn it off below. Super admins can still sign in.</Banner>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <AdminCard
            id="access-requests"
            title={<span className="flex items-center gap-2">Access requests {pending.length > 0 ? <Badge variant="info">{pending.length} pending</Badge> : null}</span>}
            description="People who signed in without an invite and asked for access. Approving creates their tenant invite."
            bodyClassName="p-0"
          >
            {requests.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No access requests yet. Apply migration 20261022002 if requests should be recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...pending, ...decided].map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="min-w-56 whitespace-normal">
                        <span className="font-medium text-ink">{r.email}</span>
                        <p className="text-xs text-ink-3">{r.company ?? "No company given"}</p>
                        {r.message ? <p className="mt-0.5 max-w-80 text-xs text-ink-2">“{r.message}”</p> : null}
                      </TableCell>
                      <TableCell className="text-ink-2">{formatAdminDate(r.createdAt)}</TableCell>
                      <TableCell>{requestBadge(r.status)}</TableCell>
                      <TableCell>
                        {r.status === "pending" ? (
                          <div className="flex justify-end gap-1.5">
                            <Button type="button" variant="ghost" size="sm" loading={busy === r.id} onClick={() => decide(r, false)}>Deny</Button>
                            <Button type="button" size="sm" loading={busy === r.id} onClick={() => decide(r, true)}>Approve &amp; invite</Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AdminCard>

          <AdminCard
            id="bulk-invite"
            title="Bulk invite tenants"
            description="Paste emails separated by commas, spaces or new lines (a CSV column works). Max 100. Each gets the standard 7-day, one-tenant invite."
          >
            <form onSubmit={handleBulk} className="flex flex-col gap-3">
              <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={"owner@a.com\nowner@b.com"} aria-label="Tenant owner emails" className="min-h-24 font-mono text-xs" />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={busy === "bulk"} disabled={!bulk.trim() || bulkCount > 100}>
                  {bulkCount > 0 ? `Invite ${bulkCount} tenant${bulkCount === 1 ? "" : "s"}` : "Invite all"}
                </Button>
                {bulkCount > 100 ? <span className="text-xs text-bad">{bulkCount} emails · the limit is 100 per batch</span> : null}
              </div>
            </form>
          </AdminCard>

          <AdminCard title="Operational failures" description="Failures that need a person to act">
            <p className="text-[13px] text-ink-2">Failed and stale location syncs and expired or revoked Google connections are listed on Health, with links to each tenant.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/admin/health#sync" className={buttonVariants({ variant: "outline", size: "sm" })}>Sync problems</Link>
              <Link href="/admin/health#connections" className={buttonVariants({ variant: "outline", size: "sm" })}>Connection problems</Link>
            </div>
            <p className="mt-3 text-xs text-ink-3">Incidents, scheduled maintenance windows and bulk retries aren&apos;t available yet.</p>
          </AdminCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AdminCard
            id="maintenance"
            title={<span className="flex items-center gap-2">Maintenance mode <Badge variant={maintenance.enabled ? "warn" : "default"}>{maintenance.enabled ? "On" : "Off"}</Badge></span>}
            description="Blocks the tenant app for everyone except super admins. Data and cron jobs are untouched."
            tone={maintenance.enabled ? "warn" : undefined}
          >
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
                <Checkbox checked={maintOn} onCheckedChange={(checked) => setMaintOn(checked === true)} />
                Maintenance mode on
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                Message shown to tenants <span className="font-normal text-ink-3">(optional)</span>
                <Input value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} placeholder="e.g. We're upgrading the database. Back by 03:30 UTC." maxLength={500} />
              </label>
              {maintOn ? (
                <Preview caption="full-page notice that replaces the tenant app">
                  <div className="rounded-md border border-line bg-white px-4 py-4 text-center">
                    <Badge variant="info">Maintenance</Badge>
                    <p className="mt-2 text-sm font-semibold text-ink">RevuPilot is under maintenance</p>
                    <p className="mt-1 text-xs text-ink-3">{maintMsg.trim() || "We're making improvements. Queued actions resume automatically afterwards. Please check back shortly."}</p>
                  </div>
                </Preview>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant={maintOn && !maintenance.enabled ? "destructive-solid" : "default"} loading={busy === "maint"} disabled={!maintDirty} onClick={saveMaintenance}>
                  {maintOn && !maintenance.enabled ? "Turn on maintenance" : !maintOn && maintenance.enabled ? "Turn off maintenance" : "Save"}
                </Button>
                {!maintDirty ? <span className="text-xs text-ink-3">No changes</span> : null}
              </div>
            </div>
          </AdminCard>

          <AdminCard id="announcement" title="Announcement banner" description="Shown at the top of every tenant's app while active.">
            <form onSubmit={publish} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                Title
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New: saved replies" required maxLength={200} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                Message
                <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="What tenants should know" required maxLength={2000} rows={3} />
              </label>
              <div className="flex flex-col gap-1 text-xs font-medium text-ink-2 sm:w-48">
                Tone
                <SelectField label="Tone" value={tone} onValueChange={setTone} options={[{ value: "info", label: "Info" }, { value: "warning", label: "Warning" }]} />
              </div>
              {title.trim() || bodyText.trim() ? (
                <Preview caption="top of every tenant's app">
                  <Banner tone={tone === "warning" ? "warn" : "info"} title={title.trim() || undefined} className="text-xs">{bodyText.trim() || null}</Banner>
                </Preview>
              ) : null}
              <div>
                <Button type="submit" loading={busy === "announce"}>Publish to all tenants</Button>
              </div>
            </form>
          </AdminCard>

          <AdminCard title="Announcements" description={`${announcements.filter((a) => a.active).length} active · ${announcements.length} total`} bodyClassName="p-0">
            {announcements.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-ink-3">No announcements yet.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {announcements.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 px-4 py-2.5 text-[13px]">
                    <Badge variant={a.active ? "ok" : "default"} className="mt-px">{a.active ? "Live" : "Hidden"}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{a.title}</p>
                      <p className="text-ink-2">{a.body}</p>
                      <p className="mt-0.5 text-xs text-ink-3">{a.tone === "warning" ? "Warning" : "Info"} · {formatAdminDate(a.createdAt)}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" loading={busy === `ann-${a.id}`} onClick={() => toggleAnnouncement(a)}>{a.active ? "Hide" : "Show"}</Button>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>
    </div>
  );
}
