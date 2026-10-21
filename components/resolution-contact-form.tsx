"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ResolutionContact } from "@/lib/resolution-contact";

export function ResolutionContactForm({
  contact,
  canEdit,
}: {
  contact: ResolutionContact;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch("/api/escalations/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, email }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "That contact could not be saved.");
      return;
    }
    toast.success("Resolution contact saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-silver bg-white p-4">
      <div>
        <h2 className="text-sm font-medium text-graphite">Resolution contact</h2>
        <p className="mt-1 text-sm text-slate">
          Phone, email, or both for the whole organisation. On an escalation, a person adds one or both to the reply by
          hand. Nothing is inserted or sent on its own.
        </p>
      </div>
      <label className="block text-xs text-slate">
        Phone
        <input
          type="tel"
          name="phone"
          autoComplete="tel"
          maxLength={40}
          disabled={!canEdit || pending}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+91 98470 00000"
          className="mt-1 block w-full max-w-sm rounded-md border border-line px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="block text-xs text-slate">
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          maxLength={320}
          disabled={!canEdit || pending}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="care@example.com"
          className="mt-1 block w-full max-w-sm rounded-md border border-line px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <button type="submit" disabled={pending} className="rounded-md bg-ink px-3 py-1.5 text-sm text-white">
          {pending ? "Saving…" : "Save contact"}
        </button>
      ) : (
        <p className="text-xs text-slate">Only someone who can edit organisation rules can change this contact.</p>
      )}
    </form>
  );
}
