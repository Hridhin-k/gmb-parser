"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GoogleConnectionCard } from "@/components/google-connection-card";
import { PageHeader } from "@/components/page-header";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import {
  matchCsvGroups,
  parseGroupCsv,
  stepUnlocked,
  type OnboardingStep,
} from "@/lib/onboarding";
import type { OnboardingView } from "@/lib/services/onboarding";
import { cn } from "@/lib/utils";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "connect", label: "Connect Google" },
  { id: "import", label: "Import locations" },
  { id: "groups", label: "Confirm groups" },
  { id: "tone", label: "Reply tone" },
  { id: "invite", label: "Invite the team" },
];

interface OnboardingWizardProps {
  data: OnboardingView;
  requestedStep: string | null;
  notice: string | null;
  connected: boolean;
  canInviteAdmin: boolean;
}

function isStep(value: string | null): value is OnboardingStep {
  return STEPS.some((step) => step.id === value);
}

function verificationLabel(location: OnboardingView["locations"][number]): string {
  if (location.voiceOfMerchant === true) return "Verified with Google";
  if (location.voiceOfMerchant === false) return "Unverified";
  if (location.accountUnverified) return "Verification not returned yet. The Google account is unverified.";
  return "Verification not returned yet";
}

function holdLabel(location: OnboardingView["locations"][number]): string | null {
  if (location.holdReason === "duplicate") {
    return location.googleDuplicateOf
      ? "Google marked this as a duplicate. Automatic drafts stay off."
      : "This matches another profile. Automatic drafts stay off.";
  }
  if (location.holdReason === "unverified") {
    return "Unverified profiles stay out of automatic grouping and drafts.";
  }
  return null;
}

