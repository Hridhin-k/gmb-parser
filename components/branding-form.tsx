"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BrandingFormProps {
  logoUrl: string;
  hideProductName: boolean;
  customDomain: string;
  domainToken: string | null;
  domainLabel: string;
  domainActive: boolean;
  senderEmail: string;
  senderLabel: string;
  senderActive: boolean;
}

async function post(body: object) {
  const response = await fetch("/api/settings/branding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not save branding.");
}

export function BrandingForm(props: BrandingFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4 rounded-xl border border-silver bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        void post({
          action: "save",
          logoUrl: String(form.get("logoUrl") ?? ""),
          hideProductName: form.get("hideProductName") === "on",
          customDomain: String(form.get("customDomain") ?? ""),
          senderEmail: String(form.get("senderEmail") ?? ""),
        })
          .then(() => {
            toast.success("Branding saved");
            router.refresh();
          })
          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save branding."))
          .finally(() => setPending(false));
      }}
    >
      <h2 className="text-base font-medium text-graphite">White label</h2>
      <label className="block text-sm text-slate">Agency logo URL
        <Input name="logoUrl" defaultValue={props.logoUrl} placeholder="https://" className="mt-1" />
      </label>
      <label className="flex items-center gap-2 text-sm text-graphite">
        <input type="checkbox" name="hideProductName" defaultChecked={props.hideProductName} />
        Use the workspace name as the signed-in app title
      </label>
      <label className="block text-sm text-slate">Custom domain
        <Input name="customDomain" defaultValue={props.customDomain} placeholder="reviews.example.com" className="mt-1" />
      </label>
      <p className="text-xs text-slate">{props.domainLabel}</p>
      {props.domainToken ? (
        <p className="break-all text-xs text-graphite">TXT record: {props.domainToken}</p>
      ) : null}
      <label className="block text-sm text-slate">Email sender
        <Input name="senderEmail" type="email" defaultValue={props.senderEmail} className="mt-1" />
      </label>
      <p className="text-xs text-slate">{props.senderLabel}</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save branding"}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            void post({ action: "verify-domain" })
              .then(() => {
                toast.success("DNS matches");
                router.refresh();
              })
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not check DNS."));
          }}
        >
          Check DNS
        </Button>
      </div>
      {props.domainActive || props.senderActive ? null : (
        <p className="text-xs text-slate">Custom domain and sender stay inactive until the check above succeeds.</p>
      )}
    </form>
  );
}
