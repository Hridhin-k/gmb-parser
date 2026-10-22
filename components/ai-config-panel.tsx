"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FailureBanner, OperationStatus } from "@/components/status-banner";
import { AI_KNOWLEDGE_KINDS, type AiKnowledgeKind } from "@/lib/ai-config";
import { ACTION_STATUS } from "@/lib/ui-status";

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

export function AiConfigPanel({ canEdit, target, active, versions, knowledge }: AiConfigPanelProps) {
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
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
        <h2 className="text-base font-medium text-graphite">Organisation context</h2>
        <p className="text-sm text-slate">
          Saved instructions and examples for this workspace. The model is not trained on this text; it is
          included when drafting replies.
        </p>
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
                toast.success("Organisation context saved");
                router.refresh();
              })
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : "Could not save.")
              )
              .finally(() => setPending(false));
          }}
        >
          <label className="block text-sm text-slate">
            Configuration label
            <Input name="label" defaultValue={active.label} disabled={!canEdit || target.kind !== "workspace"} className="mt-1" />
          </label>
          <label className="block text-sm text-slate">
            Industry
            <Input name="industry" defaultValue={org.industry} disabled={!canEdit || target.kind !== "workspace"} className="mt-1" />
          </label>
          <label className="block text-sm text-slate">
            Brand positioning
            <textarea
              name="positioning"
              defaultValue={org.positioning}
              disabled={!canEdit || target.kind !== "workspace"}
              rows={2}
              className="mt-1 w-full rounded-md border border-silver p-2 text-graphite"
            />
          </label>
          <label className="block text-sm text-slate">
            Priorities
            <textarea
              name="priorities"
              defaultValue={org.priorities}
              disabled={!canEdit || target.kind !== "workspace"}
              rows={2}
              className="mt-1 w-full rounded-md border border-silver p-2 text-graphite"
            />
          </label>
          <label className="block text-sm text-slate">
            Policies the reply may reference
            <textarea
              name="policies"
              defaultValue={org.policies}
              disabled={!canEdit || target.kind !== "workspace"}
              rows={2}
              className="mt-1 w-full rounded-md border border-silver p-2 text-graphite"
            />
          </label>
          <div className="flex flex-wrap gap-4 text-sm text-graphite">
            <label>
              Legacy voice
              <select
                name="legacyVoice"
                defaultValue={org.legacyVoice}
                disabled={!canEdit || target.kind !== "workspace"}
                className="ml-2 rounded-md border border-silver bg-white px-2 py-1"
              >
                <option value="">Use brand voice below</option>
                <option value="warm">Warm</option>
                <option value="professional">Professional</option>
                <option value="brief">Brief</option>
              </select>
            </label>
          </div>
          <label className="block text-sm text-slate">
            Legacy tone note
            <textarea
              name="legacyNote"
              defaultValue={org.legacyNote}
              disabled={!canEdit || target.kind !== "workspace"}
              rows={2}
              className="mt-1 w-full rounded-md border border-silver p-2 text-graphite"
            />
          </label>
          {pending ? <OperationStatus copy={ACTION_STATUS.saveAi} /> : null}
          {canEdit && target.kind === "workspace" ? (
            <Button type="submit" loading={pending}>
              {pending ? ACTION_STATUS.saveAi.short : "Save organisation context"}
            </Button>
          ) : (
            <p className="text-xs text-slate">
              Organisation context is edited at the organization scope. Brand voice and automation still use the
              target picker above.
            </p>
          )}
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
        <h2 className="text-base font-medium text-graphite">Saved instructions and examples</h2>
        <p className="text-sm text-slate">
          FAQs, response rules, and approved example replies for this scope. These are not used to train a model.
        </p>
        <ul className="divide-y divide-silver rounded-lg border border-silver">
          {replyKnowledge.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate">None saved yet.</li>
          ) : (
            replyKnowledge.map((row) => (
              <li key={row.id} className="px-3 py-3 text-sm">
                <p className="font-medium text-graphite">
                  {KIND_LABEL[row.kind]} · {row.title}
                  {!row.enabled ? <span className="font-normal text-slate"> · off</span> : null}
                </p>
                <p className="mt-1 text-slate">{row.body}</p>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
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
            ))
          )}
        </ul>
        {canEdit ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void post({
                action: "knowledge-save",
                kind: String(form.get("kind")),
                title: String(form.get("title") ?? ""),
                body: String(form.get("body") ?? ""),
                target,
              })
                .then(() => {
                  toast.success("Saved");
                  event.currentTarget.reset();
                  router.refresh();
                })
                .catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : "Could not save.")
                );
            }}
          >
            <label className="block text-sm text-slate">
              Kind
              <select name="kind" className="mt-1 w-full rounded-md border border-silver bg-white px-2 py-2">
                {REPLY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <Input name="title" placeholder="Title or question" required />
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Instruction, answer, rule, or approved reply text"
              className="w-full rounded-md border border-silver p-2 text-sm"
            />
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
        <h2 className="text-base font-medium text-graphite">Configuration versions</h2>
        <p className="text-sm text-slate">
          Active version {active.version}. Rollback restores a prior snapshot of organisation context and brand
          voice defaults.
        </p>
        <ul className="space-y-2 text-sm">
          {versions.map((row) => (
            <li key={row.version} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-silver px-3 py-2">
              <span className="text-graphite">
                v{row.version} · {row.label || "Untitled"} · {row.status}
              </span>
              {canEdit && target.kind === "workspace" && row.status !== "active" ? (
                <Button
                  type="button"
                  variant="outline"
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
        </ul>
        {canEdit && target.kind === "workspace" ? (
          <Button
            type="button"
            variant="outline"
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
      </section>

      <section className="space-y-3 rounded-xl border border-silver bg-white p-4">
        <h2 className="text-base font-medium text-graphite">Draft preview</h2>
        <p className="text-sm text-slate">
          Runs the live draft prompt with your saved instructions. Nothing is published or stored as a reply.
        </p>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-silver p-2 text-sm text-graphite"
        />
        <Button
          type="button"
          variant="outline"
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
          {previewPending ? ACTION_STATUS.aiPreview.short : "Run draft preview"}
        </Button>
        {previewPending ? <OperationStatus copy={ACTION_STATUS.aiPreview} /> : null}
        {preview?.unavailable ? (
          <p className="text-sm text-ink" role="status">
            {preview.unavailable}
          </p>
        ) : null}
        {preview && !preview.unavailable ? (
          <div className="text-sm text-graphite">
            <p className="text-xs text-slate">Draft preview — not published</p>
            <p className="mt-1">{preview.text}</p>
            <p className="mt-2 text-xs text-slate">
              {preview.violations.length ? preview.violations.join(" ") : "Guardrails passed"} · {preview.words}{" "}
              words
            </p>
          </div>
        ) : null}
      </section>

      {error ? (
        <FailureBanner title="Your changes couldn't be saved" detail={error} />
      ) : null}
    </div>
  );
}