export function OnboardingWizard({
  data,
  requestedStep,
  notice,
  connected,
  canInviteAdmin,
}: OnboardingWizardProps) {
  const router = useRouter();
  const unlockView = {
    step: data.step,
    connections: data.connections.length,
    locations: data.locations.length,
    grouping: data.grouping,
    toneVoice: data.toneVoice,
  };
  const step =
    isStep(requestedStep) && stepUnlocked(requestedStep, unlockView)
      ? requestedStep
      : data.step === "done"
        ? "invite"
        : data.step === "connect" ||
            data.step === "import" ||
            data.step === "groups" ||
            data.step === "tone" ||
            data.step === "invite"
          ? data.step
          : "connect";

  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; body: Record<string, unknown> } | null>(
    null
  );

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        if (payload.code === "CONFIRM_REQUIRED" && payload.error) {
          setConfirm({ message: payload.error, body });
          return;
        }
        throw new Error(payload.error ?? "Could not save that change.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that change.");
    } finally {
      setBusy(false);
    }
  }

  async function go(next: OnboardingStep) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "progress", step: next }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save your place in setup.");
      router.push(`/onboarding?step=${next}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your place in setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setup"
        description="Connect Google, import locations, confirm groups, set a reply tone, and invite the team. Progress is saved if you leave."
      >
        <Link
          href="/overview"
          className="text-sm font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink"
        >
          Leave and finish later
        </Link>
      </PageHeader>

      <ol className="flex gap-2 overflow-x-auto pb-1">
        {STEPS.map((item, index) => {
          const open = stepUnlocked(item.id, unlockView);
          const current = item.id === step;
          const className = cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-sm",
            current ? "border-ink bg-ink text-white" : "border-silver bg-white text-graphite",
            !open && "opacity-50"
          );
          return (
            <li key={item.id}>
              {open ? (
                <Link href={`/onboarding?step=${item.id}`} className={className} aria-current={current ? "step" : undefined}>
                  {index + 1}. {item.label}
                </Link>
              ) : (
                <span className={className}>
                  {index + 1}. {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {connected && step === "import" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Google account connected. Import the locations it can access.
        </p>
      ) : null}
      {data.completed ? (
        <p className="rounded-xl border border-silver bg-white px-4 py-3 text-sm text-slate">
          Setup was finished. Changes here are saved again when you confirm them.
        </p>
      ) : null}

      {step === "connect" ? (
        <section className="space-y-4">
          <GoogleConnectionCard
            connections={data.connections}
            connectHref="/api/google/connect?next=/onboarding"
            initialMessage={notice}
            initialSuccess={connected}
          />
          <p className="text-sm text-slate">
            GRM asks Google for access. It never asks for the Google password, and the tokens stay on the server.
          </p>
          <Button type="button" disabled={data.connections.length === 0 || busy} onClick={() => go("import")}>
            Continue to locations
          </Button>
        </section>
      ) : null}

      {step === "import" ? <ImportStep data={data} busy={busy} onContinue={() => go("groups")} /> : null}
      {step === "groups" ? <GroupsStep data={data} busy={busy} onRun={run} onContinue={() => go("tone")} /> : null}
      {step === "tone" ? <ToneStep data={data} busy={busy} onRun={run} onContinue={() => go("invite")} /> : null}
      {step === "invite" ? (
        <InviteStep data={data} busy={busy} canInviteAdmin={canInviteAdmin} />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Confirm this change"
        description={confirm?.message ?? ""}
        confirmLabel="Confirm"
        pendingLabel="Saving…"
        tone="danger"
        onConfirm={async () => {
          if (!confirm) return;
          const body =
            confirm.body.action === "move-location"
              ? { ...confirm.body, confirmHold: true }
              : { ...confirm.body, confirm: true };
          setConfirm(null);
          await run(body);
        }}
      />
    </div>
  );
}

function ImportStep({
  data,
  busy,
  onContinue,
}: {
  data: OnboardingView;
  busy: boolean;
  onContinue: () => void;
}) {
  const connection = data.connections.find((item) => item.status === "active") ?? data.connections[0];
  return (
    <section className="space-y-4">
      {connection ? (
        <SyncLocationsButton connectionId={connection.id} label="Import locations" />
      ) : (
        <p className="text-sm text-slate">Connect a Google account before importing locations.</p>
      )}
      <p className="text-sm text-slate">
        Only profiles this Google connection can access are imported. Existing client links are kept.
      </p>
      <LocationTable locations={data.locations} />
      <Button type="button" disabled={data.locations.length === 0 || busy} onClick={onContinue}>
        Continue to groups
      </Button>
    </section>
  );
}

function LocationTable({ locations }: { locations: OnboardingView["locations"] }) {
  if (!locations.length) {
    return <p className="text-sm text-slate">No locations imported yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-silver bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-silver text-xs uppercase tracking-[0.08em] text-slate">
          <tr>
            <th className="px-4 py-3 font-medium">Location</th>
            <th className="px-4 py-3 font-medium">Address</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-silver">
          {locations.map((location) => {
            const hold = holdLabel(location);
            return (
              <tr key={location.id}>
                <td className="px-4 py-3 align-top">
                  <p className="font-medium text-graphite">{location.title}</p>
                  <p className="mt-1 text-xs text-slate">
                    {location.clientName ?? "No client yet"}
                    {location.groupName ? ` · ${location.groupName}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 align-top text-slate">{location.address ?? "No address returned"}</td>
                <td className="px-4 py-3 align-top">
                  <p>{verificationLabel(location)}</p>
                  {hold ? <p className="mt-1 text-xs text-slate">{hold}</p> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupsStep({
  data,
  busy,
  onRun,
  onContinue,
}: {
  data: OnboardingView;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onContinue: () => void;
}) {
  const [mode, setMode] = useState<"state_city" | "city" | "account" | "none">(
    data.grouping === "city" || data.grouping === "account" || data.grouping === "none"
      ? data.grouping
      : "state_city"
  );
  const [name, setName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const preview = csvText
    ? matchCsvGroups(
        parseGroupCsv(csvText),
        data.locations.map((location) => ({
          id: location.id,
          title: location.title,
          holdReason: location.holdReason,
        }))
      )
    : null;

  return (
    <section className="space-y-6">
      <div className="space-y-3 rounded-xl bg-white p-4 shadow-card">
        <p className="text-sm text-slate">
          City and state are guessed from the address Google returned. Confirm before replacing groups.
          Unverified and duplicate profiles are left out.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["state_city", "State and city"],
              ["city", "City only"],
              ["account", "Google account"],
              ["none", "No groups"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={mode === value ? "default" : "outline"}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          disabled={busy || data.locations.length === 0}
          onClick={() => onRun({ action: "grouping", mode })}
        >
          Apply this grouping
        </Button>
      </div>

      <div className="space-y-3 rounded-xl bg-white p-4 shadow-card">
        <p className="text-sm font-medium text-graphite">CSV grouping</p>
        <p className="text-sm text-slate">Use a header row of location,group. Names must match one location.</p>
        <Input
          type="file"
          accept=".csv,text/csv"
          aria-label="Group CSV"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setCsvName(file?.name ?? "");
            setCsvText(file ? await file.text() : "");
          }}
        />
        {preview ? (
          <div className="space-y-1 text-sm text-slate">
            <p>
              {csvName}: {preview.groups.length} groups, {preview.heldIds.length} held back,{" "}
              {preview.errors.length} problems.
            </p>
            {preview.errors.slice(0, 5).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={busy || !csvText || Boolean(preview?.errors.length)}
          onClick={() => onRun({ action: "csv", csv: csvText })}
        >
          Apply CSV
        </Button>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void onRun({ action: "create-group", name: name.trim() }).then(() => setName(""));
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New group name"
          aria-label="New group name"
          maxLength={120}
        />
        <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
          Create group
        </Button>
      </form>

      <GroupList data={data} busy={busy} onRun={onRun} />
      <Button type="button" disabled={busy || data.grouping == null} onClick={onContinue}>
        Continue to reply tone
      </Button>
    </section>
  );
}

function GroupList({
  data,
  busy,
  onRun,
}: {
  data: OnboardingView;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [mergeTarget, setMergeTarget] = useState<{ sourceId: string; targetId: string; source: string; target: string } | null>(
    null
  );
  if (!data.groups.length) {
    return <p className="text-sm text-slate">No groups yet.</p>;
  }
  return (
    <div className="space-y-3">
      {data.groups.map((group) => (
        <GroupRow
          key={group.id}
          group={group}
          groups={data.groups}
          busy={busy}
          onRun={onRun}
          onMerge={(targetId, targetName) =>
            setMergeTarget({ sourceId: group.id, targetId, source: group.name, target: targetName })
          }
        />
      ))}
      <div className="overflow-x-auto rounded-xl border border-silver bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-silver text-xs uppercase tracking-[0.08em] text-slate">
            <tr>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Group</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-silver">
            {data.locations.map((location) => (
              <tr key={location.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-graphite">{location.title}</p>
                  {location.holdReason ? (
                    <p className="mt-1 text-xs text-slate">
                      {location.holdReason === "duplicate" ? "Suspected duplicate" : "Unverified"} — drafts stay off
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <SelectField
                    label={`Group for ${location.title}`}
                    value={location.groupId ?? ""}
                    options={[
                      { value: "", label: "No group" },
                      ...data.groups.map((group) => ({ value: group.id, label: group.name })),
                    ]}
                    onValueChange={(value) => {
                      const nextGroup = value || null;
                      if (nextGroup === (location.groupId ?? null)) return;
                      void onRun({
                        action: "move-location",
                        locationId: location.id,
                        groupId: nextGroup,
                      });
                    }}
                    disabled={busy}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMergeTarget(null);
        }}
        title="Merge groups"
        description={
          mergeTarget
            ? `Move every location from ${mergeTarget.source} into ${mergeTarget.target}, then remove ${mergeTarget.source}.`
            : ""
        }
        confirmLabel="Merge"
        pendingLabel="Merging…"
        tone="danger"
        onConfirm={async () => {
          if (!mergeTarget) return;
          const body = {
            action: "merge-groups",
            sourceId: mergeTarget.sourceId,
            targetId: mergeTarget.targetId,
          };
          setMergeTarget(null);
          await onRun(body);
        }}
      />
    </div>
  );
}

function GroupRow({
  group,
  groups,
  busy,
  onRun,
  onMerge,
}: {
  group: OnboardingView["groups"][number];
  groups: OnboardingView["groups"];
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onMerge: (targetId: string, targetName: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const others = groups.filter((item) => item.id !== group.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-silver bg-white p-4 lg:flex-row lg:items-end">
      <form
        className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || name.trim() === group.name) return;
          void onRun({ action: "rename-group", groupId: group.id, name: name.trim() });
        }}
      >
        <div className="min-w-0 flex-1">
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={`Rename ${group.name}`} maxLength={120} />
          <p className="mt-1 text-xs text-slate">
            {group.locationCount} {group.locationCount === 1 ? "location" : "locations"} · {group.source}
          </p>
        </div>
        <Button type="submit" variant="outline" disabled={busy || !name.trim() || name.trim() === group.name}>
          Rename
        </Button>
      </form>
      {others.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <SelectField
            label={`Merge ${group.name} into`}
            value={target}
            options={others.map((item) => ({ value: item.id, label: item.name }))}
            onValueChange={setTarget}
            disabled={busy}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !target}
            onClick={() => {
              const match = others.find((item) => item.id === target);
              if (match) onMerge(match.id, match.name);
            }}
          >
            Merge
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ToneStep({
  data,
  busy,
  onRun,
  onContinue,
}: {
  data: OnboardingView;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onContinue: () => void;
}) {
  const [voice, setVoice] = useState<"warm" | "professional" | "brief">(data.toneVoice ?? "professional");
  const [note, setNote] = useState(data.toneNote);
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate">
        Draft replies use this voice. A location playbook still applies on top of it. Held profiles do not get drafts.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["warm", "Warm"],
            ["professional", "Professional"],
            ["brief", "Brief"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={voice === value ? "default" : "outline"}
            onClick={() => setVoice(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 500))}
        maxLength={500}
        rows={4}
        placeholder="Optional note, such as “never mention prices”."
        aria-label="Reply tone note"
        className="w-full rounded-lg border border-silver bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => onRun({ action: "tone", voice, note })}>
          Save tone
        </Button>
        <Button type="button" variant="outline" disabled={busy || !data.toneVoice} onClick={onContinue}>
          Continue to invites
        </Button>
      </div>
    </section>
  );
}

function InviteStep({
  data,
  busy,
  canInviteAdmin,
}: {
  data: OnboardingView;
  busy: boolean;
  canInviteAdmin: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"org_admin" | "member">("member");
  const [message, setMessage] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/workspace/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Could not create the invite.");
      return;
    }
    setEmail("");
    setMessage("Invite saved. Copy it from Team — no email is sent.");
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-slate">
        Invites cover the whole workspace. Organization admin and member are the roles available here. No email is
        sent; the person joins the next time they sign in with that Google address. Invites expire after 14 days.
      </p>
      <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
          aria-label="Email address"
        />
        {canInviteAdmin ? (
          <SelectField
            label="Role"
            value={role}
            options={[
              { value: "member", label: "Member" },
              { value: "org_admin", label: "Organization admin" },
            ]}
            onValueChange={(value) => setRole(value === "org_admin" ? "org_admin" : "member")}
          />
        ) : null}
        <Button type="submit">Invite</Button>
      </form>
      {message ? <p className="text-sm text-slate">{message}</p> : null}
      {data.invites.length > 0 ? (
        <ul className="divide-y divide-silver overflow-hidden rounded-xl border border-silver bg-white">
          {data.invites.map((invite) => (
            <li key={invite.id} className="px-4 py-3 text-sm">
              <span className="text-graphite">{invite.email}</span>
              <span className="ml-2 text-slate">
                {invite.role === "org_admin" || invite.role === "admin"
                  ? "Organization admin"
                  : "Member"}{" "}
                · expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate">No pending invites. You can finish and invite people later from Team.</p>
      )}
      <Button
        type="button"
        disabled={busy || finishing}
        onClick={async () => {
          setFinishing(true);
          setMessage(null);
          try {
            const response = await fetch("/api/onboarding", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "complete" }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) {
              setMessage(payload.error ?? "Could not finish setup.");
              return;
            }
            router.push("/overview");
            router.refresh();
          } catch {
            setMessage("Could not finish setup.");
          } finally {
            setFinishing(false);
          }
        }}
      >
        Finish setup
      </Button>
    </section>
  );
}
