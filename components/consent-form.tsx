"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthCard } from "@/components/pub-shell";
import { cn } from "@/lib/utils";

export function ConsentForm() {
  const router = useRouter();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedAi, setAcceptedAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allAccepted = acceptedTerms && acceptedPrivacy && acceptedAi;
  const canContinue = allAccepted && !loading;
  const remaining = [acceptedTerms, acceptedPrivacy, acceptedAi].filter((v) => !v).length;

  async function handleAccept() {
    if (!allAccepted) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/account/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: true, ai: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not save your agreement.");
        setLoading(false);
        return;
      }
      router.replace("/overview");
      router.refresh();
    } catch {
      setError("Could not save your agreement.");
      setLoading(false);
    }
  }

  return (
    <AuthCard className="max-w-[640px] gap-5 sm:p-9">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-ink-3">Asked once for this Google account</span>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Before you open RevuPilot</h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          Plain-language summaries first; the full documents are linked. Later sign-ins go straight to your workspace.
        </p>
      </div>

      {error ? (
        <Banner tone="bad" title="Not saved.">
          {error}
        </Banner>
      ) : null}

      <div className="flex flex-col gap-3">
        <ConsentItem
          id="consent-terms"
          checked={acceptedTerms}
          onChange={setAcceptedTerms}
          title="Terms of Service"
          disabled={loading}
        >
          Connect and reply only for businesses you&apos;re allowed to represent. Nothing reaches Google until a
          person publishes an approved reply.{" "}
          <a href="/terms" className="text-brand hover:underline">Read the terms</a>
        </ConsentItem>
        <ConsentItem
          id="consent-privacy"
          checked={acceptedPrivacy}
          onChange={setAcceptedPrivacy}
          title="Privacy Policy"
          disabled={loading}
        >
          We store synced reviews, drafts, approvals and the audit log for as long as the workspace exists. We
          don&apos;t sell personal information.{" "}
          <a href="/privacy" className="text-brand hover:underline">Read the policy</a>
        </ConsentItem>
        <ConsentItem
          id="consent-ai"
          checked={acceptedAi}
          onChange={setAcceptedAi}
          title="AI processing of reviews"
          ai
          disabled={loading}
        >
          RevuPilot can send review text to the configured AI provider to draft a reply or a location summary. A
          person must review a draft before it is published, and a published reply appears on Google as the
          business&apos;s reply.
        </ConsentItem>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <SignOutButton
          label="Decline and sign out"
          className="inline-flex h-[34px] items-center justify-center rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-paper hover:text-ink disabled:opacity-50"
        />
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {!allAccepted ? (
            <span className="text-[13px] text-ink-3" aria-live="polite">
              Tick {remaining === 3 ? "all three" : `${remaining} more`} to continue
            </span>
          ) : null}
          <Button
            onClick={() => {
              void handleAccept();
            }}
            disabled={!canContinue}
            loading={loading}
            title={allAccepted ? undefined : "Agree to the three items above to continue"}
          >
            {loading ? "Saving…" : "Agree and continue"}
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}

function ConsentItem({
  id,
  checked,
  onChange,
  title,
  ai = false,
  disabled,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  ai?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3.5 rounded-lg border bg-white p-4 transition-colors",
        ai ? "border-ai-line" : "border-line",
        checked && !ai && "border-brand-line bg-brand-tint/40"
      )}
    >
      <Checkbox
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value)}
        aria-describedby={`${id}-detail`}
        aria-label={`Agree to: ${title}`}
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-sm font-semibold text-ink">{title}</b>
          {ai ? <Badge variant="ai">AI</Badge> : null}
        </span>
        <span id={`${id}-detail`} className="text-[13px] leading-relaxed text-ink-3">
          {children}
        </span>
      </span>
    </label>
  );
}
