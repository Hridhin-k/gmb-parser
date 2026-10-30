"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AgencyClientFormProps {
  clientId: string;
  canAssignManager: boolean;
  managers: Array<{ id: string; email: string }>;
  initial?: {
    name: string;
    contactEmail: string;
    website: string;
    brandName: string;
    logoUrl: string;
    accountManagerUserId: string | null;
  };
}

async function post(url: string, body: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; url?: string; expiresAt?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not save the client.");
  return data;
}

export function AgencyClientForm({ clientId, canAssignManager, managers, initial }: AgencyClientFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const manager = String(form.get("manager") ?? "");
        setPending(true);
        setError(null);
        const body = {
          action: "save" as const,
          name: String(form.get("name") ?? ""),
          contactEmail: String(form.get("contactEmail") ?? ""),
          website: String(form.get("website") ?? ""),
          brandName: String(form.get("brandName") ?? ""),
          logoUrl: String(form.get("logoUrl") ?? ""),
          accountManagerUserId: manager || null,
        };
        void post(`/api/clients/${clientId}`, body)
          .then(() => {
            toast.success("Business details saved");
            router.refresh();
          })
          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the client."))
          .finally(() => setPending(false));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-3">Name
          <Input name="name" required defaultValue={initial?.name ?? ""} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-ink-3">Contact email
          <Input name="contactEmail" type="email" defaultValue={initial?.contactEmail ?? ""} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-ink-3">Website
          <Input name="website" placeholder="https://" defaultValue={initial?.website ?? ""} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-ink-3">Brand name
          <Input name="brandName" defaultValue={initial?.brandName ?? ""} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-ink-3 sm:col-span-2">Logo URL
          <Input name="logoUrl" placeholder="https://" defaultValue={initial?.logoUrl ?? ""} className="mt-1" />
        </label>
        {canAssignManager ? (
          <label className="text-xs font-medium text-ink-3 sm:col-span-2">Account manager
            <select name="manager" defaultValue={initial?.accountManagerUserId ?? ""} className="mt-1 h-[34px] w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink focus-visible:ring-2 focus-visible:ring-brand-line focus-visible:outline-none">
              <option value="">No account manager</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.email}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="text-[13px] text-bad" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            void post(`/api/clients/${clientId}`, { action: "onboarding" })
              .then((data) => {
                setLink(data.url ?? null);
                toast.success("Link ready to copy. Mail is not sent.");
              })
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not create the link."));
          }}
        >
          Create connection link
        </Button>
        <Button type="submit" disabled={pending} loading={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
      {link ? (
        <p className="rounded-md border border-line bg-paper px-3 py-2 text-[13px] break-all text-ink">
          {link}
          <span className="mt-1 block text-xs text-ink-3">This link expires in 7 days. It is not emailed. The client signs in at Google and is never asked for a password here.</span>
        </p>
      ) : null}
    </form>
  );
}
