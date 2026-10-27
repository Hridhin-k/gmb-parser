"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

/** Auth.js sign-out must POST with its CSRF token, including outside the shell. */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  return <button type="button" className={className} disabled={pending} onClick={async () => {
    setPending(true);
    try { await signOut({ redirectTo: "/login" }); }
    finally { setPending(false); }
  }}>{pending ? "Signing out…" : "Sign out"}</button>;
}
