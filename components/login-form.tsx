"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { localSignIn } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { GoogleMark } from "@/components/google-mark";
import type { AuthMethod } from "@/lib/onboarding";

export function LoginForm({ methods, initialError, localLogin = false }: {
  methods: AuthMethod[]; initialError: string | null; localLogin?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const google = methods.some((method) => method.id === "google" && method.available);
  return (
    <div className="w-full max-w-md rounded-2xl border border-silver bg-white p-8 shadow-sm">
      <Link href="/" className="text-sm font-medium text-graphite">RevuPilot</Link>
      <h1 className="mt-5 text-[31px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>Sign in to RevuPilot</h1>
      <p className="mt-2 mb-6 text-base font-light text-slate">Sign in with the Google email you were invited with, then connect the account that manages your businesses.</p>
      {error ? <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}
      {google ? <Button className="w-full gap-2" size="lg" loading={loading} onClick={async () => {
        setLoading(true);
        try { await signIn("google", { redirectTo: "/login" }); }
        catch { setError("Could not start Google sign-in. Please try again."); setLoading(false); }
      }}><GoogleMark />Continue with Google</Button> : null}
      {localLogin ? <form action={localSignIn} className="mt-4">
        <Button type="submit" variant="outline" className="w-full">Open local test workspace</Button>
        <p className="mt-2 text-xs text-slate">Local development only.</p>
      </form> : null}
      {!google && !localLogin ? <p role="status" className="text-sm text-slate">Sign-in is not configured. Contact your administrator.</p> : null}
      <p className="mt-6 text-xs text-slate">By continuing you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
    </div>
  );
}
