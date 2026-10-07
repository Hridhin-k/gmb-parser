"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
      <div className="rounded-3xl border border-[#dadce0] bg-white px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a73e8] text-sm font-bold text-white">
            G
          </div>
          <h1
            className="mt-5 text-[28px] leading-[1.2] tracking-[-0.032em] text-[#202124] sm:text-[31px]"
            style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
          >
            Before you open GRM
          </h1>
          <p className="mt-2 text-sm font-light leading-relaxed text-[#5f6368] sm:text-base">
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
          <label className="flex items-start gap-3 text-sm leading-snug text-[#202124]">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 size-4 shrink-0 rounded border-[#dadce0]"
            />
            <span>
              I agree to the{" "}
              <a href="/terms" className="font-medium text-[#1a73e8]">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="font-medium text-[#1a73e8]">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm leading-snug text-[#202124]">
            <input
              type="checkbox"
              checked={acceptedAi}
              onChange={(event) => setAcceptedAi(event.target.checked)}
              className="mt-1 size-4 shrink-0 rounded border-[#dadce0]"
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
          className="w-full"
          size="lg"
        >
          {loading ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
