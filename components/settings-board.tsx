"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REPLY_LANGUAGES } from "@/lib/automation";

interface Field<T> {
  value: T;
  source: string;
  overridden: boolean;
}

export interface SettingsTone {
  greeting: Field<string>;
  signoff: Field<string>;
  warmth: Field<"formal" | "friendly">;
  length: Field<"brief" | "standard" | "detailed">;
  languages: Field<string[]>;
  neverSay: Field<string[]>;
  spellings: Field<Array<{ term: string; spelling: string }>>;
}

export interface SettingsAutomation {
  enabled: Field<boolean>;
  minStars: Field<number>;
  excludeQuestions: Field<boolean>;
  dailyCap: Field<number>;
  holdbackMinutes: Field<number>;
  windowStart: Field<string | null>;
  windowEnd: Field<string | null>;
  shadowMode: Field<boolean>;
  varyWording: Field<boolean>;
}

interface SettingsBoardProps {
  section: "tone" | "templates";
  target: { kind: "workspace" } | { kind: "client" | "group" | "location"; id: string };
  canEdit: boolean;
  tone: SettingsTone;
  automation: SettingsAutomation;
  templates: Array<{ id: string; name: string; body: string; scopeLabel: string }>;
}

const SAMPLE_REVIEWS = [
  "Staff valare helpful aayirunnu, nalla collection.",
  "Loved the fitting. Will come back next week.",
  "Can you hold a size for me tomorrow?",
];

function sourceLabel(field: Field<unknown>) {
  if (!field.overridden) return `Inherited from ${field.source}`;
  if (field.source === "the organization") return "Set for the organization";
  return "Overridden";
}

