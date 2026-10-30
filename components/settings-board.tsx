"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REPLY_LANGUAGES } from "@/lib/automation";
import { cn } from "@/lib/utils";

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
  /** "tone": brand voice and automation form. "preview": local template preview. "templates": reply templates. */
  section: "tone" | "templates" | "preview";
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

const SELECT_CLASS =
  "h-[34px] rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60";

function sourceName(source: string): string {
  if (source === "the organization") return "workspace";
  if (source === "the workspace defaults") return "default";
  return source;
}

/** Where a value comes from: set on this scope, or inherited from a wider one. */
export function SourceTag({ field, className }: { field: Field<unknown>; className?: string }) {
  if (field.overridden) {
    return (
      <Badge variant="brand" className={className}>
        Set here
      </Badge>
    );
  }
  return (
    <Badge variant="default" className={className} title={`Inherited from ${sourceName(field.source)}`}>
      Inherited · {sourceName(field.source)}
    </Badge>
  );
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

function SettingRow({
  title,
  hint,
  tag,
  children,
  htmlFor,
}: {
  title: string;
  hint?: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 sm:max-w-[45%]">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
            {title}
          </label>
        ) : (
          <p className="text-[13px] font-medium text-ink">{title}</p>
        )}
        {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
        {children}
        {tag}
      </div>
    </div>
  );
}

function CheckRow({ name, label, defaultChecked, disabled }: { name: string; label: ReactNode; defaultChecked: boolean; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="size-4 accent-brand" />
      {label}
    </label>
  );
}

