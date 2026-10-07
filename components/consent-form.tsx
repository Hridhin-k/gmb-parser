"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function ConsentForm() {
  const router = useRouter();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedAi, setAcceptedAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canContinue = acceptedTerms && acceptedAi && !loading;

  async function handleAccept() {
    if (!acceptedTerms || !acceptedAi) return;
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
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Could not save your agreement.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-xl bg-white shadow-card px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
            G
          </div>
          <h1
            className="mt-5 text-[28px] leading-[1.2] text-graphite sm:text-[31px]"
            style={{ fontFamily: "var(--font-heading), sans-serif" }}
          >
            Before you open GRM
          </h1>
          <p className="mt-2 text-sm font-light leading-relaxed text-slate sm:text-base">
            This is asked once for this Google account. Later sign-ins go
            straight to your workspace.
          </p>
        </div>

        {error && (
          <div
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mb-5 space-y-3">
          <label className="flex items-start gap-3 text-sm leading-snug text-graphite">
            <Checkbox
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(checked)}
              aria-label="Agree to the Terms of Service and Privacy Policy"
            />
            <span>
              I agree to the{" "}
              <a href="/terms" className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm leading-snug text-graphite">
            <Checkbox
              checked={acceptedAi}
              onCheckedChange={(checked) => setAcceptedAi(checked)}
              aria-label="Agree to AI draft processing"
            />
            <span>
              I understand GRM can send review text to Google Gemini to draft
              a reply or a location summary. A person must review a draft
              before it is published, and a published reply appears on Google
              as the business’s reply.
            </span>
          </label>
        </div>

        <Button
          onClick={() => {
            void handleAccept();
          }}
          disabled={!canContinue}
          loading={loading}
          className="w-full"
          size="lg"
        >
          {loading ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
