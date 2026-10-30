"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FailureBanner, OperationStatus } from "@/components/status-banner";
import { AI_KNOWLEDGE_KINDS, type AiKnowledgeKind } from "@/lib/ai-config";
import { formatFriendlyDate } from "@/lib/format-date";
import { ACTION_STATUS } from "@/lib/ui-status";

export type AiConfigPart = "context" | "knowledge" | "versions" | "preview";

export interface AiConfigPanelProps {
  canEdit: boolean;
  target: { kind: "workspace" } | { kind: "client" | "group" | "location"; id: string };
  active: {
    version: number;
    label: string;
    snapshot: {
      org: {
        industry: string;
        positioning: string;
        priorities: string;
        policies: string;
        legacyVoice: string;
        legacyNote: string;
      };
    };
  };
  versions: Array<{ version: number; status: string; label: string; createdAt: string }>;
  knowledge: Array<{
    id: string;
    kind: AiKnowledgeKind;
    title: string;
    body: string;
    enabled: boolean;
    clientId: string | null;
    groupId: string | null;
    locationId: string | null;
    metadata?: Record<string, unknown>;
  }>;
  /** Render one part only (for tabbed layouts). Omit to render every part. */
  part?: AiConfigPart;
}

async function post(body: object) {
  const response = await fetch("/api/settings/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    text?: string;
    words?: number;
    violations?: string[];
    unavailable?: string;
    draftPreview?: boolean;
  };
  if (!response.ok) throw new Error(data.error ?? "Could not update AI settings.");
  return data;
}

const KIND_LABEL: Record<AiKnowledgeKind, string> = {
  instruction: "Instruction",
  faq: "FAQ",
  response_rule: "Response rule",
  approved_example: "Approved example",
};

const REPLY_KINDS = AI_KNOWLEDGE_KINDS;

const SELECT_CLASS =
  "h-[34px] w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-line disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60";