async function post(body: object) {
  const response = await fetch("/api/settings/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; text?: string; words?: number; violations?: string[] };
  if (!response.ok) throw new Error(data.error ?? "Could not save settings.");
  return data;
}

export function SettingsBoard({ section, target, canEdit, tone, automation, templates }: SettingsBoardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; words: number; violations: string[] } | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [comment, setComment] = useState(SAMPLE_REVIEWS[0]);

  async function save(form: FormData) {
    setError(null);
    setPending(true);
    try {
      const languages = REPLY_LANGUAGES.filter((item) => form.get(`lang-${item.id}`) === "on").map((item) => item.id);
      const neverSay = String(form.get("neverSay") ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const spellings = String(form.get("spellings") ?? "")
        .split("\n")
        .map((line) => line.split("=").map((part) => part.trim()))
        .filter((parts) => parts[0] && parts[1])
        .map(([term, spelling]) => ({ term, spelling }));
      await post({
        action: "save",
        target,
        tone: {
          greeting: String(form.get("greeting") ?? "").trim() || null,
          signoff: String(form.get("signoff") ?? "").trim() || null,
          warmth: form.get("warmth"),
          length: form.get("length"),
          languages,
          neverSay,
          spellings,
        },
        automation: {
          enabled: form.get("enabled") === "on",
          minStars: Number(form.get("minStars") ?? 4),
          excludeQuestions: form.get("excludeQuestions") === "on",
          dailyCap: Number(form.get("dailyCap") ?? 10),
          holdbackMinutes: Number(form.get("holdbackMinutes") ?? 60),
          windowStart: String(form.get("windowStart") ?? "").trim() || null,
          windowEnd: String(form.get("windowEnd") ?? "").trim() || null,
          shadowMode: form.get("shadowMode") === "on",
          varyWording: form.get("varyWording") === "on",
        },
      });
      toast.success("Settings saved");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setPending(false);
    }
  }

  function runPreview(text: string) {
    setError(null);
    void post({ action: "preview", target, comment: text, reviewerName: "Anjali" })
      .then((data) => setPreview({ text: data.text ?? "", words: data.words ?? 0, violations: data.violations ?? [] }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not preview."));
  }

  return (
    <div className="space-y-8">
      {section === "tone" ? (
      <>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save(new FormData(event.currentTarget));
        }}
      >
        <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
          <h2 className="text-base font-medium text-graphite">Tone</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate">
              Greeting
              <Input name="greeting" defaultValue={tone.greeting.value} disabled={!canEdit} className="mt-1" />
              <span className="mt-1 block text-xs">{sourceLabel(tone.greeting)}</span>
            </label>
            <label className="text-sm text-slate">
              Sign-off
              <Input name="signoff" defaultValue={tone.signoff.value} disabled={!canEdit} className="mt-1" />
              <span className="mt-1 block text-xs">{sourceLabel(tone.signoff)}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-graphite">
            <label>Warmth
              <select name="warmth" defaultValue={tone.warmth.value} disabled={!canEdit} className="ml-2 rounded-md border border-silver bg-white px-2 py-1">
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
              </select>
            </label>
            <label>Length
              <select name="length" defaultValue={tone.length.value} disabled={!canEdit} className="ml-2 rounded-md border border-silver bg-white px-2 py-1">
                <option value="brief">Brief</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
          </div>
          <fieldset className="space-y-1 text-sm text-graphite">
            <legend className="text-slate">Reply languages</legend>
            {REPLY_LANGUAGES.map((language) => (
              <label key={language.id} className="mr-4 inline-flex items-center gap-2">
                <input type="checkbox" name={`lang-${language.id}`} defaultChecked={tone.languages.value.includes(language.id)} disabled={!canEdit} />
                {language.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm text-slate">
            Never say
            <textarea name="neverSay" defaultValue={tone.neverSay.value.join("\n")} disabled={!canEdit} rows={3} className="mt-1 w-full rounded-md border border-silver p-2 text-graphite" />
            <span className="mt-1 block text-xs">{sourceLabel(tone.neverSay)}</span>
          </label>
          <label className="block text-sm text-slate">
            Always spell this way
            <textarea name="spellings" defaultValue={tone.spellings.value.map((rule) => `${rule.term} = ${rule.spelling}`).join("\n")} disabled={!canEdit} rows={3} placeholder="Kochi = Kochi" className="mt-1 w-full rounded-md border border-silver p-2 text-graphite" />
            <span className="mt-1 block text-xs">{sourceLabel(tone.spellings)}</span>
          </label>
        </section>

        <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
          <h2 className="text-base font-medium text-graphite">Automation</h2>
          <p className="text-sm text-slate">Negative reviews always need a person. Guardrails stay on: no compensation, medical or legal claims, personal data, or internal contacts.</p>
          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" name="enabled" defaultChecked={automation.enabled.value} disabled={!canEdit} />
            Autoreply to {automation.minStars.value}–5 star reviews
          </label>
          <label className="block text-sm text-slate">
            Eligible from
            <select name="minStars" defaultValue={String(automation.minStars.value)} disabled={!canEdit} className="ml-2 rounded-md border border-silver bg-white px-2 py-1">
              <option value="4">4 stars</option>
              <option value="5">5 stars</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" name="excludeQuestions" defaultChecked={automation.excludeQuestions.value} disabled={!canEdit} />
            Skip reviews with a question or a complaint
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate">Daily cap per location
              <Input name="dailyCap" type="number" min={1} max={100} defaultValue={automation.dailyCap.value} disabled={!canEdit} className="mt-1" />
            </label>
            <label className="text-sm text-slate">Hold back for checking (minutes)
              <Input name="holdbackMinutes" type="number" min={0} max={10080} defaultValue={automation.holdbackMinutes.value} disabled={!canEdit} className="mt-1" />
            </label>
            <label className="text-sm text-slate">Post between
              <Input name="windowStart" placeholder="09:00" defaultValue={automation.windowStart.value ?? ""} disabled={!canEdit} className="mt-1" />
            </label>
            <label className="text-sm text-slate">and
              <Input name="windowEnd" placeholder="18:00" defaultValue={automation.windowEnd.value ?? ""} disabled={!canEdit} className="mt-1" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" name="shadowMode" defaultChecked={automation.shadowMode.value} disabled={!canEdit} />
            Shadow mode: save drafts and post nothing
          </label>
          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" name="varyWording" defaultChecked={automation.varyWording.value} disabled={!canEdit} />
            Vary wording across locations
          </label>
          <p className="text-xs text-slate">{sourceLabel(automation.shadowMode)} · {sourceLabel(automation.enabled)}</p>
        </section>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
            {target.kind !== "workspace" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void post({ action: "clear", target }).then(() => {
                    toast.success("Override cleared");
                    router.refresh();
                  }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not clear the override."));
                }}
              >
                Clear override
              </Button>
            ) : null}
            {target.kind === "group" ? (
              <p className="text-sm text-slate">Pause applies to the organization, a brand, or a location.</p>
            ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const scope = target.kind === "client" ? "client" : target.kind === "location" ? "location" : "workspace";
                void fetch("/api/escalations/pause", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    scope,
                    clientId: target.kind === "client" ? target.id : null,
                    locationId: target.kind === "location" ? target.id : null,
                    paused: true,
                  }),
                }).then(async (response) => {
                  const data = (await response.json().catch(() => ({}))) as { error?: string };
                  if (!response.ok) throw new Error(data.error ?? "Could not pause automation.");
                  toast.success("Automation paused");
                }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not pause automation."));
              }}
            >
              Pause now
            </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate">You can view these settings. Saving them needs permission for this place.</p>
        )}
      </form>

      <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
        <h2 className="text-base font-medium text-graphite">Try it</h2>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="w-full rounded-md border border-silver p-2 text-sm text-graphite" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => runPreview(comment)}>
            Preview
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const next = (sampleIndex + 1) % SAMPLE_REVIEWS.length;
              const text = SAMPLE_REVIEWS[next] ?? SAMPLE_REVIEWS[0];
              setSampleIndex(next);
              setComment(text);
              runPreview(text);
            }}
          >
            Try another
          </Button>
        </div>
        {preview ? (
          <div className="text-sm text-graphite">
            <p>{preview.text}</p>
            <p className="mt-2 text-xs text-slate">
              {preview.violations.length ? preview.violations.join(" ") : "Guardrails passed"} · {preview.words} words
            </p>
          </div>
        ) : null}
      </section>
      </>
      ) : null}

      {section === "templates" ? (
      <section className="space-y-3">
        <h2 className="text-base font-medium text-graphite">Templates</h2>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <ul className="divide-y divide-silver rounded-xl border border-silver">
          {templates.length === 0 ? <li className="px-4 py-3 text-sm text-slate">No templates yet.</li> : null}
          {templates.map((template) => (
            <li key={template.id} className="px-4 py-3 text-sm">
              <p className="font-medium text-graphite">{template.name} <span className="font-normal text-slate">· {template.scopeLabel}</span></p>
              <p className="mt-1 text-slate">{template.body}</p>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    void post({ action: "delete-template", templateId: template.id }).then(() => {
                      toast.success("Template removed");
                      router.refresh();
                    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not delete the template."));
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void post({
                action: "template",
                target,
                name: String(form.get("name") ?? ""),
                body: String(form.get("body") ?? ""),
              }).then(() => {
                toast.success("Template saved");
                router.refresh();
              }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the template."));
            }}
          >
            <Input name="name" placeholder="Template name" aria-label="Template name" required />
            <textarea name="body" required rows={3} placeholder="Thank you, {name}. — {location}" className="w-full rounded-md border border-silver p-2 text-sm" aria-label="Template body" />
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                const form = event.currentTarget.closest("form");
                if (!form) return;
                form.requestSubmit();
              }}
            >
              Save template
            </Button>
          </form>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
