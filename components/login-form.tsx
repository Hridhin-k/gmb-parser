"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { GoogleMark } from "@/components/google-mark";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-xl bg-white shadow-card px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
            G
          </div>
          <h1
            className="mt-5 text-[31px] leading-[1.2] text-graphite"
            style={{ fontFamily: "var(--font-heading), sans-serif" }}
          >
            Sign in to GRM
          </h1>
          <p className="mt-2 text-base font-light text-slate">
            Then connect the Google account that manages your businesses.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
            Unable to sign in. {error}
          </div>
        )}

        <Button
          onClick={handleSignIn}
          loading={loading}
          className="w-full gap-2"
          size="lg"
        >
          <GoogleMark />
          {loading ? "Redirecting to Google…" : "Continue with Google"}
        </Button>
        <p className="mt-4 text-sm leading-relaxed text-slate">
          The first time you sign in, you’ll confirm the{" "}
          <Link href="/terms" className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink">
            Privacy Policy
          </Link>
          , including how AI drafts are used. That step is saved to your account.
        </p>
      </div>

      <p className="mt-5 text-sm text-slate">
        <Link href="/" className="font-medium text-ink underline decoration-stone/50 underline-offset-4 hover:decoration-ink">
          Back to GRM
        </Link>
      </p>
    </div>
  );
}