function SectionHead({ title, children, id }: { title: string; children?: React.ReactNode; id: string }) {
  return (
    <div>
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h2>
      {children ? <p className="mt-0.5 text-xs text-ink-3">{children}</p> : null}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

export function AiConfigPanel({ canEdit, target, active, versions, knowledge, part }: AiConfigPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{
    text: string;
    words: number;
    violations: string[];
    unavailable?: string;
  } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [comment, setComment] = useState("Staff were helpful and the collection was good.");
  const org = active.snapshot.org;
  const replyKnowledge = knowledge;
  const workspaceOnly = !canEdit || target.kind !== "workspace";
  const show = (name: AiConfigPart) => !part || part === name;

  return (
    <div className="space-y-4">
      {show("context") ? (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="ai-context-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <SectionHead id="ai-context-title" title="Workspace context">
              Saved instructions for the whole workspace. The model is not trained on this text; it is included when
              drafting replies.
            </SectionHead>
            <Badge variant="default">Version {active.version}</Badge>
          </div>
          {target.kind !== "workspace" ? (
            <Banner tone="neutral">
              Workspace context is shared by every business, group and location, so it is edited at the workspace scope.
              Brand voice and automation can still be overridden for this scope.
            </Banner>
          ) : null}
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canEdit || target.kind !== "workspace") return;
              const form = new FormData(event.currentTarget);
              setPending(true);
              setError(null);
              void post({
                action: "save-org",
                industry: String(form.get("industry") ?? ""),
                positioning: String(form.get("positioning") ?? ""),
                priorities: String(form.get("priorities") ?? ""),
                policies: String(form.get("policies") ?? ""),
                legacyVoice: String(form.get("legacyVoice") ?? ""),
                legacyNote: String(form.get("legacyNote") ?? ""),
                label: String(form.get("label") ?? ""),
              })
                .then(() => {
                  toast.success("Workspace context saved");
                  router.refresh();
                })
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "Could not save.")
                )
                .finally(() => setPending(false));
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Configuration label">
                <Input name="label" defaultValue={active.label} disabled={workspaceOnly} />
              </FieldLabel>
              <FieldLabel label="Industry">
                <Input name="industry" defaultValue={org.industry} disabled={workspaceOnly} />
              </FieldLabel>
            </div>
            <FieldLabel label="Brand positioning">
              <Textarea name="positioning" defaultValue={org.positioning} disabled={workspaceOnly} rows={2} />
            </FieldLabel>
            <FieldLabel label="Priorities">
              <Textarea name="priorities" defaultValue={org.priorities} disabled={workspaceOnly} rows={2} />
            </FieldLabel>
            <FieldLabel label="Policies the reply may reference">
              <Textarea name="policies" defaultValue={org.policies} disabled={workspaceOnly} rows={2} />
            </FieldLabel>
            <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
              <FieldLabel label="Voice preset">
                <select name="legacyVoice" defaultValue={org.legacyVoice} disabled={workspaceOnly} className={SELECT_CLASS}>
                  <option value="">Use brand voice</option>
                  <option value="warm">Warm</option>
                  <option value="professional">Professional</option>
                  <option value="brief">Brief</option>
                </select>
              </FieldLabel>
              <FieldLabel label="Tone note">
                <Textarea name="legacyNote" defaultValue={org.legacyNote} disabled={workspaceOnly} rows={2} />
              </FieldLabel>
            </div>
            {pending ? <OperationStatus copy={ACTION_STATUS.saveAi} /> : null}
            {canEdit && target.kind === "workspace" ? (
              <div className="flex justify-end">
                <Button type="submit" loading={pending}>
                  {pending ? ACTION_STATUS.saveAi.short : "Save workspace context"}
                </Button>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {show("knowledge") ? (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="ai-knowledge-title">
          <SectionHead id="ai-knowledge-title" title="Saved instructions and examples">
            FAQs, response rules and approved example replies for this scope. The draft writer may use them; they are not
            used to train a model.
          </SectionHead>
          {replyKnowledge.length === 0 ? (
            <div className="rounded-md border border-dashed border-line px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-ink">None saved for this scope</p>
              <p className="mt-1 text-xs text-ink-3">Add an FAQ, a rule or an approved reply below.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {replyKnowledge.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={row.kind === "approved_example" ? "ok" : "default"}>{KIND_LABEL[row.kind]}</Badge>
                      <span className="text-[13px] font-medium text-ink">{row.title}</span>
                      {!row.enabled ? <Badge variant="outline">Off</Badge> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-ink-3">{row.body}</p>
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${row.title}`}
                      onClick={() => {
                        void post({ action: "knowledge-delete", id: row.id })
                          .then(() => {
                            toast.success("Removed");
                            router.refresh();
                          })
                          .catch((caught: unknown) =>
                            setError(caught instanceof Error ? caught.message : "Could not delete.")
                          );
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <form
              className="space-y-3 rounded-md border border-line bg-paper p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const formElement = event.currentTarget;
                const form = new FormData(formElement);
                void post({
                  action: "knowledge-save",
                  kind: String(form.get("kind")),
                  title: String(form.get("title") ?? ""),
                  body: String(form.get("body") ?? ""),
                  target,
                })
                  .then(() => {
                    toast.success("Saved");
                    formElement.reset();
                    router.refresh();
                  })
                  .catch((caught: unknown) =>
                    setError(caught instanceof Error ? caught.message : "Could not save.")
                  );
              }}
            >
              <p className="text-[13px] font-medium text-ink">Add to this scope</p>
              <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <FieldLabel label="Kind">
                  <select name="kind" className={SELECT_CLASS}>
                    {REPLY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
                <FieldLabel label="Title or question">
                  <Input name="title" required />
                </FieldLabel>
              </div>
              <FieldLabel label="Text">
                <Textarea name="body" required rows={3} placeholder="Instruction, answer, rule, or approved reply text" />
              </FieldLabel>
              <div className="flex justify-end">
                <Button type="submit" variant="outline">
                  Add
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {show("versions") ? (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="ai-versions-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <SectionHead id="ai-versions-title" title="Configuration history">
              Active version {active.version}. Activating an earlier version restores its workspace context and brand voice
              defaults.
            </SectionHead>
            {canEdit && target.kind === "workspace" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void post({ action: "new-version", activate: true })
                    .then(() => {
                      toast.success("New version created");
                      router.refresh();
                    })
                    .catch((caught: unknown) =>
                      setError(caught instanceof Error ? caught.message : "Could not create version.")
                    );
                }}
              >
                Snapshot as new version
              </Button>
            ) : null}
          </div>
          {versions.length === 0 ? (
            <p className="text-xs text-ink-3">No saved versions yet.</p>
          ) : (
            <ol className="divide-y divide-line rounded-md border border-line">
              {versions.map((row) => (
                <li key={row.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-3">v{row.version}</span>
                    <span className="text-[13px] text-ink">{row.label || "Untitled"}</span>
                    <Badge variant={row.status === "active" ? "ok" : "default"}>
                      {row.status === "active" ? "Active" : row.status}
                    </Badge>
                    {row.createdAt ? <span className="text-xs text-ink-3">{formatFriendlyDate(row.createdAt)}</span> : null}
                  </div>
                  {canEdit && target.kind === "workspace" && row.status !== "active" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void post({ action: "activate", version: row.version })
                          .then(() => {
                            toast.success(`Version ${row.version} activated`);
                            router.refresh();
                          })
                          .catch((caught: unknown) =>
                            setError(caught instanceof Error ? caught.message : "Could not activate.")
                          );
                      }}
                    >
                      Activate
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {target.kind !== "workspace" ? (
            <p className="text-xs text-ink-3">Versions are managed at the workspace scope.</p>
          ) : null}
        </section>
      ) : null}

      {show("preview") ? (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-labelledby="ai-preview-title">
          <SectionHead id="ai-preview-title" title="AI draft preview">
            Runs the live draft prompt with your saved instructions
            {target.kind === "location" ? " and this location's overrides" : ""}. Nothing is published or stored as a reply.
          </SectionHead>
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} aria-label="Sample review text" />
          <Button
            type="button"
            variant="ai"
            loading={previewPending}
            onClick={() => {
              if (previewPending) return;
              setError(null);
              setPreview(null);
              setPreviewPending(true);
              void post({
                action: "preview",
                comment,
                reviewerName: "Anjali",
                locationId: target.kind === "location" ? target.id : undefined,
              })
                .then((data) =>
                  setPreview({
                    text: data.text ?? "",
                    words: data.words ?? 0,
                    violations: data.violations ?? [],
                    unavailable: data.unavailable,
                  })
                )
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "Draft preview failed.")
                )
                .finally(() => setPreviewPending(false));
            }}
          >
            {previewPending ? null : <Sparkles className="size-3.5" aria-hidden />}
            {previewPending ? ACTION_STATUS.aiPreview.short : "Run draft preview"}
          </Button>
          {previewPending ? <OperationStatus copy={ACTION_STATUS.aiPreview} /> : null}
          {preview?.unavailable ? (
            <Banner tone="warn" role="status">
              {preview.unavailable}
            </Banner>
          ) : null}
          {preview && !preview.unavailable ? (
            <div className="rounded-md border border-ai-line bg-[#fbf9ff] p-3 text-[13px] text-ink-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="ai">AI draft preview</Badge>
                <span className="text-xs text-ink-3">Not published · not saved</span>
              </div>
              <p className="whitespace-pre-line">{preview.text}</p>
              <p className="mt-2 text-xs text-ink-3">
                {preview.violations.length ? preview.violations.join(" ") : "Guardrails passed"} · {preview.words} words
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <FailureBanner title="Your changes couldn't be saved" detail={error} /> : null}
    </div>
  );
}
