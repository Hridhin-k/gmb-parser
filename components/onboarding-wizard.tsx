"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ExternalLink } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GoogleConnectionCard } from "@/components/google-connection-card";
import { SyncLocationsButton } from "@/components/sync-locations-button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import {
  matchCsvGroups,
  parseGroupCsv,
  stepUnlocked,
  type OnboardingStep,
} from "@/lib/onboarding";
import type { OnboardingView } from "@/lib/services/onboarding";
import { roleName, roleSummary } from "@/lib/ui/vocabulary";
import { cn } from "@/lib/utils";

const STEPS: { id: OnboardingStep; label: string; optional: boolean }[] = [
  { id: "connect", label: "Connect Google", optional: false },
  { id: "import", label: "Import and check", optional: false },
  { id: "groups", label: "Organise", optional: true },
  { id: "tone", label: "Reply tone", optional: true },
  { id: "invite", label: "Invite team", optional: true },
];

const CONNECT_HREF = "/api/google/connect?next=/onboarding";

type Location = OnboardingView["locations"][number];

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

function stepComplete(id: OnboardingStep, data: OnboardingView): boolean {
  if (id === "connect") return data.connections.length > 0;
  if (id === "import") return data.locations.length > 0;
  if (id === "groups") return data.grouping != null;
  if (id === "tone") return data.toneVoice != null;
  return data.completed;
}

function verificationBadge(location: Location): { label: string; variant: "ok" | "warn" | "default"; detail?: string } {
  if (location.voiceOfMerchant === true) return { label: "Verified", variant: "ok" };
  if (location.voiceOfMerchant === false) return { label: "Unverified", variant: "warn" };
  if (location.accountUnverified) {
    return {
      label: "Not returned yet",
      variant: "default",
      detail: "Verification not returned yet. The Google account is unverified.",
    };
  }
  return { label: "Not returned yet", variant: "default", detail: "Verification not returned yet" };
}