export function SettingsBoard({ section, target, canEdit, tone, automation, templates }: SettingsBoardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string; words: number; violations: string[] } | null>(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [comment, setComment] = useState(SAMPLE_REVIEWS[0]);
  const [dirty, setDirty] = useState(false);

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
      setDirty(false);
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

  const errorBanner = error ? (
    <Banner tone="bad" title="That didn't work." actions={<Button type="button" size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
      {error}
    </Banner>
  ) : null;

  if (section === "tone") {
    return (
      <form
        className="space-y-4"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          void save(new FormData(event.currentTarget));
        }}
      >
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="brand-voice-title">
          <div>
            <h2 id="brand-voice-title" className="text-sm font-semibold text-ink">Brand voice</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              Greeting, warmth and never-say rules for this scope. Each row says where its value comes from; saving here
              sets it for this scope.
            </p>
          </div>
          <div className="space-y-3">
            <SettingRow title="Greeting" htmlFor="tone-greeting" tag={<SourceTag field={tone.greeting} />}>
              <Input id="tone-greeting" name="greeting" defaultValue={tone.greeting.value} disabled={!canEdit} className="sm:max-w-xs" />
            </SettingRow>
            <SettingRow title="Sign-off" htmlFor="tone-signoff" tag={<SourceTag field={tone.signoff} />}>
              <Input id="tone-signoff" name="signoff" defaultValue={tone.signoff.value} disabled={!canEdit} className="sm:max-w-xs" />
            </SettingRow>
            <SettingRow title="Warmth" htmlFor="tone-warmth" tag={<SourceTag field={tone.warmth} />}>
              <select id="tone-warmth" name="warmth" defaultValue={tone.warmth.value} disabled={!canEdit} className={SELECT_CLASS}>
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
              </select>
            </SettingRow>
            <SettingRow title="Length" htmlFor="tone-length" tag={<SourceTag field={tone.length} />}>
              <select id="tone-length" name="length" defaultValue={tone.length.value} disabled={!canEdit} className={SELECT_CLASS}>
                <option value="brief">Brief</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </SettingRow>
            <SettingRow title="Reply languages" hint="Drafts can be written in these languages." tag={<SourceTag field={tone.languages} />}>
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                <legend className="sr-only">Reply languages</legend>
                {REPLY_LANGUAGES.map((language) => (
                  <CheckRow
                    key={language.id}
                    name={`lang-${language.id}`}
                    label={language.label}
                    defaultChecked={tone.languages.value.includes(language.id)}
                    disabled={!canEdit}
                  />
                ))}
              </fieldset>
            </SettingRow>
            <div className="space-y-1.5 border-t border-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="tone-never" className="text-[13px] font-medium text-ink">Never say</label>
                <SourceTag field={tone.neverSay} />
              </div>
              <Textarea id="tone-never" name="neverSay" defaultValue={tone.neverSay.value.join("\n")} disabled={!canEdit} rows={3} />
              <p className="text-xs text-ink-3">One phrase per line.</p>
            </div>
            <div className="space-y-1.5 border-t border-line pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="tone-spell" className="text-[13px] font-medium text-ink">Always spell this way</label>
                <SourceTag field={tone.spellings} />
              </div>
              <Textarea
                id="tone-spell"
                name="spellings"
                defaultValue={tone.spellings.value.map((rule) => `${rule.term} = ${rule.spelling}`).join("\n")}
                disabled={!canEdit}
                rows={3}
                placeholder="Kochi = Kochi"
              />
              <p className="text-xs text-ink-3">One rule per line, as term = spelling.</p>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="automation-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="automation-title" className="text-sm font-semibold text-ink">Automation</h2>
              <p className="mt-0.5 text-xs text-ink-3">
                Negative reviews always need a person. Guardrails stay on: no compensation, medical or legal claims, personal
                data, or internal contacts.
              </p>
            </div>
            <SourceTag field={automation.enabled} />
          </div>
          <div className="space-y-3">
            <SettingRow
              title="Autoreply"
              hint={`Reply automatically to ${automation.minStars.value}–5 star reviews.`}
              tag={<SourceTag field={automation.minStars} />}
            >
              <CheckRow name="enabled" label="On" defaultChecked={automation.enabled.value} disabled={!canEdit} />
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                <span>Eligible from</span>
                <select name="minStars" defaultValue={String(automation.minStars.value)} disabled={!canEdit} className={SELECT_CLASS}>
                  <option value="4">4 stars</option>
                  <option value="5">5 stars</option>
                </select>
              </label>
            </SettingRow>
            <SettingRow title="Skip questions and complaints" hint="Leave reviews with a question or a complaint for a person." tag={<SourceTag field={automation.excludeQuestions} />}>
              <CheckRow name="excludeQuestions" label="Skip" defaultChecked={automation.excludeQuestions.value} disabled={!canEdit} />
            </SettingRow>
            <SettingRow title="Daily cap per location" htmlFor="auto-cap" tag={<SourceTag field={automation.dailyCap} />}>
              <Input id="auto-cap" name="dailyCap" type="number" min={1} max={100} defaultValue={automation.dailyCap.value} disabled={!canEdit} className="w-24" />
            </SettingRow>
            <SettingRow title="Hold back for checking" hint="Minutes before an automatic reply posts." htmlFor="auto-hold" tag={<SourceTag field={automation.holdbackMinutes} />}>
              <Input id="auto-hold" name="holdbackMinutes" type="number" min={0} max={10080} defaultValue={automation.holdbackMinutes.value} disabled={!canEdit} className="w-24" />
            </SettingRow>
            <SettingRow title="Posting window" hint="Local time. Leave empty to post any time." tag={<SourceTag field={automation.windowStart} />}>
              <Input name="windowStart" placeholder="09:00" aria-label="Post from" defaultValue={automation.windowStart.value ?? ""} disabled={!canEdit} className="w-24" />
              <span className="text-xs text-ink-3">to</span>
              <Input name="windowEnd" placeholder="18:00" aria-label="Post until" defaultValue={automation.windowEnd.value ?? ""} disabled={!canEdit} className="w-24" />
            </SettingRow>
            <SettingRow title="Shadow mode" hint="Save drafts and post nothing." tag={<SourceTag field={automation.shadowMode} />}>
              <CheckRow name="shadowMode" label="On" defaultChecked={automation.shadowMode.value} disabled={!canEdit} />
            </SettingRow>
            <SettingRow title="Vary wording across locations" tag={<SourceTag field={automation.varyWording} />}>
              <CheckRow name="varyWording" label="On" defaultChecked={automation.varyWording.value} disabled={!canEdit} />
            </SettingRow>
          </div>
        </section>

        {errorBanner}

        {canEdit ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {target.kind !== "workspace" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void post({ action: "clear", target }).then(() => {
                      toast.success("Override cleared");
                      router.refresh();
                    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not clear the override."));
                  }}
                >
                  Reset to inherited
                </Button>
              ) : null}
              {target.kind === "group" ? (
                <p className="text-xs text-ink-3">Pause applies to the workspace, a business, or a location.</p>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
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
                  Pause automation now
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {dirty ? <span className="text-xs text-ink-3">Unsaved changes</span> : null}
              <Button type="submit" loading={pending}>{pending ? "Saving…" : "Save changes"}</Button>
            </div>
          </div>
        ) : (
          <Banner tone="neutral">You can view these settings. Saving them needs permission for this place.</Banner>
        )}
      </form>
    );
  }

  if (section === "preview") {
    return (
      <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="local-preview-title">
        <div>
          <h2 id="local-preview-title" className="text-sm font-semibold text-ink">Template fill-in preview</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Instant local preview of greeting, sign-off and template fill-ins. No AI is used.
          </p>
        </div>
        <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} aria-label="Sample review text" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => runPreview(comment)}>
            Preview
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = (sampleIndex + 1) % SAMPLE_REVIEWS.length;
              const text = SAMPLE_REVIEWS[next] ?? SAMPLE_REVIEWS[0];
              setSampleIndex(next);
              setComment(text);
              runPreview(text);
            }}
          >
            Try another sample
          </Button>
        </div>
        {preview ? (
          <div className="rounded-md border border-line bg-white p-3 text-[13px] text-ink-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge variant="default">Preview · not saved</Badge>
              <Badge variant={preview.violations.length ? "warn" : "ok"}>
                {preview.violations.length ? "Guardrail notes" : "Guardrails passed"}
              </Badge>
              <span className="text-xs text-ink-3">{preview.words} words</span>
            </div>
            <p className="whitespace-pre-line">{preview.text}</p>
            {preview.violations.length ? <p className="mt-2 text-xs text-warn">{preview.violations.join(" ")}</p> : null}
          </div>
        ) : null}
        {errorBanner}
      </section>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 space-y-3" aria-labelledby="templates-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="templates-title" className="text-sm font-semibold text-ink">
            Templates <span className="font-normal text-ink-3">· {templates.length}</span>
          </h2>
        </div>
        {errorBanner}
        {templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center">
            <p className="text-[13px] font-medium text-ink">No templates yet</p>
            <p className="mt-1 text-xs text-ink-3">
              Templates are hand-written replies your team can insert in one click. They work with AI off.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-line bg-paper text-xs text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Template</th>
                  <th className="w-[160px] px-3 py-2 font-medium">Source</th>
                  {canEdit ? <th className="w-[90px] px-3 py-2"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {templates.map((template) => (
                  <tr key={template.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-ink">{template.name}</p>
                      <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-ink-3">{template.body}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="default" className="max-w-full truncate">{template.scopeLabel}</Badge>
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove template ${template.name}`}
                          onClick={() => {
                            void post({ action: "delete-template", templateId: template.id }).then(() => {
                              toast.success("Template removed");
                              router.refresh();
                            }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not delete the template."));
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canEdit ? (
        <form
          className={cn("space-y-3 rounded-lg border border-line bg-white p-4")}
          aria-labelledby="new-template-title"
          onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            void post({
              action: "template",
              target,
              name: String(form.get("name") ?? ""),
              body: String(form.get("body") ?? ""),
            }).then(() => {
              toast.success("Template saved");
              formElement.reset();
              router.refresh();
            }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not save the template."));
          }}
        >
          <div>
            <h3 id="new-template-title" className="text-sm font-semibold text-ink">New template</h3>
            <p className="mt-0.5 text-xs text-ink-3">Saved for the scope chosen above.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-2">Name</span>
            <Input name="name" placeholder="Thank you · 5 stars" aria-label="Template name" required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-2">Reply text</span>
            <Textarea name="body" required rows={5} placeholder="Thank you, {name}. — {location}" aria-label="Template body" />
            <span className="block text-xs text-ink-3">
              Fill-ins: <code className="rounded bg-paper px-1">{"{name}"}</code>{" "}
              <code className="rounded bg-paper px-1">{"{location}"}</code>
            </span>
          </label>
          <Button type="submit">Save template</Button>
        </form>
      ) : (
        <Banner tone="neutral">You can view templates. Adding or removing them needs permission for this place.</Banner>
      )}
    </div>
  );
}
