"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { signIn } from "next-auth/react";
import { localSignIn } from "@/app/login/actions";
import { Banner } from "@/components/ui/banner";
import { Spinner } from "@/components/ui/spinner";
import { GoogleMark } from "@/components/google-mark";
import { AuthCard, DemoTag, OrDivider, googleButtonClass } from "@/components/pub-shell";
import type { AuthMethod } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/** How the last attempt ended, as far as the callback URL tells us. */
export type LoginOutcome = "cancelled" | "error" | null;

export function LoginForm({
  methods,
  initialError,
  localLogin = false,
  openSignup = false,
  outcome = null,
  errorRef = null,
}: {
  methods: AuthMethod[];
  initialError: string | null;
  localLogin?: boolean;
  openSignup?: boolean;
  /** "cancelled" renders a neutral notice instead of an error. */
  outcome?: LoginOutcome;
  /** Error code from the callback, shown as a support reference. */
  errorRef?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [startFailed, setStartFailed] = useState(false);
  const google = methods.some((method) => method.id === "google" && method.available);
  const cancelled = outcome === "cancelled" && !startFailed;
  const retry = Boolean(error) && !cancelled;

  async function continueWithGoogle() {
    setLoading(true);
    try {
      await signIn("google", { redirectTo: "/login" });
    } catch {
      setStartFailed(true);
      setError("Could not start Google sign-in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {loading ? "Signing you in…" : "Sign in"}
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-2">
          {openSignup
            ? "Sign in with Google, create your workspace, then connect the account that manages your Business Profiles."
            : "Sign in with the Google email you were invited with, then connect the account that manages your Business Profiles."}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2.5 text-[13px] text-ink-3" role="status">
          <Spinner size="sm" />
          Redirecting to Google…
        </div>
      ) : null}

      {!loading && error && cancelled ? (
        <Banner tone="neutral" role="status">
          Sign-in was cancelled. Nothing was changed.
        </Banner>
      ) : null}
      {!loading && error && !cancelled ? (
        <Banner tone="bad" title="Sign-in didn't finish.">
          {error}
        </Banner>
      ) : null}

      {google ? (
        <button
          type="button"
          className={googleButtonClass}
          disabled={loading}
          aria-busy={loading || undefined}
          onClick={() => void continueWithGoogle()}
        >
          <GoogleMark className="size-[18px]" />
          {retry ? "Try again with Google" : "Continue with Google"}
        </button>
      ) : null}

      {cancelled && google ? (
        <p className="text-xs text-ink-3">
          If you closed Google&apos;s window by mistake, continue again and allow access.
        </p>
      ) : null}

      {retry && errorRef ? (
        <p className="text-right font-mono text-xs text-ink-3">ref {errorRef}</p>
      ) : null}

      {localLogin ? (
        <>
          {google ? <OrDivider /> : null}
          <form action={localSignIn} className="flex flex-col gap-2">
            <LocalSignInButton />
            <p className="text-xs text-ink-3">
              Local development only. Signs in as the local test account; nothing here reaches Google.
            </p>
          </form>
        </>
      ) : null}

      {!google && !localLogin ? (
        <Banner tone="warn" title="Sign-in is not configured." role="status">
          Contact your administrator.
        </Banner>
      ) : null}

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
        By continuing you agree to the{" "}
        <Link href="/terms" className="text-brand hover:underline">Terms</Link> and{" "}
        <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>. You&apos;ll
        confirm how AI processes reviews on the next screen.
      </p>
    </AuthCard>
  );
}

function LocalSignInButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-11 w-full items-center justify-between gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:opacity-60"
      )}
    >
      <span className="flex items-center gap-2">
        <DemoTag>Local</DemoTag>
        {pending ? "Opening local workspace…" : "Open local test workspace"}
      </span>
      {pending ? <Spinner size="sm" /> : <ChevronRight className="size-4 text-ink-3" aria-hidden />}
    </button>
  );
}