function holdLabel(location: Location): string | null {
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
  const showDone = requestedStep === "done" && data.completed;
  const step: OnboardingStep =
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

  const index = STEPS.findIndex((item) => item.id === step);
  const previous = index > 0 ? STEPS[index - 1] : null;

  return (
    <div className="space-y-5">
      <OnboardingTopBar data={data} current={showDone ? "done" : step} unlockView={unlockView} />

      {error ? (
        <Banner
          tone="bad"
          title={notice && error === notice ? "Google did not finish connecting." : "That didn't save."}
          actions={
            notice && error === notice ? (
              <a href={CONNECT_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Connect again
              </a>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setError(null)}>
                Dismiss
              </Button>
            )
          }
        >
          {error}
        </Banner>
      ) : null}
      {connected && step === "import" && !showDone ? (
        <Banner tone="ok" title="Google account connected.">
          Import the locations it can access.
        </Banner>
      ) : null}
      {data.completed && !showDone ? (
        <Banner tone="neutral">Setup was finished. Changes here are saved again when you confirm them.</Banner>
      ) : null}

      {showDone ? <CompleteStep data={data} /> : null}

      {!showDone && step === "connect" ? (
        <StepFrame
          index={0}
          title={data.localDemo ? "Connect a demo account" : "Connect the Google account that manages your profiles"}
          description={data.localDemo
            ? "Start with a sample account. Your workspace stays empty until you import a location in the next step."
            : "Google asks you to pick the account and approve access. You stay signed in here as yourself."}
          footer={
            <StepFooter
              primary={
                <Button type="button" disabled={data.connections.length === 0 || busy} onClick={() => go("import")}>
                  Continue to locations
                </Button>
              }
              hint={data.connections.length === 0 ? "Connect an account to continue" : undefined}
            />
          }
          aside={
            data.localDemo ? (
              <AsideCard title="Your fresh demo">
                <p>One account, one location and six sample reviews. Add them as you move through setup.</p>
                <p>No cases, escalations or team members are preloaded. No Google account is needed.</p>
              </AsideCard>
            ) : <>
              <AsideCard title="What Google is asked for">
                <p>
                  One permission: <b className="font-medium text-ink">manage your Business Profiles</b>. It is used to
                  list locations, read reviews and post the replies you approve.
                </p>
                <p>Never asked for: your Google password, Gmail, Drive or Ads. Tokens stay on the server.</p>
              </AsideCard>
              <AsideCard title="Can't see your locations after connecting?">
                <p>
                  Only an account with Owner or Manager access on a Business Profile can import it. The next step lists
                  anything held back and why.
                </p>
              </AsideCard>
            </>
          }
        >
          {data.localDemo ? (
            <div className="space-y-3">
              {data.connections.length ? (
                <Banner tone="ok" title="Demo account connected.">Continue to import your first location.</Banner>
              ) : (
                <Button type="button" loading={busy} onClick={() => run({ action: "demo-connect" })}>
                  Connect demo account
                </Button>
              )}
              <p className="text-xs text-ink-3">This is a sample connection. Google sync and publishing stay off.</p>
            </div>
          ) : <GoogleConnectionCard
            connections={data.connections}
            connectHref={CONNECT_HREF}
            initialMessage={null}
            initialSuccess={connected}
          />}
        </StepFrame>
      ) : null}

      {!showDone && step === "import" ? (
        <ImportStep data={data} busy={busy} previous={previous?.id ?? null} onContinue={() => go("groups")}
          onDemoImport={() => run({ action: "demo-import" })} />
      ) : null}
      {!showDone && step === "groups" ? (
        <GroupsStep data={data} busy={busy} onRun={run} onSkip={() => go("tone")} onContinue={() => go("tone")} />
      ) : null}
      {!showDone && step === "tone" ? (
        <ToneStep data={data} busy={busy} onRun={run} onSkip={() => go("invite")} onContinue={() => go("invite")} />
      ) : null}
      {!showDone && step === "invite" ? (
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

/* ---------- Frame ---------- */

function OnboardingTopBar({
  data,
  current,
  unlockView,
}: {
  data: OnboardingView;
  current: OnboardingStep | "done";
  unlockView: Parameters<typeof stepUnlocked>[1];
}) {
  const doneCount = STEPS.filter((item) => stepComplete(item.id, data)).length;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-white px-4 py-2.5 lg:flex-row lg:items-center lg:gap-5">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-ink">Setup</h1>
          <p className="text-xs text-ink-3">
            {doneCount} of {STEPS.length} steps done · progress is saved
          </p>
        </div>
        <Link href="/overview" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "lg:hidden")}>
          Save and finish later
        </Link>
      </div>
      <ol className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 pb-0.5 lg:justify-center-safe" aria-label="Setup steps">
        {STEPS.map((item, position) => {
          const open = stepUnlocked(item.id, unlockView);
          const isCurrent = item.id === current;
          const complete = stepComplete(item.id, data) && !isCurrent;
          const content = (
            <>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  isCurrent
                    ? "border-brand bg-brand text-white"
                    : complete
                      ? "border-ok-line bg-ok-tint text-ok"
                      : "border-line bg-white text-ink-3"
                )}
                aria-hidden
              >
                {complete ? <Check className="size-3" /> : position + 1}
              </span>
              <span className="whitespace-nowrap">{item.label}</span>
              {complete ? <span className="sr-only">(done)</span> : null}
            </>
          );
          const className = cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
            isCurrent ? "font-semibold text-ink" : complete ? "text-ink-2" : "text-ink-3",
            open && !isCurrent && "hover:bg-paper",
            !open && "cursor-not-allowed opacity-60"
          );
          return (
            <li key={item.id} className="flex shrink-0 items-center gap-1">
              {position > 0 ? <span className="h-px w-3 bg-line" aria-hidden /> : null}
              {open ? (
                <Link href={`/onboarding?step=${item.id}`} className={className} aria-current={isCurrent ? "step" : undefined}>
                  {content}
                </Link>
              ) : (
                <span className={className} title="Finish the earlier steps first">
                  {content}
                </span>
              )}
            </li>
          );
        })}
        <li className="flex shrink-0 items-center gap-1">
          <span className="h-px w-3 bg-line" aria-hidden />
          {data.completed ? (
            <Link
              href="/onboarding?step=done"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-paper",
                current === "done" ? "font-semibold text-ink" : "text-ink-2"
              )}
              aria-current={current === "done" ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border",
                  current === "done" ? "border-brand bg-brand text-white" : "border-ok-line bg-ok-tint text-ok"
                )}
                aria-hidden
              >
                <Check className="size-3" />
              </span>
              Done
            </Link>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-ink-3 opacity-60">
              <span className="flex size-5 items-center justify-center rounded-full border border-line" aria-hidden>
                <Check className="size-3" />
              </span>
              Done
            </span>
          )}
        </li>
      </ol>
      <Link href="/overview" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden shrink-0 lg:inline-flex")}>
        Save and finish later
      </Link>
    </div>
  );
}

