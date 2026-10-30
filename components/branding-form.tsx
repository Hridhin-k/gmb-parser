"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
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

function Status({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={active ? "ok" : "warn"}>{active ? "Active" : "Not active"}</Badge>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}

export function BrandingForm(props: BrandingFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dirty, setDirty] = useState(false);

  return (
    <form
      className="space-y-4"
      onChange={() => setDirty(true)}
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
            setDirty(false);
            router.refresh();
          })
          .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save branding."))
          .finally(() => setPending(false));
      }}
    >
      <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="branding-identity">
        <div>
          <h2 id="branding-identity" className="text-sm font-semibold text-ink">Agency identity</h2>
          <p className="mt-0.5 text-xs text-ink-3">How your agency appears in the app shell for this workspace.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Agency logo URL</span>
          <Input name="logoUrl" defaultValue={props.logoUrl} placeholder="https://" />
          <span className="block text-xs text-ink-3">A public link to an SVG or PNG.</span>
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="hideProductName" defaultChecked={props.hideProductName} className="mt-0.5 size-4 accent-brand" />
          <span>Use the workspace name as the signed-in app title</span>
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="branding-domain">
        <div>
          <h2 id="branding-domain" className="text-sm font-semibold text-ink">Custom domain</h2>
          <p className="mt-0.5 text-xs text-ink-3">Your own domain, used once the DNS check succeeds.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Domain</span>
          <Input name="customDomain" defaultValue={props.customDomain} placeholder="reviews.example.com" />
        </label>
        <Status active={props.domainActive} label={props.domainLabel} />
        {props.domainToken ? (
          <div className="space-y-1 rounded-md border border-line bg-paper p-3">
            <p className="text-xs font-medium text-ink-2">Add this TXT record at your DNS provider</p>
            <code className="block break-all font-mono text-xs text-ink">{props.domainToken}</code>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="branding-sender">
        <div>
          <h2 id="branding-sender" className="text-sm font-semibold text-ink">Email sender</h2>
          <p className="mt-0.5 text-xs text-ink-3">The address mail is sent from once it is verified.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-2">Sender address</span>
          <Input name="senderEmail" type="email" defaultValue={props.senderEmail} />
        </label>
        <Status active={props.senderActive} label={props.senderLabel} />
      </section>

      {error ? (
        <Banner tone="bad" title="That didn't work.">
          {error}
        </Banner>
      ) : null}
      {props.domainActive || props.senderActive ? null : (
        <Banner tone="info">Custom domain and sender stay inactive until the DNS check succeeds.</Banner>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          loading={checking}
          onClick={() => {
            setError(null);
            setChecking(true);
            void post({ action: "verify-domain" })
              .then(() => {
                toast.success("DNS matches");
                router.refresh();
              })
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not check DNS."))
              .finally(() => setChecking(false));
          }}
        >
          Check DNS
        </Button>
        <div className="flex items-center gap-2">
          {dirty ? <span className="text-xs text-ink-3">Unsaved changes</span> : null}
          <Button type="submit" disabled={pending} loading={pending}>
            {pending ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </div>
    </form>
  );
}
