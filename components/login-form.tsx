"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

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
      <div className="rounded-3xl border border-[#dadce0] bg-white px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a73e8] text-sm font-bold text-white">
            G
          </div>
          <h1
            className="mt-5 text-[31px] leading-[1.2] tracking-[-0.032em] text-[#202124]"
            style={{ fontFamily: "var(--font-google-sans-display), sans-serif" }}
          >
            Sign in to GRM
          </h1>
          <p className="mt-2 text-base font-light text-[#5f6368]">
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
          disabled={loading}
          className="w-full gap-2"
          size="lg"
        >
          {/* Google icon */}
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff" fillOpacity=".7" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity=".7" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" fillOpacity=".7" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity=".7" />
          </svg>
          {loading ? "Redirecting..." : "Continue with Google"}
        </Button>
        <p className="mt-4 text-sm leading-relaxed text-[#5f6368]">
          The first time you sign in, you’ll confirm the{" "}
          <Link href="/terms" className="font-medium text-[#1a73e8]">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-[#1a73e8]">
            Privacy Policy
          </Link>
          , including how AI drafts are used. That step is saved to your account.
        </p>
      </div>

      <p className="mt-5 text-sm text-[#5f6368]">
        <Link href="/" className="font-medium text-[#1a73e8]">
          Back to GRM
        </Link>
      </p>
    </div>
  );
}