function StepFrame({
  index,
  title,
  description,
  children,
  footer,
  aside,
}: {
  index: number;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  aside?: ReactNode;
}) {
  const meta = STEPS[index];
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-w-0 flex-col gap-5 rounded-lg border border-line bg-white p-4 sm:p-6" aria-labelledby="onboarding-step-title">
        <header className="space-y-1.5">
          <p className="text-xs text-ink-3">
            Step {index + 1} of {STEPS.length} · {meta?.optional ? "optional" : "required"}
          </p>
          <h2 id="onboarding-step-title" className="text-xl font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          <p className="max-w-2xl text-[13px] text-ink-3">{description}</p>
        </header>
        {children}
        {footer}
      </section>
      {aside ? <aside className="flex flex-col gap-3">{aside}</aside> : null}
    </div>
  );
}

function StepFooter({
  back,
  skip,
  primary,
  hint,
}: {
  back?: OnboardingStep | null;
  skip?: ReactNode;
  primary: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {back ? (
          <Link href={`/onboarding?step=${back}`} className={buttonVariants({ variant: "ghost" })}>
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
        {skip}
        {primary}
      </div>
    </div>
  );
}

function AsideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-white p-4 text-xs text-ink-3">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {children}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-2">{label}</span>
      {children}
    </div>
  );
}

/* ---------- Step 2: import and eligibility ---------- */

