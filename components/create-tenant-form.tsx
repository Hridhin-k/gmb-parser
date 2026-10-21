"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateTenantForm({ email }: { email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not create your organization.");
        setLoading(false);
        return;
      }
      router.replace("/onboarding");
      router.refresh();
    } catch {
      setError("Could not create your organization.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-xl bg-white px-5 py-8 shadow-card sm:px-8 sm:py-10">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">G</div>
        <h1 className="mt-5 text-[28px] leading-[1.2] text-graphite" style={{ fontFamily: "var(--font-heading), sans-serif" }}>
          Create your organization
        </h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-slate sm:text-base">
          You were invited as the owner for <span className="font-medium text-graphite">{email}</span>. Name your
          organization — this becomes your tenant. You can then connect Google, add locations, and invite your
          admins, managers, and members.
        </p>
        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">{error}</div>
        ) : null}
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" aria-label="Organization name" maxLength={255} required autoFocus />
          <Button type="submit" loading={loading} disabled={!name.trim()} className="w-full" size="lg">
            {loading ? "Creating…" : "Create organization"}
          </Button>
        </form>
      </div>
    </div>
  );
}
