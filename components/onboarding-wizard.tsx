"use client";

import { syncGoogleConnections } from "@/lib/google-profile-sync-client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Globe,
  MapPin,
  PenLine,
  RefreshCw,
  Search,
  Sparkles,
  UsersRound,
  MessageSquareText,
  Network,
} from "lucide-react";
import { GoogleMark } from "@/components/google-connection-card";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BrandProfile } from "@/lib/brand-profile";
import type { OnboardingView } from "@/lib/services/onboarding";
import { cn } from "@/lib/utils";

/**
 * Setup in three screens: tell us about the business, connect Google and pick
 * locations, done. Everything else (groups, reply tone, team) lives in the app.
 */

export interface OnboardingWizardProps {
  data: OnboardingView;
  requestedStep: string | null;
  notice: string | null;
  connected: boolean;
}

type FlowStep = "brand" | "connect" | "done";

const FLOW: Array<{ id: FlowStep; label: string }> = [
  { id: "brand", label: "Your business" },
  { id: "connect", label: "Locations" },
  { id: "done", label: "Ready" },
];

const CONNECT_HREF = "/api/google/connect?next=/onboarding";

type Post = (body: Record<string, unknown>) => Promise<boolean>;

export function OnboardingWizard({ data, requestedStep, notice, connected }: OnboardingWizardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  const step: FlowStep =
    requestedStep === "done" && data.completed
      ? "done"
      : requestedStep === "brand" || requestedStep === "connect"
        ? requestedStep
        : connected
          ? "connect"
          : data.completed
            ? "done"
            : data.step === "brand"
              ? "brand"
              : "connect";

  const post: Post = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save that change.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that change.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function goTo(next: "brand" | "connect") {
    if (await post({ action: "progress", step: next })) {
      router.push(`/onboarding?step=${next}`);
      router.refresh();
    }
  }

  async function finish() {
    if (await post({ action: "complete" })) {
      router.push("/onboarding?step=done");
      router.refresh();
    }
  }

  async function importAndFinish(body: Record<string, unknown>) {
    if (await post(body)) await finish();
  }

  async function restart() {
    if (await post({ action: "restart" })) {
      router.push("/onboarding?step=brand");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-2 sm:py-6">
      <Stepper current={step} />

      {error ? (
        <Banner
          tone="bad"
          role="alert"
          title={notice && error === notice ? "Google did not finish connecting." : "That didn't work."}
          actions={
            notice && error === notice ? (
              <a href={CONNECT_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Try again
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

      <div key={step} className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500">
        {step === "brand" ? <BrandStep data={data} busy={busy} onContinue={() => goTo("connect")} /> : null}
        {step === "connect" ? (
          <LocationsStep
            data={data}
            busy={busy}
            post={post}
            onBack={() => goTo("brand")}
            onFinish={finish}
            onImportAndFinish={importAndFinish}
          />
        ) : null}
        {step === "done" ? <DoneStep data={data} busy={busy} onRestart={restart} /> : null}
      </div>
    </div>
  );
}

/* ---------- Progress ---------- */

function Stepper({ current }: { current: FlowStep }) {
  const index = FLOW.findIndex((item) => item.id === current);
  return (
    <ol className="flex items-center" aria-label="Setup progress">
      {FLOW.map((item, position) => {
        const complete = position < index || current === "done";
        const active = position === index && current !== "done";
        const last = position === FLOW.length - 1;
        return (
          <li key={item.id} className={cn("flex items-center", !last && "flex-1")} aria-current={active ? "step" : undefined}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-500",
                  complete
                    ? "border-brand bg-brand text-white"
                    : active
                      ? "border-brand bg-white text-brand ring-4 ring-brand-tint"
                      : "border-line bg-white text-ink-3"
                )}
              >
                {complete ? <Check className="size-3.5 animate-in zoom-in duration-300" aria-hidden /> : position + 1}
              </span>
              <span className={cn("hidden text-xs font-medium sm:block", active || complete ? "text-ink" : "text-ink-3")}>
                {item.label}
              </span>
            </span>
            {!last ? (
              <span className="mx-3 h-0.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                <span
                  className="block h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
                  style={{ width: position < index || current === "done" ? "100%" : "0%" }}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Card({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="space-y-6 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8" aria-labelledby="setup-title">
      <header className="space-y-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-brand-tint text-brand">{icon}</span>
        <div className="space-y-1.5">
          <h1 id="setup-title" className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h1>
          <p className="max-w-lg text-sm text-ink-3">{description}</p>
        </div>
      </header>
      {children}
      {footer ? <div className="flex flex-col-reverse gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-between">{footer}</div> : null}
    </section>
  );
}

/* ---------- 1. Your business ---------- */

const EMPTY_BRAND: BrandProfile = { summary: "", offerings: [], customerVocabulary: [], staffRoles: [], themeHints: [] };

const BRAND_LISTS: Array<{ key: Exclude<keyof BrandProfile, "summary">; label: string; hint: string }> = [
  { key: "offerings", label: "What it offers", hint: "One per line" },
  { key: "customerVocabulary", label: "Words customers use", hint: "Phrases likely to appear in reviews" },
  { key: "staffRoles", label: "Staff roles", hint: "Job titles customers deal with" },
  { key: "themeHints", label: "What customers care about", hint: "Hints, not a fixed list" },
];

const toLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

async function brandCall(body: object) {
  const response = await fetch("/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; profile?: BrandProfile | null; pages?: string[] };
  if (!response.ok) throw new Error(payload.error ?? "Something went wrong. Please try again.");
  return payload;
}

function hostOf(value: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`).hostname;
  } catch {
    return value.trim();
  }
}

function BrandStep({ data, busy, onContinue }: { data: OnboardingView; busy: boolean; onContinue: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"website" | "manual">(data.brandSource === "manual" && !data.website ? "manual" : "website");
  const [website, setWebsite] = useState(data.website);
  const [profile, setProfile] = useState<BrandProfile>(data.brandProfile ?? EMPTY_BRAND);
  const [drafted, setDrafted] = useState(false);
  const [version, setVersion] = useState(0);
  const [work, setWork] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasProfile = Boolean(profile.summary.trim() || BRAND_LISTS.some((list) => profile[list.key].length));
  const needsRead = mode === "website" && website.trim().length > 0 && !hasProfile;
  const working = work !== null || busy;

  async function read() {
    setWork("read");
    setError(null);
    try {
      const result = await brandCall({ action: "brand-draft", website });
      setProfile(result.profile ?? EMPTY_BRAND);
      setDrafted(true);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that website.");
    } finally {
      setWork(null);
    }
  }

  async function saveAndContinue() {
    setWork("save");
    setError(null);
    try {
      await brandCall({
        action: "brand-save",
        website: mode === "website" ? website : "",
        profile: hasProfile ? profile : null,
        source: mode === "manual" ? "manual" : drafted || data.brandSource === "website" ? "website" : "manual",
      });
      router.refresh();
      onContinue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the details.");
    } finally {
      setWork(null);
    }
  }

  const primary = (
    <Button
      type="button"
      size="lg"
      loading={work !== null}
      disabled={working}
      onClick={() => void (needsRead ? read() : saveAndContinue())}
    >
      {work === "read" ? "Reading your website…" : needsRead ? "Read my website" : "Continue"}
      {work === null ? <ArrowRight aria-hidden /> : null}
    </Button>
  );

  return (
    <Card
      icon={<Sparkles className="size-5" aria-hidden />}
      title="Tell us about your business"
      description="A few lines about what you do helps us understand your reviews in your own words. It takes under a minute."
      footer={
        <>
          <span />
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button type="button" variant="ghost" disabled={working} onClick={onContinue}>
              Skip for now
            </Button>
            {primary}
          </div>
        </>
      }
    >
      <div className="space-y-5">
        <div role="radiogroup" aria-label="How to describe your business" className="grid grid-cols-2 gap-2 rounded-xl bg-paper p-1">
          {(
            [
              { id: "website", label: "From my website", icon: <Globe className="size-4" aria-hidden /> },
              { id: "manual", label: "I'll describe it", icon: <PenLine className="size-4" aria-hidden /> },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              disabled={working}
              onClick={() => setMode(option.id)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-brand-line",
                mode === option.id ? "bg-white text-ink shadow-sm" : "text-ink-3 hover:text-ink"
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        {error ? (
          <Banner tone="bad" role="alert">
            {error}
          </Banner>
        ) : null}

        {mode === "website" ? (
          <div className="space-y-4 animate-in fade-in duration-300">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">Your website</span>
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input
                  value={website}
                  onChange={(event) => {
                    setWebsite(event.target.value);
                    if (drafted) setDrafted(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && needsRead && !working) {
                      event.preventDefault();
                      void read();
                    }
                  }}
                  placeholder="example.com"
                  inputMode="url"
                  autoComplete="url"
                  autoFocus
                  className="h-11 pl-9"
                />
              </div>
            </label>

            {work === "read" ? (
              <div className="space-y-2.5 rounded-xl border border-line bg-paper p-4" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Sparkles className="size-4 animate-pulse text-brand" aria-hidden />
                  Reading {hostOf(website)}…
                </p>
                <div className="space-y-2 animate-pulse" aria-hidden>
                  <div className="h-3 w-11/12 rounded bg-line" />
                  <div className="h-3 w-9/12 rounded bg-line" />
                  <div className="h-3 w-10/12 rounded bg-line" />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "manual" || (hasProfile && work !== "read") ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {drafted ? (
              <Banner tone="ok" title="Here's what we understood.">
                Fix anything that isn&apos;t right. This is only used to read your reviews more accurately.
              </Banner>
            ) : null}
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">{mode === "manual" ? "What does your business do?" : "About your business"}</span>
              <Textarea
                key={`summary:${version}`}
                defaultValue={profile.summary}
                rows={4}
                maxLength={800}
                placeholder="For example: A family-run bakery in Leeds selling bread, cakes and coffee, with a small seating area."
                onChange={(event) => setProfile((current) => ({ ...current, summary: event.target.value }))}
              />
            </label>
            <details className="group rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink-2 hover:text-ink">
                More details
                <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-4 border-t border-line-2 p-4">
                {BRAND_LISTS.map((list) => (
                  <label key={list.key} className="block space-y-1.5 text-sm">
                    <span className="font-medium text-ink">{list.label}</span>
                    <span className="ml-2 text-xs text-ink-3">{list.hint}</span>
                    <Textarea
                      key={`${list.key}:${version}`}
                      defaultValue={profile[list.key].join("\n")}
                      rows={3}
                      onChange={(event) => setProfile((current) => ({ ...current, [list.key]: toLines(event.target.value) }))}
                    />
                  </label>
                ))}
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ---------- 2. Google locations ---------- */

function holdText(reason: "duplicate" | "unverified"): string {
  return reason === "duplicate" ? "Possible duplicate · replies off" : "Unverified · replies off";
}

function LocationsStep({
  data,
  busy,
  post,
  onBack,
  onFinish,
  onImportAndFinish,
}: {
  data: OnboardingView;
  busy: boolean;
  post: Post;
  onBack: () => void;
  onFinish: () => void;
  onImportAndFinish: (body: Record<string, unknown>) => Promise<void>;
}) {
  const router = useRouter();
  const activeConnections = data.connections.filter((item) => item.status === "active");
  const connection = activeConnections[0] ?? data.connections[0] ?? null;
  const demo = Boolean(data.localDemo);
  const imported = data.locations;
  const initial = imported.length === 0;

  const autoLookup = Boolean(connection) && !demo && data.available.length === 0 && imported.length === 0;
  const [finding, setFinding] = useState(autoLookup);
  const [findError, setFindError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const autoRan = useRef(false);

  // Everything Google verified starts ticked; the user only unticks what they do not want.
  const signature = data.available.map((location) => location.id).join(",");
  const defaults = new Set(
    initial ? data.available.filter((location) => location.voiceOfMerchant !== false).map((location) => location.id) : []
  );
  const [override, setOverride] = useState<{ signature: string; ids: Set<string> } | null>(null);
  const picked = override && override.signature === signature ? override.ids : defaults;
  const setPicked = (ids: Set<string>) => setOverride({ signature, ids });

  async function lookup(force: boolean) {
    try {
      if (!activeConnections.length) throw new Error("Reconnect a Google account before looking for profiles.");
      const results = await syncGoogleConnections(activeConnections.map((item) => item.id), { force, stage: true });
      const failures = results.filter((item) => item.error);
      if (failures.length) setFindError(failures.map((item) => `${data.connections.find((connection) => connection.id === item.connectionId)?.google_email ?? "Google account"}: ${item.error}`).join(" "));
      setSearched(true);
      router.refresh();
    } catch (caught) {
      setFindError(caught instanceof Error ? caught.message : "Could not look for your profiles.");
    } finally {
      setFinding(false);
    }
  }

  function find(force: boolean) {
    if (!connection) return;
    setFinding(true);
    setFindError(null);
    void lookup(force);
  }

  useEffect(() => {
    if (!autoLookup || autoRan.current) return;
    autoRan.current = true;
    void lookup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = [...picked].filter((id) => data.available.some((location) => location.id === id));
  const importCount = chosen.length;
  const showPicker = Boolean(connection) && !finding && data.available.length > 0;
  const nothingFound = Boolean(connection) && !finding && !demo && data.available.length === 0 && imported.length === 0;

  let primary: ReactNode;
  if (demo && connection && initial) {
    primary = (
      <Button type="button" size="lg" loading={busy} onClick={() => void onImportAndFinish({ action: "demo-import" })}>
        Import demo location
        <ArrowRight aria-hidden />
      </Button>
    );
  } else if (initial) {
    primary = (
      <Button
        type="button"
        size="lg"
        loading={busy}
        disabled={importCount === 0 || finding}
        onClick={() => void onImportAndFinish({ action: "import-locations", locationIds: chosen })}
      >
        {importCount > 0 ? `Import ${importCount} ${importCount === 1 ? "location" : "locations"}` : "Pick a location"}
        {importCount > 0 ? <ArrowRight aria-hidden /> : null}
      </Button>
    );
  } else {
    primary = (
      <Button type="button" size="lg" loading={busy} onClick={onFinish}>
        Finish setup
        <ArrowRight aria-hidden />
      </Button>
    );
  }

  return (
    <Card
      icon={<MapPin className="size-5" aria-hidden />}
      title={connection ? (initial ? "Choose your locations" : "Your locations") : "Connect your Google account"}
      description={
        connection
          ? initial
            ? "These are the Business Profiles your Google account manages. Everything Google has verified is already ticked."
            : "These are connected. You can finish now, or add more profiles below."
          : "Sign in with the Google account that manages your Business Profiles. We only ask to read reviews and post the replies you approve."
      }
      footer={
        <>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className={cn(buttonVariants({ variant: "ghost" }), "justify-start")}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{connection ? primary : null}</div>
        </>
      }
    >
      {!connection ? (
        <div className="space-y-3 animate-in fade-in duration-300">
          {demo ? (
            <Button type="button" size="lg" loading={busy} onClick={() => void post({ action: "demo-connect" }).then((ok) => ok && router.refresh())}>
              Connect demo account
            </Button>
          ) : (
            <a href={CONNECT_HREF} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full justify-center gap-3 sm:w-auto")}>
              <GoogleMark />
              Continue with Google
            </a>
          )}
          <p className="text-xs text-ink-3">
            {demo
              ? "This is a sample connection. Google sync and publishing stay off."
              : "Never asked for: your password, Gmail, Drive or Ads. Only an Owner or Manager of a Business Profile can import it."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok-line bg-ok-tint px-3.5 py-2.5 text-sm animate-in fade-in duration-300">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <Check className="size-4 shrink-0 text-ok" aria-hidden />
              <span className="truncate">
                {activeConnections.length > 1 ? `${activeConnections.length} Google accounts connected` : <>Connected as <b className="font-medium">{connection.google_email}</b></>}
              </span>
            </span>
            {!demo ? (
              <a href={CONNECT_HREF} className="text-xs font-medium text-brand hover:underline">
                Connect another account
              </a>
            ) : null}
          </div>

          {connection.status !== "active" && !demo ? (
            <Banner tone="warn" title="This connection needs attention.">
              Google stopped accepting it.{" "}
              <a href={CONNECT_HREF} className="font-medium underline">
                Connect again
              </a>
              .
            </Banner>
          ) : null}

          {findError ? (
            <Banner
              tone="bad"
              role="alert"
              actions={
                <Button type="button" size="sm" variant="outline" onClick={() => find(true)}>
                  Try again
                </Button>
              }
            >
              {findError}
            </Banner>
          ) : null}

          {finding ? <Finding /> : null}

          {imported.length > 0 ? <ImportedList locations={imported} /> : null}

          {showPicker ? (
            <Picker
              available={data.available}
              picked={picked}
              setPicked={setPicked}
              heading={initial ? `We found ${data.available.length} ${data.available.length === 1 ? "profile" : "profiles"}` : `${data.available.length} more ${data.available.length === 1 ? "profile" : "profiles"} found`}
              action={
                initial ? null : (
                  <Button
                    type="button"
                    size="sm"
                    loading={busy}
                    disabled={importCount === 0}
                    onClick={() => void post({ action: "import-locations", locationIds: chosen }).then((ok) => ok && router.refresh())}
                  >
                    Add {importCount || ""} selected
                  </Button>
                )
              }
            />
          ) : null}

          {nothingFound ? (
            <div className="space-y-3 rounded-xl border border-line bg-paper p-5 text-sm animate-in fade-in duration-300">
              <p className="font-medium text-ink">{searched ? "Google didn't list any profiles for this account." : "No profiles found yet."}</p>
              <p className="text-ink-3">
                Only an account that is an Owner or Manager of a Business Profile can import it. Try the account that manages your
                profiles.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => find(true)}>
                  <RefreshCw aria-hidden />
                  Search again
                </Button>
                <a href={CONNECT_HREF} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Connect another account
                </a>
              </div>
            </div>
          ) : null}

          {imported.length > 0 && !finding && !demo ? (
            <button
              type="button"
              onClick={() => find(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
            >
              <RefreshCw className="size-3" aria-hidden />
              Look for new profiles
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function Finding() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-line bg-paper px-4 py-8 text-center animate-in fade-in zoom-in-95 duration-500" role="status" aria-live="polite">
      <span className="relative flex size-14 items-center justify-center">
        <span className="onb-ring absolute inset-0 rounded-full bg-brand/25" />
        <span className="onb-ring absolute inset-0 rounded-full bg-brand/25 [animation-delay:0.9s]" />
        <span className="relative flex size-14 items-center justify-center rounded-full bg-brand text-white">
          <Search className="size-6" aria-hidden />
        </span>
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">Looking for your Business Profiles…</p>
        <p className="text-xs text-ink-3">This usually takes a few seconds.</p>
      </div>
      <div className="w-full max-w-sm space-y-2 animate-pulse" aria-hidden>
        <div className="h-10 rounded-lg bg-line/70" />
        <div className="h-10 rounded-lg bg-line/50" />
      </div>
    </div>
  );
}

function Picker({
  available,
  picked,
  setPicked,
  heading,
  action,
}: {
  available: OnboardingView["available"];
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  heading: string;
  action: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = available.filter(
    (location) => !needle || `${location.title} ${location.address ?? ""}`.toLowerCase().includes(needle)
  );
  const allPicked = rows.length > 0 && rows.every((row) => picked.has(row.id));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  function toggleAll() {
    const next = new Set(picked);
    for (const row of rows) {
      if (allPicked) next.delete(row.id);
      else next.add(row.id);
    }
    setPicked(next);
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{heading}</p>
          <p className="text-xs text-ink-3">{picked.size} selected</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
            {allPicked ? "Clear all" : needle ? "Select matches" : "Select all"}
          </Button>
          {action}
        </div>
      </div>
      {available.length > 8 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or address"
            aria-label="Search profiles"
            className="pl-9"
          />
        </div>
      ) : null}
      <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5">
        {rows.map((location, position) => {
          const on = picked.has(location.id);
          return (
            <li
              key={location.id}
              className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
              style={{ animationDelay: `${Math.min(position, 12) * 40}ms` }}
            >
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-200",
                  on ? "border-brand bg-brand-tint/60 shadow-sm" : "border-line bg-white hover:border-brand-line hover:bg-paper"
                )}
              >
                <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(location.id)} />
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-line",
                    on ? "border-brand bg-brand text-white" : "border-line bg-white"
                  )}
                  aria-hidden
                >
                  {on ? <Check className="size-3.5 animate-in zoom-in duration-200" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{location.title}</span>
                  <span className="block truncate text-xs text-ink-3">{location.address ?? "No address returned"}</span>
                </span>
                {location.voiceOfMerchant === false ? <Badge variant="warn">Unverified</Badge> : null}
              </label>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="px-3 py-6 text-center text-xs text-ink-3">No profiles match.</li> : null}
      </ul>
    </div>
  );
}

function ImportedList({ locations }: { locations: OnboardingView["locations"] }) {
  const shown = locations.slice(0, 6);
  return (
    <div className="space-y-2 animate-in fade-in duration-300">
      <p className="text-sm font-semibold text-ink">
        {locations.length} {locations.length === 1 ? "location" : "locations"} imported
      </p>
      <ul className="space-y-2">
        {shown.map((location, position) => (
          <li
            key={location.id}
            className="flex items-center gap-3 rounded-xl border border-ok-line bg-ok-tint/40 px-3.5 py-2.5 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
            style={{ animationDelay: `${position * 50}ms` }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-white" aria-hidden>
              <Check className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{location.title}</span>
              {location.address ? <span className="block truncate text-xs text-ink-3">{location.address}</span> : null}
            </span>
            {location.holdReason ? <Badge variant="warn">{holdText(location.holdReason)}</Badge> : null}
          </li>
        ))}
      </ul>
      {locations.length > shown.length ? <p className="text-xs text-ink-3">and {locations.length - shown.length} more</p> : null}
    </div>
  );
}

/* ---------- 3. Done ---------- */

function DoneStep({ data, busy, onRestart }: { data: OnboardingView; busy: boolean; onRestart: () => void }) {
  const count = data.locations.length;
  const held = data.locations.filter((location) => location.holdReason).length;
  const later = [
    { title: "Set a reply tone", detail: "Warm, professional or brief. Drafts follow it.", href: "/settings", icon: <MessageSquareText className="size-4" aria-hidden /> },
    { title: "Invite your team", detail: "Give managers and staff access.", href: "/team", icon: <UsersRound className="size-4" aria-hidden /> },
    { title: "Group your locations", detail: "By city or region, once you have many.", href: "/locations", icon: <Network className="size-4" aria-hidden /> },
  ].filter(() => !data.localDemo);

  return (
    <section className="space-y-7 rounded-2xl border border-line bg-white p-6 text-center shadow-sm sm:p-10" aria-labelledby="setup-title">
      <div className="flex flex-col items-center gap-4">
        <span className="relative flex size-20 items-center justify-center">
          <span className="onb-ring absolute inset-0 rounded-full bg-ok/25" />
          <span className="onb-pop relative flex size-20 items-center justify-center rounded-full bg-ok text-white">
            <svg viewBox="0 0 24 24" className="onb-check size-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </span>
        <div className="space-y-1.5 animate-in fade-in slide-in-from-bottom-2 fill-mode-both delay-300 duration-500">
          <h1 id="setup-title" className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            You&apos;re all set
          </h1>
          <p className="mx-auto max-w-md text-sm text-ink-3">
            {count > 0
              ? `${count} ${count === 1 ? "location is" : "locations are"} connected. Open Reviews to bring in your reviews and start replying.`
              : "Your workspace is ready."}
          </p>
          {held > 0 ? (
            <p className="mx-auto max-w-md text-xs text-warn">
              {held} {held === 1 ? "profile has" : "profiles have"} replies switched off until Google verifies {held === 1 ? "it" : "them"}.{" "}
              <Link href="/locations" className="font-medium underline">
                See which
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-center animate-in fade-in slide-in-from-bottom-2 fill-mode-both delay-500 duration-500">
        <Link href="/reviews" className={cn(buttonVariants({ size: "lg" }), "min-w-48 justify-center")}>
          Go to Reviews
          <ArrowRight aria-hidden />
        </Link>
      </div>

      {later.length > 0 ? (
        <div className="space-y-2.5 border-t border-line-2 pt-6 text-left animate-in fade-in fill-mode-both delay-700 duration-500">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">When you have a minute</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {later.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex h-full flex-col gap-1.5 rounded-xl border border-line p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-line hover:shadow-sm"
                >
                  <span className="flex size-7 items-center justify-center rounded-lg bg-paper text-ink-2 transition-colors group-hover:bg-brand-tint group-hover:text-brand">
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium text-ink">{item.title}</span>
                  <span className="text-xs text-ink-3">{item.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onRestart}
        disabled={busy}
        className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
      >
        Run setup again
      </button>
    </section>
  );
}
