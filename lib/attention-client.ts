export type AttentionKind = "review" | "escalation" | "alert";

export interface AttentionEventDetail {
  kind: AttentionKind;
  id: string;
  title?: string;
  countsAsUnreplied?: boolean;
  countsAsEscalation?: boolean;
}

const opened = new Set<string>();

/** Tell the shell to drop a badge, then persist the open so a reload keeps it. */
export function acknowledgeAttention(detail: AttentionEventDetail): void {
  const key = `${detail.kind}:${detail.id}`;
  if (opened.has(key)) return;
  opened.add(key);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<AttentionEventDetail>("grm-attention", { detail }));
  }
  void fetch("/api/attention/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: detail.kind,
      id: detail.id,
      title: detail.title ?? null,
    }),
  }).then((response) => {
    if (!response.ok) {
      opened.delete(key);
      window.dispatchEvent(new CustomEvent<AttentionEventDetail>("grm-attention-failed", { detail }));
    }
  });
}