function ImportStep({
  data,
  busy,
  previous,
  onContinue,
  onDemoImport,
}: {
  data: OnboardingView;
  busy: boolean;
  previous: OnboardingStep | null;
  onContinue: () => void;
  onDemoImport: () => void;
}) {
  const connection = data.connections.find((item) => item.status === "active") ?? data.connections[0];
  const unhealthy = data.localDemo ? [] : data.connections.filter((item) => item.status !== "active");
  const duplicates = data.locations.filter((location) => location.holdReason === "duplicate");
  const unverifiedHeld = data.locations.filter((location) => location.holdReason === "unverified");
  const pending = data.locations.filter((location) => !location.holdReason && location.voiceOfMerchant == null);
  const ready = data.locations.filter((location) => !location.holdReason && location.voiceOfMerchant === true);
  const held = duplicates.length + unverifiedHeld.length;
  const accounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const location of data.locations) {
      counts.set(location.accountName, (counts.get(location.accountName) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.locations]);

  const count = data.locations.length;
  return (
    <StepFrame
      index={1}
      title={count ? `${count} ${count === 1 ? "location" : "locations"} imported` : "Import the locations this account manages"}
      description={data.localDemo
        ? "Import Willow & Oak — High Street and six sample reviews. Cases and escalations stay empty."
        : "Only profiles the connected Google account can access are imported. Existing business links are kept. Check anything held back before you continue."}
      footer={
        <StepFooter
          back={previous}
          hint={count === 0 ? "Import at least one location to continue" : undefined}
          primary={
            <Button type="button" disabled={count === 0 || busy} onClick={onContinue}>
              Continue to organise
            </Button>
          }
        />
      }
      aside={
        <>
          <AsideCard title="Import summary">
            <div className="space-y-2 pt-1">
              <SummaryRow label="Ready">
                <Badge variant="ok">{ready.length}</Badge>
              </SummaryRow>
              <SummaryRow label="Verification not returned yet">
                <Badge variant="default">{pending.length}</Badge>
              </SummaryRow>
              <SummaryRow label="Held · unverified">
                <Badge variant={unverifiedHeld.length ? "warn" : "default"}>{unverifiedHeld.length}</Badge>
              </SummaryRow>
              <SummaryRow label="Held · possible duplicate">
                <Badge variant={duplicates.length ? "warn" : "default"}>{duplicates.length}</Badge>
              </SummaryRow>
            </div>
          </AsideCard>
          {accounts.length > 0 ? (
            <AsideCard title="By Google account">
              <div className="space-y-2 pt-1">
                {accounts.map(([name, total]) => (
                  <SummaryRow key={name} label={name || "Unnamed account"}>
                    <span className="tabular-nums text-ink-2">{total}</span>
                  </SummaryRow>
                ))}
              </div>
            </AsideCard>
          ) : null}
          <AsideCard title="Why some locations are held">
            <p>
              <b className="font-medium text-ink">Unverified</b>: Google hasn&apos;t verified the profile. It stays out of
              automatic grouping and drafts.
            </p>
            <p>
              <b className="font-medium text-ink">Possible duplicate</b>: it matches another profile. Automatic drafts stay
              off so reviews aren&apos;t answered twice.
            </p>
          </AsideCard>
        </>
      }
    >
      {unhealthy.length > 0 ? (
        <Banner
          tone="warn"
          title="A Google connection needs attention."
          actions={
            <a href={CONNECT_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ExternalLink className="size-3.5" aria-hidden />
              Reconnect
            </a>
          }
        >
          {unhealthy.map((item) => item.google_email).join(", ")} can&apos;t sync until it is connected again.
        </Banner>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-ink-3">
          {connection ? (
            <>
              Importing from <b className="font-medium text-ink">{connection.google_email}</b>. Run it again any time to pick up
              new profiles.
            </>
          ) : (
            "Connect a Google account before importing locations."
          )}
        </div>
        {connection && data.localDemo ? (
          <Button type="button" loading={busy} disabled={count > 0} onClick={onDemoImport}>
            {count ? "Demo location imported" : "Import demo location"}
          </Button>
        ) : connection ? (
          <SyncLocationsButton connectionId={connection.id} label={count ? "Import again" : "Import locations"} />
        ) : (
          <Link href="/onboarding?step=connect" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Connect Google
          </Link>
        )}
      </div>

      {connection && count === 0 && !data.localDemo ? (
        <Banner tone="info" title="Nothing imported yet.">
          If the import finds no locations, the connected account probably isn&apos;t an Owner or Manager on any Business
          Profile. Connect a different account from the previous step.
        </Banner>
      ) : null}

      {held > 0 ? (
        <Banner
          tone="warn"
          title={`Imported with ${held} ${held === 1 ? "location" : "locations"} held back.`}
          actions={
            <Link href="/locations" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open Locations
            </Link>
          }
        >
          {count - held} {count - held === 1 ? "is" : "are"} ready to organise. Held locations are still imported, but
          automatic drafts stay off until they are verified or the duplicate is resolved. You can continue now.
        </Banner>
      ) : null}

      <LocationTable locations={data.locations} />
    </StepFrame>
  );
}

function LocationTable({ locations }: { locations: OnboardingView["locations"] }) {
  const [query, setQuery] = useState("");
  const [onlyHeld, setOnlyHeld] = useState(false);
  if (!locations.length) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
        <p className="text-[13px] font-medium text-ink">No locations imported yet</p>
        <p className="mt-1 text-xs text-ink-3">Run the import above. Locations appear here as soon as Google returns them.</p>
      </div>
    );
  }
  const needle = query.trim().toLowerCase();
  const rows = locations.filter((location) => {
    if (onlyHeld && !location.holdReason) return false;
    if (!needle) return true;
    return [location.title, location.address ?? "", location.clientName ?? "", location.groupName ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const heldCount = locations.filter((location) => location.holdReason).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, address or business"
          aria-label="Search imported locations"
          className="min-w-0 flex-1 sm:max-w-xs"
        />
        {heldCount > 0 ? (
          <Button type="button" size="sm" variant={onlyHeld ? "secondary" : "outline"} aria-pressed={onlyHeld} onClick={() => setOnlyHeld(!onlyHeld)}>
            Needs attention · {heldCount}
          </Button>
        ) : null}
        <span className="text-xs text-ink-3">
          {rows.length === locations.length ? `${locations.length} locations` : `${rows.length} of ${locations.length}`}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-line bg-paper text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-xs text-ink-3">
                  No locations match.{" "}
                  <button
                    type="button"
                    className="font-medium text-brand hover:underline"
                    onClick={() => {
                      setQuery("");
                      setOnlyHeld(false);
                    }}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : null}
            {rows.map((location) => {
              const hold = holdLabel(location);
              const verification = verificationBadge(location);
              return (
                <tr key={location.id} className={location.holdReason ? "bg-warn-tint/40" : undefined}>
                  <td className="px-3 py-2.5 align-top">
                    <p className="font-medium text-ink">{location.title}</p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {location.clientName ?? "No business yet"}
                      {location.groupName ? ` · ${location.groupName}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-top text-ink-3">{location.address ?? "No address returned"}</td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={verification.variant} title={verification.detail}>
                        {verification.label}
                      </Badge>
                      {location.holdReason === "duplicate" ? <Badge variant="warn">Possible duplicate</Badge> : null}
                      {location.holdReason === "unverified" ? <Badge variant="warn">Held</Badge> : null}
                    </div>
                    {hold ? <p className="mt-1 text-xs text-ink-3">{hold}</p> : null}
                    {!hold && verification.detail ? <p className="mt-1 text-xs text-ink-3">{verification.detail}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Step 3: organise ---------- */

const GROUPING_OPTIONS = [
  ["state_city", "State and city", "Guessed from the address Google returned."],
  ["city", "City only", "One group per city."],
  ["account", "Google account", "One group per Google account."],
  ["none", "No groups", "Keep every location ungrouped."],
] as const;

function GroupsStep({
  data,
  busy,
  onRun,
  onSkip,
  onContinue,
}: {
  data: OnboardingView;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onSkip: () => void;
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
    <StepFrame
      index={2}
      title={`Organise ${data.locations.length} ${data.locations.length === 1 ? "location" : "locations"} into groups`}
      description="Groups (regions, brands, franchisees) let managers see only their stores and let you scope any page in one click. Recommended for more than 20 locations."
      footer={
        <StepFooter
          back="import"
          hint={data.grouping == null ? "Apply a grouping, or skip and do it later" : undefined}
          skip={
            data.grouping == null ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
                Skip for now
              </Button>
            ) : null
          }
          primary={
            <Button type="button" disabled={busy || data.grouping == null} onClick={onContinue}>
              Continue to reply tone
            </Button>
          }
        />
      }
      aside={
        <>
          <AsideCard title="Why this matters">
            <p>
              A manager invited later can be limited to one group. Reply settings can be set per business or group and are
              inherited by every location underneath.
            </p>
          </AsideCard>
          <AsideCard title="Change it later">
            <p>
              Groups can be renamed, merged and reassigned from{" "}
              <Link href="/locations" className="font-medium text-brand hover:underline">
                Locations
              </Link>
              . Nothing here is permanent.
            </p>
          </AsideCard>
        </>
      }
    >
      <div className="space-y-3">
        <Banner tone="info" title="Suggested grouping.">
          City and state are guessed from the address Google returned, so you&apos;ll confirm before groups are replaced.
          Unverified and duplicate profiles are left out. Nothing is sent to an AI provider for this step.
        </Banner>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-medium text-ink-2">Group locations by</legend>
          {GROUPING_OPTIONS.map(([value, label, hint]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3",
                mode === value ? "border-brand bg-brand-tint" : "border-line bg-white hover:bg-paper"
              )}
            >
              <input
                type="radio"
                name="grouping-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-0.5 accent-brand"
              />
              <span>
                <span className="block text-[13px] font-medium text-ink">
                  {label}
                  {data.grouping === value ? <span className="ml-1.5 text-xs font-normal text-ok">· applied</span> : null}
                </span>
                <span className="block text-xs text-ink-3">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button
          type="button"
          disabled={busy || data.locations.length === 0}
          onClick={() => onRun({ action: "grouping", mode })}
        >
          Apply this grouping
        </Button>
      </div>

      <details className="group rounded-lg border border-line">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium text-ink marker:hidden">
          Upload groups from a CSV
          <span className="ml-1.5 text-xs font-normal text-ink-3">Header row: location,group</span>
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          <p className="text-xs text-ink-3">Each location name must match exactly one imported location.</p>
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
            <div className="space-y-1 text-xs text-ink-3">
              <p>
                <b className="font-medium text-ink">{csvName}</b>: {preview.groups.length} groups, {preview.heldIds.length}{" "}
                held back, {preview.errors.length} problems.
              </p>
              {preview.errors.slice(0, 5).map((item) => (
                <p key={item} className="text-bad">
                  {item}
                </p>
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
      </details>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            Groups <span className="font-normal text-ink-3">· {data.groups.length}</span>
          </h3>
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
      </div>
    </StepFrame>
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
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
        <p className="text-[13px] font-medium text-ink">No groups yet</p>
        <p className="mt-1 text-xs text-ink-3">Apply a grouping above or create one by name.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-lg border border-line">
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
      </ul>
      <details className="rounded-lg border border-line" open={data.locations.length <= 20}>
        <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-medium text-ink">
          Move individual locations
          <span className="ml-1.5 text-xs font-normal text-ink-3">· {data.locations.length}</span>
        </summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-line bg-paper text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="w-[240px] px-3 py-2 font-medium">Group</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.locations.map((location) => (
                <tr key={location.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink">{location.title}</p>
                    {location.holdReason ? (
                      <p className="mt-0.5 text-xs text-warn">
                        {location.holdReason === "duplicate" ? "Suspected duplicate" : "Unverified"} — drafts stay off
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <SelectField
                      label={`Group for ${location.title}`}
                      value={location.groupId ?? ""}
                      size="sm"
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
      </details>
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
    <li className="flex flex-col gap-3 p-3 lg:flex-row lg:items-start">
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
          <p className="mt-1 text-xs text-ink-3">
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
            className="sm:w-48"
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
    </li>
  );
}

/* ---------- Step 4: reply tone ---------- */

const VOICES = [
  ["warm", "Warm", "Friendly, first names, light on formality."],
  ["professional", "Professional", "Courteous and neutral."],
  ["brief", "Brief", "Two or three sentences: thanks, action, sign-off."],
] as const;

function ToneStep({
  data,
  busy,
  onRun,
  onSkip,
  onContinue,
}: {
  data: OnboardingView;
  busy: boolean;
  onRun: (body: Record<string, unknown>) => Promise<void>;
  onSkip: () => void;
  onContinue: () => void;
}) {
  const [voice, setVoice] = useState<"warm" | "professional" | "brief">(data.toneVoice ?? "professional");
  const [note, setNote] = useState(data.toneNote);
  const dirty = voice !== data.toneVoice || note !== data.toneNote;
  return (
    <StepFrame
      index={3}
      title="How should AI drafts sound?"
      description="Draft replies use this voice across the workspace. A location playbook still applies on top of it, and drafts are always reviewed by a person before publishing. Held profiles do not get drafts."
      footer={
        <StepFooter
          back="groups"
          skip={
            !data.toneVoice ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
                Skip for now
              </Button>
            ) : null
          }
          hint={dirty && data.toneVoice ? "Unsaved changes" : undefined}
          primary={
            dirty || !data.toneVoice ? (
              <Button type="button" disabled={busy} onClick={() => onRun({ action: "tone", voice, note })}>
                Save tone
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={onContinue}>
                Continue to invites
              </Button>
            )
          }
        />
      }
      aside={
        <AsideCard title="Fine-tune later">
          <p>
            Greeting, sign-off, reply languages, never-say rules and automation are in{" "}
            <Link href="/settings?section=tone" className="font-medium text-brand hover:underline">
              Settings › AI configuration
            </Link>
            , where a business, group or location can override the workspace voice.
          </p>
        </AsideCard>
      }
    >
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 text-xs font-medium text-ink-2">Tone</legend>
        {VOICES.map(([value, label, hint]) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-lg border p-3",
              voice === value ? "border-brand bg-brand-tint" : "border-line bg-white hover:bg-paper"
            )}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="tone-voice"
                value={value}
                checked={voice === value}
                onChange={() => setVoice(value)}
                className="accent-brand"
              />
              <span className="text-[13px] font-medium text-ink">{label}</span>
              {data.toneVoice === value ? <Badge variant="ok" className="ml-auto">Saved</Badge> : null}
            </span>
            <span className="text-xs text-ink-3">{hint}</span>
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-2">
          Always / never <span className="font-normal text-ink-3">(optional)</span>
        </span>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          maxLength={500}
          rows={4}
          placeholder="Optional note, such as “never mention prices”."
          aria-label="Reply tone note"
        />
        <span className="flex justify-between text-xs text-ink-3">
          <span>Plain-language instructions to the draft writer, not text that appears in replies.</span>
          <span className="tabular-nums">{note.length}/500</span>
        </span>
      </label>
    </StepFrame>
  );
}

/* ---------- Step 5: invite ---------- */

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
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [inviting, setInviting] = useState(false);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setInviting(true);
    try {
      const response = await fetch("/api/workspace/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage({ tone: "bad", text: payload.error ?? "Could not create the invite." });
        return;
      }
      setEmail("");
      setMessage({ tone: "ok", text: "Invite saved. Copy it from Team — no email is sent." });
      router.refresh();
    } finally {
      setInviting(false);
    }
  }

  async function finish() {
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
        setMessage({ tone: "bad", text: payload.error ?? "Could not finish setup." });
        return;
      }
      router.push("/onboarding?step=done");
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: "Could not finish setup." });
    } finally {
      setFinishing(false);
    }
  }

  const roles = canInviteAdmin ? (["member", "org_admin"] as const) : (["member"] as const);

  return (
    <StepFrame
      index={4}
      title="Invite the people who'll do the work"
      description="Invites cover the whole workspace. No email is sent; the person joins the next time they sign in with that Google address. Invites expire after 14 days."
      footer={
        <StepFooter
          back="tone"
          hint={data.invites.length === 0 ? "Invites are optional. You can add people later from Team." : undefined}
          primary={
            <Button type="button" loading={finishing} disabled={busy || finishing} onClick={finish}>
              Finish setup
            </Button>
          }
        />
      }
      aside={
        <AsideCard title="Roles available here">
          <div className="space-y-1.5 pt-1">
            {roles.map((item) => (
              <p key={item}>
                <b className="font-medium text-ink">{roleName(item)}</b> · {roleSummary(item)}
              </p>
            ))}
          </div>
          <p className="pt-1">
            Managers for a business, group or location are set later from{" "}
            <Link href="/team" className="font-medium text-brand hover:underline">
              Team
            </Link>
            .
          </p>
        </AsideCard>
      }
    >
      <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@company.com"
          aria-label="Email address"
          className="min-w-0 flex-1"
        />
        {canInviteAdmin ? (
          <SelectField
            label="Role"
            value={role}
            options={[
              { value: "member", label: roleName("member") },
              { value: "org_admin", label: roleName("org_admin") },
            ]}
            onValueChange={(value) => setRole(value === "org_admin" ? "org_admin" : "member")}
            className="sm:w-56"
          />
        ) : null}
        <Button type="submit" variant="outline" loading={inviting} disabled={inviting}>
          Add invite
        </Button>
      </form>
      {message ? (
        <Banner tone={message.tone} role={message.tone === "bad" ? "alert" : "status"}>
          {message.text}
        </Banner>
      ) : null}
      {data.invites.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead className="border-b border-line bg-paper text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.invites.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 text-ink">{item.email}</td>
                  <td className="px-3 py-2 text-ink-2">
                    {item.role === "org_admin" || item.role === "admin" ? "Admin" : "Member"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="info">Pending</Badge>
                    <span className="ml-2 text-xs text-ink-3">expires {new Date(item.expiresAt).toLocaleDateString()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-ink">No pending invites</p>
          <p className="mt-1 text-xs text-ink-3">You can finish now and invite people later from Team.</p>
        </div>
      )}
    </StepFrame>
  );
}

/* ---------- Done ---------- */

function CompleteStep({ data }: { data: OnboardingView }) {
  const held = data.locations.filter((location) => location.holdReason).length;
  const voice = VOICES.find(([value]) => value === data.toneVoice)?.[1] ?? null;
  const nextSteps = [
    {
      title: "Reply to your first reviews",
      detail: "Open the reviews waiting for a reply across your locations.",
      href: "/reviews",
      cta: "Open reviews",
      primary: true,
    },
    {
      title: "Check the escalation target",
      detail: "Complaints open an escalation with a due time. Review the rule and resolution contact.",
      href: "/settings?section=sla",
      cta: "Review SLAs",
      primary: false,
    },
    {
      title: "Schedule a report",
      detail: "Send a regular summary to the business owner.",
      href: "/reports",
      cta: "Open reports",
      primary: false,
    },
  ].filter((item) => !data.localDemo || item.primary);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex min-w-0 flex-col gap-5 rounded-lg border border-line bg-white p-4 sm:p-6" aria-labelledby="onboarding-done-title">
        <header className="space-y-2">
          <Badge variant="ok">Setup complete</Badge>
          <h2 id="onboarding-done-title" className="text-xl font-semibold tracking-[-0.01em] text-ink">
            Your workspace is ready
          </h2>
          <p className="text-[13px] text-ink-3">{data.localDemo
            ? "Your sample location and reviews are ready. Start by exploring the inbox."
            : "Reviews keep syncing in the background. Here's a sensible first hour."}</p>
        </header>
        <ul className="space-y-2">
          {nextSteps.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex flex-col gap-3 rounded-lg border border-line p-3 hover:bg-paper sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                  <span className="block text-xs text-ink-3">{item.detail}</span>
                </span>
                <span className={buttonVariants({ variant: item.primary ? "default" : "outline", size: "sm" })}>{item.cta}</span>
              </Link>
            </li>
          ))}
        </ul>
        <StepFooter
          back="invite"
          primary={
            <Link href="/overview" className={buttonVariants({ variant: "default" })}>
              Go to Overview
            </Link>
          }
        />
      </section>
      <aside className="flex flex-col gap-3">
        <AsideCard title="What you set up">
          <div className="space-y-2 pt-1">
            <SummaryRow label="Google accounts connected">
              <Badge variant={data.connections.length ? "ok" : "warn"}>{data.connections.length}</Badge>
            </SummaryRow>
            <SummaryRow label="Locations imported">
              <Badge variant={data.locations.length ? "ok" : "warn"}>{data.locations.length}</Badge>
            </SummaryRow>
            <SummaryRow label="Held back">
              {held ? (
                <Link href="/locations" className="text-xs font-medium text-warn hover:underline">
                  {held} · view
                </Link>
              ) : (
                <Badge variant="default">0</Badge>
              )}
            </SummaryRow>
            <SummaryRow label="Groups">
              <Badge variant="default">{data.groups.length}</Badge>
            </SummaryRow>
            <SummaryRow label="Reply tone">
              <Badge variant="default">{voice ?? "Not set"}</Badge>
            </SummaryRow>
            <SummaryRow label="Pending invites">
              <Badge variant="default">{data.invites.length}</Badge>
            </SummaryRow>
          </div>
        </AsideCard>
      </aside>
    </div>
  );
}
