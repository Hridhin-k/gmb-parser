"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { GoogleMark } from "@/components/google-mark";
import type { AuthMethod } from "@/lib/onboarding";

interface LoginFormProps {
  methods: AuthMethod[];
  initialError: string | null;
}

export function LoginForm({ methods, initialError }: LoginFormProps) {
  const google = methods.find((method) => method.id === "google");
  const others = methods.filter((method) => method.id !== "google");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function signInGoogle() {
    setLoading("google");
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(null);
    }
  }

  async function signInMicrosoft() {
    setLoading("microsoft");
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: { redirectTo: redirectTo() },
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(null);
    }
  }

  async function signInSso(domain: string) {
    setLoading("sso");
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithSSO({
      domain,
      options: { redirectTo: redirectTo() },
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(null);
    }
  }

  async function signInEmail(event: FormEvent) {
    event.preventDefault();
    setLoading("email");
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(null);
      return;
    }
    window.location.assign("/overview");
  }

  async function recoverPassword() {
    if (!email.trim()) {
      setError("Enter your work email first, then ask for the recovery link.");
      return;
    }
    setLoading("recovery");
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo(),
    });
    if (resetError) {
      setError(resetError.message);
    } else {
      setNotice("If that email can sign in with a password, a recovery link is on its way.");
    }
    setLoading(null);
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setLoading("phone");
    setError(null);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone });
    if (otpError) {
      setError(otpError.message);
      setLoading(null);
      return;
    }
    setCodeSent(true);
    setLoading(null);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setLoading("phone");
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    if (verifyError) {
      setError(verifyError.message);
      setLoading(null);
      return;
    }
    window.location.assign("/overview");
  }

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-xl bg-white px-5 py-8 shadow-card sm:px-8 sm:py-10">
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

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md border border-silver bg-paper px-3 py-2 text-[13px] text-graphite" role="status">
            {notice}
          </div>
        ) : null}

        {google?.available ? (
          <Button onClick={signInGoogle} loading={loading === "google"} className="w-full gap-2" size="lg">
            <GoogleMark />
            {loading === "google" ? "Redirecting to Google…" : "Continue with Google"}
          </Button>
        ) : null}

        {others.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {others.map((method) => (
            <li key={method.id} className="rounded-xl border border-silver px-4 py-3">
              <p className="text-sm font-medium text-graphite">{method.label}</p>
              <p className="mt-1 text-sm text-slate">{method.detail}</p>
              {method.id === "microsoft" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  loading={loading === "microsoft"}
                  onClick={signInMicrosoft}
                >
                  Continue with Microsoft
                </Button>
              ) : null}
              {method.id === "sso" && method.ssoDomain ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  loading={loading === "sso"}
                  onClick={() => {
                    if (method.ssoDomain) void signInSso(method.ssoDomain);
                  }}
                >
                  Continue with single sign-on
                </Button>
              ) : null}
              {method.id === "email" ? (
                <form onSubmit={signInEmail} className="mt-3 space-y-2">
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Work email"
                    aria-label="Work email"
                    autoComplete="username"
                  />
                  <Input
                    type="password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password"
                    aria-label="Password"
                    autoComplete="current-password"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" loading={loading === "email"}>
                      Sign in
                    </Button>
                    <Button type="button" variant="outline" loading={loading === "recovery"} onClick={recoverPassword}>
                      Email a recovery link
                    </Button>
                  </div>
                </form>
              ) : null}
              {method.id === "phone" ? (
                <form onSubmit={codeSent ? verifyCode : sendCode} className="mt-3 space-y-2">
                  <Input
                    type="tel"
                    required
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91…"
                    aria-label="Mobile number"
                    autoComplete="tel"
                  />
                  {codeSent ? (
                    <Input
                      inputMode="numeric"
                      required
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Code"
                      aria-label="One-time code"
                    />
                  ) : null}
                  <Button type="submit" loading={loading === "phone"}>
                    {codeSent ? "Verify code" : "Send code"}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        ) : null}

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
