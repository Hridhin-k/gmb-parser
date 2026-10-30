"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AdminCard } from "@/components/platform-admin-ui";
import type { TenantDetail } from "@/lib/services/platform";

const FLAG_LABELS: Record<string, { label: string; detail: string }> = {
  automation: { label: "Auto-reply automation cron", detail: "Enforced: off stops the tenant's automation cron." },
  requests: { label: "Review requests", detail: "Stored. Enforcement on campaign send is not built yet." },
  reports: { label: "Scheduled reports & alerts", detail: "Stored. Enforcement on report runs is not built yet." },
};

const PLANS = ["trial", "starter", "growth", "enterprise", "lifetime"];

async function send(url: string, method: string, body?: object) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

/** Enters the read-only support view. Styled amber so it can't be mistaken for a normal action. */
export function SupportViewButton({ tenantId, disabled }: { tenantId: string; disabled?: boolean }) {
  const router = useRouter();
  const [viewing, setViewing] = useState(false);
  async function supportView() {
    setViewing(true);
    try {
      await send(`/api/platform/tenants/${tenantId}/impersonate`, "POST");
      router.replace("/overview");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enter support view.");
      setViewing(false);
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      loading={viewing}
      disabled={disabled}
      title={disabled ? "Deleted tenants can't be viewed" : "Opens this workspace as its users see it. Every action is disabled."}
      onClick={supportView}
      className="border-[#f59e0b] bg-demo text-demo-ink hover:bg-[#fde68a]"
    >
      {viewing ? null : <Eye aria-hidden />}
      Open support view
      <Badge variant="readonly" className="h-[18px] px-1.5 text-[11px]">Read-only</Badge>
    </Button>
  );
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

  const planOptions = (PLANS.includes(plan) ? PLANS : [plan, ...PLANS]).map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
  const fieldLabel = "flex flex-col gap-1 text-xs font-medium text-ink-2";

  return (
    <AdminCard
      id="plan"
      title="Plan, limits & flags"
      description="Leave a limit blank for unlimited / platform default."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={fieldLabel}>
            <span>Plan</span>
            <SelectField id="tenant-plan" label="Plan" value={plan} onValueChange={setPlan} options={planOptions} />
          </div>
          <label className={fieldLabel}>Plan / trial ends
            <Input type="date" value={planExpiresAt} onChange={(e) => setPlanExpiresAt(e.target.value)} />
          </label>
          <label className={fieldLabel}>
            <span>AI budget (USD / month) <span className="font-normal text-ink-3">· enforced before AI calls</span></span>
            <Input type="number" min="0" step="0.01" value={aiBudget} onChange={(e) => setAiBudget(e.target.value)} placeholder="Platform default" />
          </label>
          <label className={fieldLabel}>
            <span>Max members <span className="font-normal text-ink-3">· enforced on team invites</span></span>
            <Input type="number" min="1" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} placeholder="Unlimited" />
          </label>
          <label className={fieldLabel}>
            <span>Max locations <span className="font-normal text-ink-3">· usage guidance only</span></span>
            <Input type="number" min="1" value={maxLocations} onChange={(e) => setMaxLocations(e.target.value)} placeholder="Unlimited" />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 rounded-md border border-line-2 p-3">
          <legend className="px-1 text-xs font-medium text-ink-2">Feature flags</legend>
          {Object.entries(FLAG_LABELS).map(([key, { label, detail }]) => (
            <label key={key} className="flex items-start gap-2.5 text-[13px] text-ink">
              <Checkbox className="mt-0.5" checked={flags[key] !== false} onCheckedChange={(checked) => setFlags({ ...flags, [key]: checked === true })} />
              <span>
                {label}
                <span className="block text-xs text-ink-3">{detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className={fieldLabel}>
          <span>Admin note <span className="font-normal text-ink-3">· only platform staff see this</span></span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />
        </label>
        {error ? <Banner tone="bad" title="Settings weren't saved.">{error}</Banner> : null}
        <div>
          <Button type="submit" loading={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </div>
      </form>
    </AdminCard>
  );
}

type TenantAction = "suspend" | "reactivate" | "delete" | "restore";

/** Status changes for one tenant, using the same endpoint as the tenants list. */
export function TenantActionsCard({ tenantId, name, status }: { tenantId: string; name: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<TenantAction | null>(null);
  const [confirm, setConfirm] = useState<"suspend" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: TenantAction) {
    setBusy(action);
    setError(null);
    try {
      await send(`/api/platform/tenants/${tenantId}`, "POST", { action });
      toast.success(
        action === "suspend" ? `${name} suspended` : action === "delete" ? `${name} deleted` : action === "restore" ? `${name} restored` : `${name} reactivated`
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminCard title="Tenant access" description="Status changes apply to every member at their next sign-in and are written to the audit log." tone="bad">
      <div className="flex flex-col divide-y divide-line-2 text-[13px]">
        {status === "active" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <span className="text-ink-2">Suspend tenant: members are blocked at sign-in, data is kept.</span>
            <Button type="button" variant="destructive" size="sm" loading={busy === "suspend"} onClick={() => setConfirm("suspend")}>Suspend…</Button>
          </div>
        ) : null}
        {status === "suspended" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <span className="text-ink-2">Reactivate tenant: members can sign in again.</span>
            <Button type="button" variant="outline" size="sm" loading={busy === "reactivate"} onClick={() => run("reactivate")}>Reactivate</Button>
          </div>
        ) : null}
        {status !== "deleted" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 first:pt-0">
            <span className="text-ink-2">Delete tenant: soft delete, restorable, all data retained.</span>
            <Button type="button" variant="destructive" size="sm" loading={busy === "delete"} onClick={() => setConfirm("delete")}>Delete…</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-2">This tenant is deleted. Restoring brings back sign-in with all data intact.</span>
            <Button type="button" variant="outline" size="sm" loading={busy === "restore"} onClick={() => run("restore")}>Restore</Button>
          </div>
        )}
      </div>
      {error ? <Banner tone="bad" className="mt-3">{error}</Banner> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm === "delete" ? `Delete ${name}?` : `Suspend ${name}?`}
        description={
          confirm === "delete"
            ? "This is a soft delete: the tenant disappears and nobody can sign in, but all data is retained and you can restore it later."
            : "Every member of this tenant will be blocked at sign-in. Data is kept and you can reactivate the tenant at any time."
        }
        confirmLabel={confirm === "delete" ? "Delete tenant" : "Suspend tenant"}
        pendingLabel="Working…"
        tone="danger"
        onConfirm={async () => { if (confirm) await run(confirm); }}
      />
    </AdminCard>
  );
}
