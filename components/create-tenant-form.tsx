"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/components/pub-shell";

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
        setError(data.error ?? "Could not create your workspace.");
        setLoading(false);
        return;
      }
      router.replace("/onboarding");
      router.refresh();
    } catch {
      setError("Could not create your workspace.");
      setLoading(false);
    }
  }

  return (
    <div className="grid w-full max-w-[904px] items-start gap-6 lg:grid-cols-[minmax(0,560px)_320px]">
      <AuthCard className="max-w-none gap-5 sm:p-9">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Create your workspace</h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            A workspace is the account your team signs in to
            {email ? (
              <>
                {" "}— this one is for <span className="font-medium text-ink">{email}</span>
              </>
            ) : null}
            . You can add businesses, locations and people once it exists.
          </p>
        </div>

        {error ? (
          <Banner tone="bad" title="Not created.">
            {error}
          </Banner>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="workspace-name" className="text-[13px] font-medium text-ink">
              Workspace name
            </label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. your agency or business name"
              aria-describedby="workspace-name-hint"
              maxLength={255}
              required
              autoFocus
              className="h-11 text-[15px]"
            />
            <span id="workspace-name-hint" className="text-xs text-ink-3">
              Shown in the sidebar and to people you invite.
            </span>
          </div>
          <div className="flex justify-end border-t border-line pt-4">
            <Button type="submit" size="lg" loading={loading} disabled={!name.trim()} className="w-full sm:w-auto">
              {loading ? "Creating…" : "Create workspace"}
            </Button>
          </div>
        </form>
      </AuthCard>

      <aside className="flex flex-col gap-3">
        <SideCard title="You'll be the owner">
          Owners connect Google, add locations, and invite admins, managers and members.
        </SideCard>
        <SideCard title="Were you invited?">
          If a colleague or agency already set up a workspace for you, don&apos;t create another. Ask them to invite{" "}
          {email ? <span className="font-medium text-ink">{email}</span> : "this email"}, then sign in again.
        </SideCard>
        <SideCard title="What happens next">
          <ol className="list-decimal space-y-0.5 pl-[18px] leading-relaxed">
            <li>Connect the Google account that manages your profiles</li>
            <li>Import locations</li>
            <li>Set a reply tone and invite your team</li>
          </ol>
        </SideCard>
      </aside>
    </div>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-4">
      <b className="text-sm font-semibold text-ink">{title}</b>
      <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}
