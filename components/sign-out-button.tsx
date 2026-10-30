"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

/** Auth.js sign-out must POST with its CSRF token, including outside the shell. */
export function SignOutButton({
  className,
  label = "Sign out",
  pendingLabel = "Signing out…",
}: {
  className?: string;
  /** Visible text, e.g. "Not you?" or "Decline and sign out". */
  label?: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={async () => {
        setPending(true);
        try {
          await signOut({ redirectTo: "/login" });
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
