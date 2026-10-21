"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AccessRequestRow, PlatformAnnouncementRow } from "@/lib/services/platform";

async function send(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; results?: Array<{ email: string; ok: boolean; detail: string }> };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
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

  async function handleBulk(event: FormEvent) {
    event.preventDefault();
    const emails = bulk.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setBusy("bulk");
    setError(null);
    try {
      const data = await send("/api/platform/invites/bulk", { emails });
      const ok = (data.results ?? []).filter((r) => r.ok).length;
      toast.success(`${ok}/${emails.length} tenant invites saved`, { description: "Failures are listed below. Emails are only sent when Resend is configured." });
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Bulk invite tenants</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">Paste emails separated by commas, spaces, or new lines (from a CSV column works). Max 100. Each gets the standard 7-day, one-tenant invite.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleBulk} className="space-y-3">
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={"owner@a.com\nowner@b.com"} className="w-full rounded-md border border-line px-2 py-2 text-sm" aria-label="Tenant owner emails" />
            <Button type="submit" loading={busy === "bulk"} disabled={!bulk.trim()}>Invite all</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Access requests</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">People who signed in without an invite and asked for access from the invite-only page. Approving creates their tenant invite.</p>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? <p className="text-sm text-slate">No access requests yet. Apply migration 20261022002 if requests should be recorded.</p> : (
            <ul className="divide-y divide-silver overflow-hidden rounded-xl border border-silver">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-graphite">{r.email} <span className="ml-1 text-xs capitalize text-slate">{r.status}</span></p>
                    <p className="text-xs text-slate">{r.company ?? "No company given"}{r.message ? ` · “${r.message}”` : ""} · {new Date(r.createdAt).toLocaleDateString()}</p>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex shrink-0 gap-2">
                      <Button type="button" size="sm" loading={busy === r.id} onClick={() => decide(r, true)}>Approve & invite</Button>
                      <Button type="button" variant="outline" size="sm" loading={busy === r.id} onClick={() => decide(r, false)}>Deny</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Announcement banner</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">Shown at the top of every tenant&apos;s app while active.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={publish} className="space-y-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Announcement title" required maxLength={200} />
            <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Message" aria-label="Announcement message" required maxLength={2000} rows={3} className="w-full rounded-md border border-line px-2 py-2 text-sm" />
            <div className="flex gap-2">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-md border border-line bg-white px-2 py-2 text-sm" aria-label="Tone"><option value="info">Info</option><option value="warning">Warning</option></select>
              <Button type="submit" loading={busy === "announce"}>Publish</Button>
            </div>
          </form>
          {announcements.length > 0 ? (
            <ul className="divide-y divide-silver rounded-xl border border-silver">
              {announcements.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-graphite"><strong>{a.title}</strong> — {a.body} <span className="text-xs text-slate">({a.active ? "active" : "hidden"})</span></span>
                  <Button type="button" variant="outline" size="sm" onClick={async () => { await send(`/api/platform/announcements/${a.id}`, { active: !a.active }); router.refresh(); }}>{a.active ? "Hide" : "Show"}</Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Maintenance mode</CardTitle>
          <p className="mt-1 text-sm font-light text-slate">Blocks the tenant app for everyone except super admins. Data and cron jobs are untouched.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-graphite"><input type="checkbox" checked={maintOn} onChange={(e) => setMaintOn(e.target.checked)} /> Maintenance mode on</label>
          <Input value={maintMsg} onChange={(e) => setMaintMsg(e.target.value)} placeholder="Message shown to tenants (optional)" aria-label="Maintenance message" maxLength={500} />
          <Button type="button" loading={busy === "maint"} onClick={saveMaintenance}>Save</Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}
