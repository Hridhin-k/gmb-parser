"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TenantDetail } from "@/lib/services/platform";

const FLAG_LABELS: Record<string, string> = {
  automation: "Auto-reply automation cron (enforced)",
  requests: "Review requests (stored — enforcement on campaign send is a follow-up)",
  reports: "Scheduled reports & alerts (stored — enforcement on report runs is a follow-up)",
};

async function send(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export function TenantSettingsCard({ detail }: { detail: TenantDetail }) {
  const router = useRouter();
  const t = detail.tenant;
  const [plan, setPlan] = useState(t.plan);
  const [planExpiresAt, setPlanExpiresAt] = useState(t.planExpiresAt ? t.planExpiresAt.slice(0, 10) : "");
  const [aiBudget, setAiBudget] = useState(t.aiBudgetUsd == null ? "" : String(t.aiBudgetUsd));
  const [maxLocations, setMaxLocations] = useState(t.maxLocations == null ? "" : String(t.maxLocations));
  const [maxMembers, setMaxMembers] = useState(t.maxMembers == null ? "" : String(t.maxMembers));
  const [note, setNote] = useState(t.adminNote ?? "");
  const [flags, setFlags] = useState<Record<string, boolean>>(t.featureFlags);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await send(`/api/platform/tenants/${t.id}`, "PATCH", {
        plan,
        planExpiresAt: planExpiresAt ? new Date(`${planExpiresAt}T23:59:59.000Z`).toISOString() : null,
        aiBudgetUsd: aiBudget.trim() === "" ? null : Number(aiBudget),
        maxLocations: maxLocations.trim() === "" ? null : Number(maxLocations),
        maxMembers: maxMembers.trim() === "" ? null : Number(maxMembers),
        adminNote: note.trim() || null,
        featureFlags: flags,
      });
      toast.success("Tenant settings saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function supportView() {
    setViewing(true);
    try {
      await send(`/api/platform/tenants/${t.id}/impersonate`, "POST");
      router.replace("/overview");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enter support view.");
      setViewing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[22px] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Plan, limits & flags</CardTitle>
        <p className="mt-1 text-sm font-light text-slate">AI budget overrides the platform default and is enforced before Gemini calls. Member cap is enforced on team invites. Location cap is shown as usage guidance. Leaving a limit blank means unlimited / platform default.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm text-graphite">Plan
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full rounded-md border border-line bg-white px-2 py-2 text-sm">
                {["trial", "starter", "growth", "enterprise", "lifetime"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm text-graphite">Plan / trial ends
              <Input type="date" value={planExpiresAt} onChange={(e) => setPlanExpiresAt(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm text-graphite">AI budget (USD / month)
              <Input type="number" min="0" step="0.01" value={aiBudget} onChange={(e) => setAiBudget(e.target.value)} placeholder="Platform default" />
            </label>
            <label className="space-y-1 text-sm text-graphite">Max locations (guidance)
              <Input type="number" min="1" value={maxLocations} onChange={(e) => setMaxLocations(e.target.value)} placeholder="Unlimited" />
            </label>
            <label className="space-y-1 text-sm text-graphite">Max members (enforced)
              <Input type="number" min="1" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} placeholder="Unlimited" />
            </label>
          </div>
          <label className="block space-y-1 text-sm text-graphite">Admin note (only super admins see this)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-md border border-line px-2 py-2 text-sm" />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-graphite">Feature flags</legend>
            {Object.entries(FLAG_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-graphite">
                <input type="checkbox" checked={flags[key] !== false} onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })} />
                {label} <span className="text-xs text-slate">(off blocks the tenant&apos;s cron/API use where enforced)</span>
              </label>
            ))}
          </fieldset>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>{saving ? "Saving…" : "Save settings"}</Button>
            <Button type="button" variant="outline" loading={viewing} onClick={supportView}>View as tenant (read-only)</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
