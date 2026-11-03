"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BrandProfile } from "@/lib/brand-profile";

interface BrandProfileCardProps {
  clientId: string;
  website: string | null;
  initial: BrandProfile | null;
  source: string | null;
  canEdit: boolean;
}

const EMPTY: BrandProfile = { summary: "", offerings: [], customerVocabulary: [], staffRoles: [], themeHints: [] };

const LISTS: Array<{ key: Exclude<keyof BrandProfile, "summary">; label: string; hint: string }> = [
  { key: "offerings", label: "What it offers", hint: "Main products or services, one per line" },
  { key: "customerVocabulary", label: "Words customers use", hint: "Phrases likely to appear in reviews" },
  { key: "staffRoles", label: "Staff roles", hint: "Job titles customers deal with" },
  { key: "themeHints", label: "What customers care about", hint: "Hints for reading reviews, not a fixed list" },
];

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

async function call(clientId: string, body: object) {
  const response = await fetch(`/api/clients/${clientId}/brand-profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; profile?: BrandProfile; pages?: string[] };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

export function BrandProfileCard({ clientId, website, initial, source, canEdit }: BrandProfileCardProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<BrandProfile>(initial ?? EMPTY);
  const [drafted, setDrafted] = useState<string[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const data = await call(clientId, { action: "draft" });
      setProfile(data.profile ?? EMPTY);
      setDrafted(data.pages ?? []);
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the profile.");
    } finally {
      setBusy(null);
    }
  }

  async function save(clear = false) {
    setBusy("save");
    setError(null);
    try {
      await call(clientId, {
        action: "save",
        profile: clear ? null : profile,
        source: drafted ? "website" : "manual",
      });
      if (clear) {
        setProfile(EMPTY);
        setDrafted(null);
        setVersion((value) => value + 1);
      }
      toast.success(clear ? "Brand profile cleared" : "Brand profile saved");
      setDrafted(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the profile.");
    } finally {
      setBusy(null);
    }
  }

  const hasProfile = Boolean(initial);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Brand profile</h2>
        <span className="text-xs text-ink-3">
          {hasProfile ? (source === "website" ? "Built from the website" : "Written by hand") : "Not set"}
        </span>
      </div>
      <div className="space-y-3 p-4 text-[13px]">
        <p className="text-xs text-ink-3">
          Tells the review analysis what this business does, so the themes it finds fit the business instead of a generic list.
          Without a profile, themes are still found from the reviews themselves.
        </p>

        {drafted ? (
          <Banner tone="info" title="Draft ready. Check it, then save.">
            Written from {drafted.length} page{drafted.length === 1 ? "" : "s"} of {website}. Edit anything that is wrong.
            Reviews already analysed keep their old themes; new analysis uses this profile.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="bad" role="alert">
            {error}
          </Banner>
        ) : null}

        {canEdit ? (
          <Button
            type="button"
            variant="ai"
            size="sm"
            onClick={draft}
            loading={busy === "draft"}
            disabled={!website || busy !== null}
            title={website ? undefined : "Add the business's website under Business details first."}
          >
            <Sparkles aria-hidden />
            {busy === "draft" ? "Reading the website…" : hasProfile ? "Rebuild from website" : "Build from website"}
          </Button>
        ) : null}
        {canEdit && !website ? (
          <p className="text-xs text-ink-3">Add the business&apos;s website under Business details to build this automatically, or write it below.</p>
        ) : null}

        <label className="block space-y-1">
          <span className="font-medium text-ink">What the business is</span>
          <Textarea
            value={profile.summary}
            disabled={!canEdit}
            rows={3}
            maxLength={800}
            onChange={(event) => setProfile({ ...profile, summary: event.target.value })}
          />
        </label>
        {LISTS.map((list) => (
          <label key={list.key} className="block space-y-1">
            <span className="font-medium text-ink">{list.label}</span>
            <span className="ml-2 text-xs text-ink-3">{list.hint}</span>
            <Textarea
              defaultValue={profile[list.key].join("\n")}
              key={`${list.key}:${version}`}
              disabled={!canEdit}
              rows={3}
              onChange={(event) => setProfile({ ...profile, [list.key]: lines(event.target.value) })}
            />
          </label>
        ))}

        {canEdit ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" onClick={() => void save()} loading={busy === "save"} disabled={busy !== null}>
              Save profile
            </Button>
            {hasProfile ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => void save(true)} disabled={busy !== null}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
