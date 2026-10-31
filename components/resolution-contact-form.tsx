"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <form onSubmit={save} className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Customer contact details</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Where a customer can reach you privately. You can add these details to a reply when needed; saving them does not send a message.
        </p>
      </div>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Phone
          <Input
            type="tel"
            name="phone"
            autoComplete="tel"
            maxLength={40}
            disabled={!canEdit || pending}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+91 98470 00000"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Email
          <Input
            type="email"
            name="email"
            autoComplete="email"
            maxLength={320}
            disabled={!canEdit || pending}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="care@example.com"
          />
        </label>
      </div>
      {error ? (
        <p className="text-[13px] text-bad" role="alert">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : "Save contact"}
        </Button>
      ) : (
        <p className="text-xs text-ink-3">Only someone who can edit business rules can change this contact.</p>
      )}
    </form>
  );
}
