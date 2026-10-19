"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AgencyClientFormProps {
  mode: "create" | "edit";
  clientId?: string;
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

export function AgencyClientForm({ mode, clientId, canAssignManager, managers, initial }: AgencyClientFormProps) {
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
        const url = mode === "create" ? "/api/clients" : `/api/clients/${clientId}`;
        void post(url, mode === "create" ? { ...body, action: undefined } : body)
          .then(() => {
            toast.success(mode === "create" ? "Client added" : "Client saved");
            router.refresh();
          })
          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the client."))
          .finally(() => setPending(false));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate">Name
          <Input name="name" required defaultValue={initial?.name ?? ""} className="mt-1" />
        </label>
        <label className="text-sm text-slate">Contact email
          <Input name="contactEmail" type="email" defaultValue={initial?.contactEmail ?? ""} className="mt-1" />
        </label>
        <label className="text-sm text-slate">Website
          <Input name="website" placeholder="https://" defaultValue={initial?.website ?? ""} className="mt-1" />
        </label>
        <label className="text-sm text-slate">Client brand name
          <Input name="brandName" defaultValue={initial?.brandName ?? ""} className="mt-1" />
        </label>
        <label className="text-sm text-slate sm:col-span-2">Client logo URL
          <Input name="logoUrl" placeholder="https://" defaultValue={initial?.logoUrl ?? ""} className="mt-1" />
        </label>
        {canAssignManager ? (
          <label className="text-sm text-slate sm:col-span-2">Account manager
            <select name="manager" defaultValue={initial?.accountManagerUserId ?? ""} className="mt-1 w-full rounded-md border border-silver bg-white px-2 py-2 text-sm text-graphite">
              <option value="">No account manager</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.email}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Add client" : "Save client"}</Button>
        {mode === "edit" && clientId ? (
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
        ) : null}
      </div>
      {link ? (
        <p className="break-all text-sm text-graphite">
          {link}
          <span className="mt-1 block text-xs text-slate">This link expires in 7 days. It is not emailed. The client signs in at Google and is never asked for a password here.</span>
        </p>
      ) : null}
    </form>
  );
}
